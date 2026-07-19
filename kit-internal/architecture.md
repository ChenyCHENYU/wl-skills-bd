# wl-skills-bd Architecture Decision Record

> 状态：accepted · 版本：0.15.1 · 日期：2026-07-19

## 目标

把后端 AI 工作流从“规范提示词集合”升级为可安装、可验证、可回放的工程闭环，同时保持三条安全边界：不猜业务事实、不盲目覆盖本地修改、不自动执行高风险外部变更。

## 分层

```text
已评审需求 / 可选 design-model 或前端契约 / 数据库约束
                    │
                    ▼
L0 机器事实  JSON Schema + shared delivery profile + rule catalog + module catalog
                    │
                    ▼
L1 上下文治理  当前模块增量扫描 / 一跳快照 / 关系与预算选择 / 全局身份去重
                    │
                    ▼
L2 确定性核心  install / contract / codegen / collaboration / audit / safe-fix / config / task-router
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
L3 CLI 适配              L3 MCP 适配
          │                   │
          └─────────┬─────────┘
                    ▼
L4 工程产物  Java/XML/DDL/tests/contracts/catalog/docs + standards/skills/quality config
                    │
                    ▼
L5 验证  B1~B23 + J1~J8 + strict contract diff + package self-check
                    │
                    ▼
L6 人工卡口  DDL/数据、权限发布、环境部署、破坏性 API、业务重构
```

CLI 与 MCP 只能适配同一个 `lib/` 核心，禁止复制业务逻辑形成行为漂移。Markdown 解释机器事实，不能反向覆盖 Schema/Profile/catalog。

## 模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| `files/.wl-skills-bd/` | contract/collaboration/rules Schema，Profile，兼容矩阵，规则目录 | 业务工程源码 |
| `lib/installer.js` | manifest、增量更新、漂移、清理、备份 | 猜测文件归属 |
| `lib/contract.js` | JSON Schema 和跨字段语义校验 | 自然语言需求解析 |
| `lib/codegen.js` | 17+N 产物、planHash、业务保护区、Flyway 不可变、冲突、事务回滚与完成度证据 | 执行 DDL |
| `lib/collaboration.js` | manifest 渲染，前端/OpenAPI/权限差异 | 修改前端或权限平台 |
| `lib/be-rules.js` | B1~B23 只读扫描与证据 | 自动修复 |
| `lib/safe-fix.js` | B3/B5 条件安全修复、备份、恢复、复扫 | 业务语义重构 |
| `lib/doctor.js` | 工具链/Profile/门禁/租户证据 | 安装 Maven 或修改 POM |
| `lib/config-*.js` / `lib/env-matrix.js` | 配置骨架、矩阵、迁移计划、体检、脱敏修复与 TCP 探测 | 写 Nacos/数据库/K8s 或自动部署 |
| `lib/write-guard.js` / `lib/permission-export.js` | 统一 pre/prod 护栏、权限导出计划/回滚 | 发布权限到平台 |
| `lib/task-router.js` | 只读识别任务并选择 Skill、Standards、规则子集与统一安全写链 | 直接修改源码或绕过 codegen/safe-fix/config |
| `lib/project-catalog.js` / `lib/context-planner.js` | 当前模块增量目录、全局身份去重、一跳快照和预算化上下文 | 隐式全仓扫描或读取关联模块源码目录 |
| `lib/commit-policy.js` | type/scope/subject 与 Git range 校验、Hook 接入诊断 | 分支策略、自动提交或仓库保护配置 |
| `files/.github/java-quality/` | J1~J8 Maven 质量能力 | 替代业务测试/人工评审 |
| `mcp/` | 严格入参 Schema、根目录边界和 stdio 协议 | 第二套执行器 |

## 关键决策

### 契约先于代码

`wl-contract.json` 是资源级生成事实。契约缺外部路径、权限、数据库、迁移恢复或字段语义时阻断，不能用模板默认值掩盖未知事实。Profile 固定框架约定；资源契约只描述业务差异。

