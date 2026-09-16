# Agent Instructions — wl-skills-bd

## 唯一入口（先读这里）

1. `.wl-skills-bd/capabilities.json`（或 `wl-skills-bd capabilities --json` / MCP `wls_be_capabilities`）：机器能力清单——13 个 Skill 的触发词/状态/安装路径、B1~B31 规则、MCP 工具、CLI 命令与推荐读取顺序，全部单一数据源生成。
2. `.github/skills/_registry.md`：触发词 → Skill 路由；`.github/standards/index.md`：任务类型 → 必读规范（懒加载，不一次读全 30 条）。
3. 任务路由优先 `wl-skills-bd task "<描述>"`（只读）；输出含规则子集、安全写链步骤和 Pre-flight 证据（必读 standards/skill 文件的 sha256 清单，`--json` 获取 `preflightHash`）。宣称"已读取"必须能与该清单对上。

## 不变式（任何任务模式都不得违反）

1. 分层与租户：Controller → 直接 Service → Mapper；租户来自 AuthUtil，SQL 显式 COMPANY_ID（除非有 doctor 可验证的统一拦截器证据）；`companyId` 不得来自请求。
2. 软删事实源：受管 profile + 未受管 `profile.local` 合并为唯一事实源（默认 1=有效/0=删除）；禁止直接编辑 `profiles/*.json`；受管更新用 `ID + COMPANY_ID + 有效标记 + REVISION` 原子 SQL，详情返回 revision。
3. 数据库事实源：涉及表结构先对账 `docs/db-spec` 与 standards/29——文档表同名复用、字段全属性/顺序一致、扩展有依据且末尾追加；ALTER 分 expand/contract；Flyway 版本不可变；DDL 只生成，永不由工具执行。
4. 契约先行：codegen 只接受机器契约，先 plan 后 apply；apply 必须携带同一 planHash 与显式确认；增量接口/字段/业务命令必须先更新 `wl-contract.json`，禁止字符串拼接旁路 patch。
5. 统一写链：所有工程写入必须 preview → planHash → confirm → 原子写 → 复验 → 可回滚；pre/prod/production 默认零写入，显式授权后仍保留确认链；MCP 不执行数据库写入。
6. 修复白名单：自动修复仅限 B3/B5 严格前置条件与项目批准的单次精确替换（evidenceRefs 内、字面 before 恰好命中一次）；写后强制复扫；权限、租户、SQL、MQ 语义与业务算法保持人工卡口。
7. 验证收口：每步之后跑对应验证，error 未清零不得宣称完成；最终交付执行完整 `review run`（quick/staged/changed 是 partial，不能冒充 full）与 `mvn verify -Pwl-quality`（J1~J5/J8；J6/J7 不冒充硬门）。
8. 模块上下文：启用 Catalog 后默认只扫当前模块；关联模块只读一跳快照；目录过期、身份冲突或上下文哈希漂移时阻断，不偷偷回退全仓扫描。
9. 数据安全与稳定性底线：Redis 必带 TTL、锁用 Redisson、禁 KEYS \*/FLUSHDB/物理删/TRUNCATE、全表写必须有 WHERE、saveBatch ≤ 1000、事务内禁发 MQ/HTTP、外部调用必须超时、新代码统一 OpenAPI 3。详见 standards 20/21/22 与 `ops/data-safety`。
10. Token 纪律：MCP 默认 summary 与有界 response 预算，超预算用 cursor 续取，不重复注入上下文；cursor 不授予写权限。

场景级约束（生产保障、契约分流、集成治理、平台适配、受控修复等）以 standards/26~30 与对应 Skill 为准，不在本文件重复展开。

## 快速命令

```bash
wl-skills-bd capabilities --json          # AI 能力清单（首次接入）
wl-skills-bd task "<任务描述>" --json      # 任务路由 + Pre-flight 证据
wl-skills-bd doctor                       # 含环境体检（bootstrap/profile/dbcluster）
wl-skills-bd catalog check --module <module>
wl-skills-bd context plan --module <module> --task "<任务>" --json
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm   # 可加 --require-complete
wl-skills-bd contract inspect <contract.json> --json   # 先分流：仅 crud 可 codegen
wl-skills-bd impact field --module <module> --field <field> --table <table> --json
wl-skills-bd review run --module <module> --json        # 交付前 full 门禁
wl-skills-bd fix advise --module <module> --json
wl-skills-bd validate . --strict          # B1~B31（含真实端点与数据库事实源）
wl-skills-bd test gen wl-contract.json    # 行为契约测试
```

MCP 提供 18 个等价工具（`wls_be_capabilities` 起步）；`wls_be_review` 统一承载变更门禁、平台适配、项目断言、供应链与修复分级。写工具的 confirm 只能在用户评审预览后传递；pre/prod/production 额外需要 `allowProductionWrites=true`。
