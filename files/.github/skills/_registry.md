# Backend Skills 注册表（v0.26.0）

> 单一数据源。AI 触发 Skill 的唯一依据。**禁止从 README / 个人记忆推断 Skill 路径。**
> 状态与各 SKILL.md 头部 `metadata.status` 严格一致，改一处必须同步另一处。
> 机器可读版本：`.wl-skills-bd/capabilities.json`（含触发词/状态/安装路径，由 `npm run capabilities:sync` 从本表与 SKILL.md 生成）。

---

## 触发词 → SKILL 路径

| 触发词（示例）                                          | SKILL                                                                    | 阶段 | 状态     | MCP 依赖   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---- | -------- | ---------- |
| 设计接口 / 评审 api.md / 接口契约审查 / 逻辑 ID / 集成契约 | [`core/api-design-be`](core/api-design-be/SKILL.md)                   | ②   | ✅ 落地  | contract   |
| 生成实体 / Entity / DTO / VO                          | [`core/entity-codegen`](core/entity-codegen/SKILL.md)                    | ③   | ✅ 落地  | —          |
| 生成 Service / 全套 CRUD / 业务命令 / 状态机           | [`core/service-codegen`](core/service-codegen/SKILL.md)                  | ④   | ✅ 落地  | —          |
| 生成 Mapper / XML / SQL                                 | [`core/mapper-xml-gen`](core/mapper-xml-gen/SKILL.md)                    | ⑤   | ✅ 落地  | —          |
| 后端规范审计 / 代码体检 / 全量扫描                      | [`core/convention-audit-be`](core/convention-audit-be/SKILL.md)          | ⑧   | ✅ 落地  | validate   |
| MQ 对接 / 平台消息封装适配 / Producer Consumer 接线 / 集成质量门 | [`core/integration-adapter-be`](core/integration-adapter-be/SKILL.md) | ⑦ | ✅ 落地 | review |
| 模块上下文 / 查关联服务 / 生成前去重 / 避免全仓扫描 / 集成工具审计 | [`core/project-context-governance`](core/project-context-governance/SKILL.md) | ⓪ | ✅ 落地 | catalog/context |
| 抽取业务文档 / 阅读旧代码生成业务说明                  | [`core/business-doc-extract-be`](core/business-doc-extract-be/SKILL.md)  | ②预  | 🟡 骨架  | —          |
| 建表 / DDL / ALTER TABLE / 字段新增 / 字段影响 / 索引 | [`data/db-migration`](data/db-migration/SKILL.md)                         | ⑥   | 🟡 部分  | contract/db_preview |
| 生成单元测试 / Mock 测试 / Controller 测试            | [`test/unit-test-gen`](test/unit-test-gen/SKILL.md)                      | ⑦   | ✅ 落地  | test       |
| 修复规范违规 / 按审计报告改代码                        | [`ops/code-fix-be`](ops/code-fix-be/SKILL.md)                            | ⑨   | ✅ 落地  | validate   |
| Redis / 缓存 / 分布式锁 / 批量删除 / 物理删 / 熔断 / 限流 / Feign 超时 / 生产只读 / 二次确认 | [`ops/data-safety`](ops/data-safety/SKILL.md) | ops 横切 | ✅ 落地 | validate   |
| 后端环境标准化 / 切华新 / 本地启动配不起来 / K8s 部署清单对齐 | [`ops/standard-env-config-be`](ops/standard-env-config-be/SKILL.md) | ops  | ✅ 落地 | config/troubleshoot |

**落地度**：13 个 Skill 中 **11 已落地**（project-context / api-design / entity / service / mapper / integration-adapter / audit / safe-fix / data-safety / env-config / unit-test）/ **1 部分落地**（db-migration：CREATE/ALTER/索引已自动生成，复杂数据迁移/回填仍骨架）/ **1 骨架**（business-doc：从旧代码抽取业务文档属 NLP 能力，不在代码生成包边界）。

## v0.17 生产安全与行为契约测试

| 任务 | 工具 | 生成内容 |
|---|---|---|
| 生成单测 | `test gen <contract>` / `wls_be_test` | 从 customOperations 生成可执行场景测试；直接断言状态/结果，batch 验证整批成功与整批拒绝，不生成 TODO/空测试 |
| 列出场景 | `test scenarios <contract>` | 列出所有操作 + 测试场景清单 |
| 生产证据 | `codegen validate/plan/apply --require-complete` | `assurance.level=production` 时校验 SLO/RTO/RPO、安全、数据治理、一致性、韧性与六类证据文件 |

原则：测"行为契约"不测"代码镜像"——不 verify setter/方法调用次数，只断言结果（状态值/计数/异常）。避免冗余。

## v0.13 任务驱动精准路由

<!-- wl-bd-task-types:begin -->
当前 **13 种任务类型**（从 task-router 与规则 catalog 生成）：