### 当前模块先于全仓

日常开发只扫描目标模块的契约和源码根，项目级视图复用快照。上下游最多一跳，只有契约关系或任务关键词命中的关联契约进入 Context Plan；快照缺失不回退全仓扫描。codegen 绑定当前模块和关联切片哈希，避免无关模块刷新造成计划漂移。

### 直接 Service

当前 Profile 使用 Controller → 直接 Service → Mapper，不生成无业务价值的 `IService + ServiceImpl` 双层。Controller→Mapper 由 ArchUnit J1 阻断。

### 显式租户与乐观锁

请求不得提供 companyId；Service 从 `AuthUtil.getLoginCompanyId()` 取租户；SQL 显式带 `COMPANY_ID`。UpdateDTO 强制 id/revision，详情 VO 返回 revision，写 SQL 同时比较 revision 并递增。

### 高风险变更留人工卡口

DDL 仅生成正向 migration 和人工处置说明。权限发布、环境部署、数据库执行、破坏性 API 与领域重构不在自动 apply 授权内。

### 条件安全修复

安全修复白名单只有 B3/B5。计划必须是可重算的，apply 要求 SHA-256 planHash 和明确确认；源码漂移时整批零写入。写前备份、失败恢复、成功复扫是一个事务边界。

### 任务路由不拥有写权限

单点需求先由 `task-router` 缩小规则和执行面，再以契约增量进入既有 codegen。禁止额外维护正则/字符串拼接式 Java patch 内核；否则会绕过 planHash、确认、保护区、幂等、备份和失败整批回滚。

### PMD 版本隔离

默认 J3 使用 PMD 7；P3C 2.1.1 依赖 PMD 6，只能在 `wl-p3c-legacy` 单独非阻断运行。二者同进程混装会引入运行时 API 冲突。

## 与 wl-skills-kit 的协作

前端负责页面/API_CONFIG/菜单字典权限消费，后端负责 Controller/Service/Mapper/DDL/测试和服务端权限注解。双方都能从需求独立工作，通过共同 delivery profile 和 `wl-api-contract` 对齐：

- 外部 API 根路径与五个操作的 HTTP 方法/路径；
- query/path/request/response 字段；
- `ApiResult` 的 `code=2000`，分页 `data.records/data.total`；
- page/detail/create/update/remove 权限码；
- revision 的详情→更新闭环。

后端不会直接写前端仓库，通过 `contract diff` 暴露差异，由各自工程按职责修正。

### 受保护业务区

生成器不伪造 export、relation 或业务命令的交付完成度。确定性命令可生成原子写实现，但在真实 `@Test` 方法中同时存在服务调用与断言/验证之前仍为 draft；注释、方法名或空测试不作为证据。

## 状态与污染控制

- 安装与生成 manifest 只记录受管文件和哈希；
- 本地备份/临时状态位于 `.wl-skills-bd/.state/`，扫描器排除该目录；
- npm `files` 白名单只发布运行所需的 `bin/files/lib/mcp` 与公开文档；
- repo 自检、测试和内部 ADR 不进入发布包；
- 行尾、编码和格式由 `.gitattributes`、`.editorconfig` 和 Spotless 固定。

## 验证策略

| 层 | 验证 |
|---|---|
| 包一致性 | version/计数/MCP 名称/模板/Schema/文件白名单 |
| Node 核心 | 安装、契约、生成、协作、报告、安全修复、配置、任务路由、CLI、MCP 测试 |
| Java 生成 | Java 8 编译夹具 |
| Maven 门禁 | Java 8 真实执行 ArchUnit/Checkstyle/PMD/SpotBugs/Spotless/JaCoCo |
| 发布物 | `npm pack --dry-run` 内容审计 |

## 已知边界

2 个 Skill 仍是流程骨架：业务文档抽取、业务测试生成；db-migration 对复杂数据回填仍是部分能力。环境配置已由 config 命令族落地。没有对应执行器的能力不得在 README/USAGE 中宣称自动 apply。