| 任务类型 | 名称 | 模式 | 典型触发词 | 计划规则/质量门 | 原工具 |
|---|---|---|---|---|---|
| new-service | 新开发完整后端服务 | full | 新开发/新建服务/全套CRUD | B1/B2/B3/B4/B5/B7/B8/B12/B17/B18/B20/B24/B25/B26/B27/B28/B29/B30/B31/B32/J1/J2/J3/J8 | codegen/validate/contract/permissions |
| add-api | 加一个接口/方法 | incremental-contract | 加接口/加方法/加一个 | B1/B2/B5/B8/B12/B20/B24/B25/B26/B30/B31/B32 | codegen/validate/contract |
| add-field | 加字段落库 | incremental-contract | 加字段/落库/加列 | B3/B4/B7/B18/B25/B26/B31 | codegen/validate/db |
| add-business-cmd | 加业务命令/状态机 | incremental-contract | 加业务命令/状态机/加submit | B5/B8/B17/B20/B24/B25/B26/B31 | codegen/validate/contract |
| fix-bug | 修 bug/修复问题 | fix | 改bug/修复/fix | B3/B5/B7/B8/B17/B18/B24/B25/B26/B28/B30/B31/B32 | validate/fix/troubleshoot |
| refactor | 重构/优化 | fix | 重构/优化/refactor | B5/B6/B8/B9/B10/B11/B12/B23/B24/B25/B26/B28/B30/B31/B32/J1/J2/J3/J8 | validate/fix |
| audit | 审计/体检 | readonly | 审计/体检/检查 | B1/B2/B3/B4/B5/B6/B7/B8/B9/B10/B11/B12/B13/B14/B15/B16/B17/B18/B19/B20/B21/B22/B23/B24/B25/B26/B27/B28/B29/B30/B31/B32/J1/J2/J3/J4/J5/J8 | doctor/validate |
| config-op | 配置/环境/部署 | config | 配置/环境/部署 | 见 task 回执 requiredChecks | config/troubleshoot |
| generate-tests | 生成行为契约测试 | readonly | 生成单元测试/生成单测/补覆盖率 | B1/B5/B24/B25/B32/J8 | test/validate |
| integration-adapter | MQ/HTTP 集成适配 | readonly | mq 对接/接入 mq/消息封装 | B20/B21/B28/B32/J1/J8 | integration/review |
| project-context | 模块上下文治理 | readonly | 模块上下文/查关联服务/生成前去重 | 见 task 回执 requiredChecks | catalog/context |
| extract-business-doc | 反向抽取业务文档 | readonly | 抽取业务文档/业务理解/接手陌生模块 | 见 task 回执 requiredChecks | context |
| data-safety | 数据与缓存安全 | readonly | 缺 ttl/没有 ttl/缓存安全 | B13/B14/B15/B16/B17/B18/B19/B25 | validate/fix |

表格表示判定与计划，具体范围、资产缺口、待补输入和实际验证状态以 task/status 回执为准。反向业务文档抽取目前只有骨架指导，缺少语义执行器时明确报告 gap。
<!-- wl-bd-task-types:end -->

## v0.20 数据库事实源门禁

建表、加字段、Entity/Mapper 生成和数据库审计必须触发 `data/db-migration` 并读取 standards/29。文档表同名复用；字段全属性/顺序一致；扩展字段只在末尾且有来源/审批，新表必须说明基线表为何不能承载。dev/sit 一次审批连续执行，不能降低结构正确性门禁。

`task` 是只读指挥层：识别意图→给 Skill/规则/步骤，不直接写代码；写操作统一走 codegen plan/apply（planHash+确认）或 safe-fix/config。

## v0.21 精益执行与节点契约

- 规则子集在发现/读取/执行前短路，并返回实际执行组、文件字节、缓存和 coverage；
- Source Index 使用可安全失效的内存/持久化缓存，缓存异常只触发真实重扫；
- 18 个 MCP 工具共享 response 字节/数组预算，大结果用短期 cursor 续取；
- task 返回 discover/context/validate/plan/approval/apply/verify Pipeline；写节点禁止自动重试且必须确认；
- `npm run eval:quality` 固化 precision/recall、P95、短路比例和 token 回退门禁。

## v0.23 契约分类、影响与集成治理

- `contract inspect/migrate` 将严格 CRUD、数据库镜像和集成投影分流；只有 CRUD 可 codegen，迁移写入保留 planHash/备份/回滚门；
- `impact field --module` 输出字段容量、所有权、迁移阶段和精确源码引用，禁止隐式全仓扫描；
- `integration inspect/audit` 校验逻辑 ID、投递闭环、错误码引用以及 StableBusinessId/PayloadHash 重复漂移；
- Catalog 默认摘要且支持 section/cursor，API 来自 Controller 源码观测，不为镜像契约合成接口。

## v0.24 变更审查、平台适配与精准修复

- `review run` 汇总 Git 变更、B 规则、项目断言、平台适配、供应链及 JaCoCo 全量/变更行覆盖率；
- `quality-gate.json` 管理新增/历史基线、阻断严重度、warning 预算、覆盖率与有期限豁免；
- `integration-adapters.json` 由平台团队声明真实依赖、源码/配置/测试标记、方向门禁和项目模板，BD 不猜 MQ SDK；
- `quality-assertions.json` 用项目证据表达 HTTP/幂等/并发等边界，精确修复只有单次字面命中才允许 apply；
- `supply-chain.json` 显式启用版本收敛、BOM、禁用坐标和仓库门禁；未配置时只输出事实清单。

## v0.12 配置分层矩阵

| 检查/工具 | 作用 | 写入 |
|---|---|:---:|
| config init | 生成骨架（bootstrap+app+logback+env×5+matrix） | 条件 |
| config migrate | 客户迁移（.env+K8s×15+报告） | 条件 |
| config doctor | L0~L8 配置体检（骨架/明文密码/占位符/矩阵/K8s/端口/一致性/生产护栏） | 否 |
| config doctor --probe | DB/Redis/Nacos TCP 连通性探测 | 否 |
| config fix | 明文密码→${VAR} 占位符 + 复扫 | 条件 |
| troubleshoot | 10 类故障诊断树（DB/Redis/Nacos/K8s/端口/Bean/Profile/Flyway/Feign/MQ）| 否 |

## v0.11 稳定性与多环境矩阵

| B 规则 | 标准 | 检测 | severity | data-safety 兜底 |
|---|---|---|---|---|
| B14（扩展）| 20 | setIfAbsent 长 TTL（>10min）缺 watchdog | error | ✅ |
| B20 | 10 + 22 | @Transactional 内调 MQ/HTTP | error | ✅ |
| B21 | 22 | HttpUtil/RestTemplate 裸调用无超时 | warn | ✅ |
| B22 | 13 | Swagger 2/OpenAPI 3 混用（混用 error/纯 Swagger 2 warn）| warn | ✅ |
| B23 | 02 + 19 | Service 注入依赖 > 10（巨型类信号）| warn | ✅ |
| B24 | 11 + 28 | 使用 `@PreAuthorize` 但未启用方法安全 | error | ✅ |
| B25 | 09 + 11 + 28 | 敏感字段进入 Lombok `toString` | error | ✅ |
| B26 | 02 + 06 | Mapper 扫描、泛型契约与 XML namespace 绑定 | error | ✅ |

## v0.10 数据安全矩阵

| B 规则 | 标准 | 检测 | severity | data-safety 兜底 |
|---|---|---|---|---|
| B13 | 20 | Redis set 缺 TTL | error | ✅ |
| B14 | 20 | setnx 自实现锁 | error | ✅ |
| B15 | 20 | KEYS \*/FLUSHDB/FLUSHALL | error | ✅ |
| B16 | 20 | JdkSerializationRedisSerializer | warn | ✅ |
| B17 | 21 | deleteBatchIds/TRUNCATE/DROP | error | ✅ |
| B18 | 21 | Mapper XML update/delete 缺 WHERE | error | ✅ |
| B19 | 21 | saveBatch > 1000 | warn | ✅ |

---

## 状态标记

- ✅ 落地：含完整模板、产物示例、回归用例
- 🟡 骨架：仅 frontmatter + 流程纲要，AI 触发时按 **官方/社区最佳实践 + standards 规范** 落地（**不**对齐某个存量项目）
- 🔴 阻断：检测到必要前提缺失时暂停

---

## 13 个 Skill 的 Pipeline 联动（详见 `_pipeline.md`）

```
business-doc-extract-be → api-design-be → entity-codegen → service-codegen
                                                                │
                                                                ▼
                                                       mapper-xml-gen
                                                                │
                                                                ▼
                                                       db-migration（人工确认）
                                                                │
                                                                ▼
                                                       unit-test-gen
                                                                │
                                                                ▼
                                                       convention-audit-be
                                                                │
                                                                ▼
                                                       code-fix-be（可选）
```

---

## 变更管理

- 新增 Skill：编辑本文件并创建 `skills/{category}/{name}/SKILL.md`；只有存在按需加载的详细资料时才增加 `references/` 或 `USAGE.md`
- 不存在的 Skill 应明确说明未提供执行器，并给出当前可用的手工流程；不得声称已自动登记 roadmap。


补充任务路线：`generate-tests` → `test/unit-test-gen`；`integration-adapter` → `core/integration-adapter-be`；`project-context` → `core/project-context-governance`；`extract-business-doc` → `core/business-doc-extract-be`（骨架，无语义执行器，显示 gap）；`data-safety` → `ops/data-safety`。实际路由以 `task --input ... --json` 为准，阈值、分差、负向领域和候选都在结果中；计划与模型声明不作为执行证据。
