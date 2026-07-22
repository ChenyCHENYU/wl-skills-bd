# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [0.17.4] - 2026-07-22（多模块工程环境发现修正）

### Fixed

- doctor/config doctor 可递归发现多模块工程中的 `bootstrap.yml` 与 `application.yml`，不再把服务模块配置误报为根工程缺失。
- Windows doctor 使用 `mvn.cmd` 探测 Maven，兼容 IntelliJ/独立 Maven 的标准 Windows 安装布局。
- datasource profile 识别复用多模块配置文件扫描，保留 cx/non_cx/pt 的既有判定语义。

### Verification

- 增加 `wl-produce-pl/*-service/src/main/resources` 形态的 bootstrap、端口与 doctor profile 回归。

## [0.17.3] - 2026-07-22（项目治理覆盖与安装升级链解耦）

### Fixed

- 新增未受管 `.wl-skills-bd/profile.local.json` 覆盖层：codegen 与 doctor 在受管 profile 基线上安全合并项目治理差异，避免直接修改 `profiles/*.json` 导致 manifest 漂移和后续 update 冲突。
- 本地覆盖严格校验 schemaVersion、profileId、属性白名单及软删/时间方言值；非法或跨 profile 覆盖 fail-closed。
- 新增 `profile-local.schema.json`，并验证本地覆盖文件不会破坏 installer 完整性检查。

### Verification

- 增加华新 0/4 与 DATETIME(3) 本地覆盖、错误 profileId 拒绝、installer 零漂移回归。

## [0.17.2] - 2026-07-22（治理列生成闭环与项目配置防误改）

### Fixed

- 将 `profile.softDelete` 从 DDL/B17 局部覆盖补齐为 Entity、Service、Mapper XML 全链路渲染，消除业务代码仍硬编码默认 `1/0` 的工程冲突。
- 新增治理 profile 的 fail-closed 校验，拒绝相同有效/删除值、危险列名/方言类型和当前模板不支持的 Java 字段映射。
- `rules-config.schema.json` 正式声明 `softDelete`，doctor 校验 profile、`rules.local.json` 与本地 MyBatis-Plus 运行值三点一致；仅由 Nacos 下发时明确报告待补运行证据。
- `env-port` 优先比对 env-matrix 的项目冻结端口，避免通用业务域范围误导修改已确认可用的客户配置。

### Verification

- 增加华新 `0有效/4删除 + DATETIME(3)` 的 Entity/Service/Mapper XML 渲染回归、非法 profile、doctor 三点一致性及项目冻结端口测试。
- 保留默认 `1有效/0删除 + VARCHAR(19)` 的向后兼容行为，并纳入 Java 8 真实编译夹具。

## [0.17.1] - 2026-07-21（治理列策略化：默认兜底 + 项目级覆盖）

### Changed

- **治理列从硬编码改为默认值兜底 + profile/rules 覆盖**：`IS_DELETE`、治理时间（`CREATE_DATE_TIME`/`UPDATE_DATE_TIME`）不再写死，codegen 优先读 `profile.softDelete` / `profile.auditTime`，未提供时回退到 jh4j 基线（`1有效/0删除`、`VARCHAR(19)`），完全等价历史行为。
  - `lib/codegen.js`：新增 `DEFAULT_GOVERNANCE` 常量与 `resolveGovernance(profile)` 解析器；`renderMysqlMigration` / `renderOracleMigration` / `renderMigration` 增加 `profile` 形参，治理列、注释、索引列名全部从解析结果生成。
  - 兼容性：未传 `profile` 或 `profile` 无 `softDelete`/`auditTime` 时，生成的 DDL 与 0.17.0 逐字节一致（向后兼容）。
- **B17 物理删除提示语随软删值动态变化**：`lib/be-rules.js` 的 `checkPhysicalDelete` / `checkMapperXml` / `checkUpdateDeleteWithoutWhere` 接收 `softDelete`，提示文本中的 `IS_DELETE=` 取实际删除值，不再写死 `0`。
- **`rules.local.json` 新增可选 `softDelete` 配置块**：支持 `activeValue` / `deletedValue`（均为整数，且不能相等），缺失或非法时回退默认并给出 `WLS_CONFIG` 诊断。

### Added

- `tests/governance-policy.test.js`：覆盖默认兜底、华新 `0有效/4删除`、`DATETIME(3)` 覆盖、B17 动态提示、配置校验五类场景。

## [0.17.0] - 2026-07-19（生产安全、数据治理与真实生成质量闭环）

### Added

- 新增 standards/28 与 `assurance.level=production` 契约：强制声明业务关键级别、SLO、RTO/RPO、安全、数据治理、一致性、韧性，以及威胁模型、授权评审、压测、运行手册、恢复演练、数据评审六类证据；证据不齐时 `--require-complete` 零写入。
- 字段契约新增稳定语义 ID、定义、枚举、初始值、数据分级、脱敏、日志策略、加密要求、保留期限、数据所有者和唯一事实源；状态值、初始值和敏感字段执行 fail-closed 校验。
- 新增 B24 方法安全启用检查与 B25 敏感字段 Lombok `toString` 泄漏检查；任务路由和规则目录复用同一规则事实源。
- K8s 生成补 readiness/liveness/startup 探针、优雅停机、非 root、只读根文件系统、Seccomp、能力收敛、PDB/HPA 与不可变镜像标签。
- 新增 JS 语法/冲突标记/BOM 门，并将真实 codegen 产出的 Java 主代码和测试纳入 Checkstyle、Spotless、PMD 7 验证。

### Changed

- 保持团队 Java 8、Spring Boot 2、jh4j-cloud 3 和业务子域分层为第一基线；所有新增实践均采用兼容实现，不强推高版本 JDK/Spring API。
- 生成查询统一走显式租户与有效标记 Mapper 边界；写操作继续同时约束 `ID + COMPANY_ID + IS_DELETE + REVISION`，批量命令改为去重、限量、全有或全无事务语义。
- 生成 ServiceTest 从占位/TODO 升级为可执行行为断言，覆盖成功、前置拒绝、状态迁移和整批失败，不伪造权限、并发、数据库方言或压测证据。
- 模板渲染增加稳定空白、导入排序和 AOSP 兼容格式，重复生成保持确定性并保护 `<wl-custom>` 区域。
- ArchUnit 增加 Entity 禁依赖 Mapper、Mapper 仅限 Service/Mapper 使用和业务子域无环依赖。

### Verification

- 全量 Node 契约、规则、CLI、MCP、配置、生成、回滚、完成度与 Java 8 编译回归通过。
- Java 8 真实 Maven 工程通过 ArchUnit、Checkstyle、PMD 7、SpotBugs、Spotless、JaCoCo；实际生成源码额外通过 Checkstyle、Spotless、PMD 7。
- `release:check` 继续包含完整 verify、真实 Maven 门和 `npm pack --dry-run` 发布内容审计。

## [0.16.0] - 2026-07-19（行为契约测试生成）

### Added

- 新增 `lib/test-codegen.js`：从契约 customOperations 自动生成行为契约测试场景（正常路径/前置拒绝/状态转移/batch 计数）。
- 新增 CLI `test gen/scenarios` 与 MCP `wls_be_test`（第 16 个工具），支持自然语言生成与场景清单查询。
- `ServiceTest.java.tmpl` 注入 `customTestsSection`，含 ArgumentCaptor 行为断言引导与测行为原则注释。
- be-rules 支持 `rules` 参数精准过滤（任务驱动规则子集的基础设施）。
- 补全 java-compile-fixture stub：ServiceException、ArgumentCaptor、Mockito.verify、Assertions.assertThrows、Executable。

### Changed

- `unit-test-gen` Skill 从 🟡 骨架 升级为 ✅ 已落地（落地度 9 → 10）。
- 测试原则明确：测"行为契约"（状态机/前置校验/权限/幂等），不测"代码镜像"（getter/纯转发/verify setter 调用次数），避免冗余。
- MCP 工具数 15 → 16；README/AGENTS/_registry/standards index 同步 v0.16。

### Verification

- `test-codegen.test.js`：5 组（场景矩阵/方法名/行为不镜像/确定性）。
- java-compile-fixture：标准 CRUD + 扩展（PATCH/body/none/batch/relation/export）含行为契约测试通过 Java 8 真编译。
- 全量 `npm run verify` 通过。

## [0.15.1] - 2026-07-19（使用文档与小版本发布）

- 精简并补齐 README、使用指南和 `project-context-governance` USAGE，明确“当前模块 + 命中一跳契约”的日常工作流。
- 补充 Catalog 首次配置、模块刷新、生成验证、提交 Hook 与 CI range 校验示例。
- 能力、Schema 和执行器保持 0.15.0 兼容；发布补丁版本 0.15.1。

## [0.15.0] - 2026-07-19（模块增量目录、一跳上下文与协作防污染）

### Added

- 新增 `.wl-skills-bd/catalog.config.json` 配置契约与模块/项目/上下文 JSON Schema，统一登记模块边界、契约根、源码根、负责人、上下游和提交策略。
- 新增 `catalog plan/apply/show/check`：默认必须指定当前模块，只扫描该模块根目录；其他模块复用固定快照；`--full` 仅允许显式治理任务。
- 新增项目级资源图谱：统计模块、资源、Service/Controller/Mapper、HTTP API、权限码、库集群/表、Flyway 版本与契约关系，并阻断重复身份和多写者污染。
- 新增 `context plan`：当前模块为事实入口，只加载一跳上下游快照；按任务关键词、文件数和字节预算选择上下文，输出扫描证据与 `contextHash`，不扫描关联模块源码。
- 新增模块/项目/提交规范的人读文档生成；所有生成文档带用途、受众、范围、来源、哈希、刷新命令与 `editable: false` 注释头。
- 新增 `commit validate/check/doctor`、版本受控 `.githooks/commit-msg` 和 CI range 校验方案，唯一格式为 `type(scope): 功能点-具体内容`，type/scope 单一来源于 Catalog 配置。
- 新增 `project-context-governance` Skill、standards/27，以及 `wls_be_catalog`、`wls_be_context`、`wls_be_commit` 三个 MCP 工具（12 → 15）。

### Changed

- codegen 在项目启用 Catalog 后强制执行当前模块新鲜度前置检查，并把模块/一跳快照上下文哈希纳入生成 `planHash`；旧上下文计划自动失效。
- standards/18 从不可确定执行的全角示例统一为半角 Conventional Commits 格式，同时保留团队手册要求的类型、模块、功能点和具体内容语义。
- Skills Pipeline 增加生成前“⓪ catalog/context”阶段；design/kit 仍是可选协作输入，不成为 bd 独立闭环的硬依赖。

### Safety and verification

- Catalog 写入采用预览、确认、计划哈希、写前重算、受保护环境护栏、原子写、备份和失败回滚；诊断存在硬冲突时整批零写入。
- 回归覆盖模块隔离、无隐式全量扫描、关联模块变更不影响当前模块计划、一跳快照、文档头、目录过期阻断、codegen 上下文门、全局去重、提交 range 校验和 15 个 MCP Schema。

## [0.14.0] - 2026-07-18（开发手册覆盖、原子写与数据安全闭环）

### Added

- 新增《项目开发手册》覆盖矩阵，将工程/包名、业务子域、CoreEntity/JhServiceImpl、端口、数据库集群和目录粒度追溯到 standards/contracts/templates/rules/tests；分支治理明确不属于 bd 执行范围。
- 新增业务命令 `OperationRequestDTO` 和 DDL 风险/审批/验证报告模板；无命令契约现生成 17 个产物，每个 body 命令再加一个 DTO。
- 新增 `write-guard` 与 `permission-export` 安全写内核，以及 database-safety / write-chain / 完成度突变回归。

### Changed

- Java 实现层改为手册要求的 `{rootPackage}.{module}.controller/service/mapper`；修正成本端口上限为 10399。
- PageDTO 将 `current/size` 收入 POST body 并限制 1~200；字段 `writable` 改为必须显式声明的 fail-closed 策略，状态字段不再可由通用 UpdateDTO 绕过状态机。
- 业务命令统一强类型 body，`patch.fromRequest` 强制请求字段被消费；修复 batch `id/ids`、RequestParam/body、raw List/String 和 `failedIds/failures` 漂移，补齐日期及前置条件类型校验。
- Mapper 生成 `updateAtomic/softDeleteAtomic`，在同一 SQL 中同时约束 `ID + COMPANY_ID + IS_DELETE + REVISION`并递增版本；批量命令从 2N 读写改为去重保序后 1+N 乐观写。
- MySQL 唯一索引修正为 `UNIQUE KEY`；索引引用列必须存在且不重复，唯一索引禁止包含 `IS_DELETE`以避免重复创建/删除冲突。
- ALTER 强制 `phase=expand|contract`：expand 只允许可空 add/显式 widening modify，contract 只允许带 `approvalRef` 的 drop。Flyway 版本全局唯一，已存在 migration 不可改写或 stale 删除。
- codegen/safe-fix/config init/config migrate/config fix/permissions export 统一为 preview → planHash → confirm → 写前重算 → 原子写/备份 → 复验 → 失败回滚；`pre/prod/production` 默认零写入。
- B17/B18 扩展到 Mapper `<delete>`、JDBC/native SQL、`WHERE 1=1/TRUE`、纯动态 WHERE 和写 SQL 租户谓词；doctor 增加原子租户链、乐观写和 BlockAttack 体检。
- 业务命令在真实 `@Test` 同时存在服务调用与断言/验证前保持 draft，注释、方法名或空测试不再伪造 confirmed。
- `prepublishOnly` 升级为 `release:check`，必须同时通过 Node 全量门、Java/Maven 门和 npm pack 审计。已用 `wl-skills-kit` 2.13.0 的真实 strict validator 交叉验证 confirmed/draft 语义。

## [0.13.0] - 2026-07-18（任务驱动精准路由与统一安全写链）

### Added

- 新增 standards/26、`lib/task-router.js`、CLI `task` 与只读 MCP `wls_be_task`，识别 new-service/add-api/add-field/add-business-cmd/fix-bug/refactor/audit/config-op 八类任务。
- B 规则引擎支持任务级规则子集；路由结果同时给出 Skill、Standards、规则与可执行步骤，无匹配时显式失败并保留候选评分证据。
- 任务路由、规则过滤、CLI 禁写和 MCP 闭合 Schema 纳入正式测试入口；MCP 工具数 11 → 12，standards 25 → 26。

### Changed

- 加接口、字段和业务命令统一通过 `wl-contract.json` 的 `customOperations/relations/export/fields/alter` 表达，再进入 codegen validate/plan/apply、保护区、完成度与 strict contract 闭环。
- `task` 明确为只读指挥层：CLI `task --apply` 阻断，MCP 不暴露 `apply`；目标文件仅可作为计划上下文。
- README、AGENTS、内部维护说明及包描述同步 v0.13 的独立边界和安全写语义。

### Removed

- 移除重复的正则/字符串拼接式 patch 写内核。它无法完整表达方法或字段规格，也绕过 planHash、确认、备份、幂等与失败整批回滚，不符合包内统一写操作标准。

### Verification

- 任务路由覆盖八类自然语言、无匹配、候选、规则子集与 CLI/MCP 只读边界。
- 全量 `npm run verify`、Java 8 编译夹具、跨包 strict 契约握手及 `npm pack --dry-run --ignore-scripts` 作为发布检查。

## [0.12.0] - 2026-07-18（配置分层与多环境管理 + 独立闭环与跨包契约统一）

### 重大改进 A：配置分层工程级闭环（config init/migrate/doctor/fix + troubleshoot）

从规范层（v0.11 standards/24）升级到架构层 + 工具层。任何业务项目套用同一套模式：一处声明（env-matrix）、全工程应用、一键体检、一键迁移、一键排查。

#### Added — standards/25（1 条新规范，24→25）

- **25-config-layering.md**：三层分层模型（L1 代码库占位符 / L2 环境变量 / L3 Nacos 动态）+ 4 条铁律 + env-matrix 单一事实源 + 迁移工作流 + L0~L8 体检 + troubleshoot 故障排查 + 工程闭环图

#### Added — 7 个配置模板 + env-matrix schema

- `templates/config/`：bootstrap.yml / application.yml / .env.example / k8s-configmap / k8s-secret / k8s-deployment / logback-spring.xml
- `schemas/env-matrix.schema.json`：环境差异矩阵机器契约

#### Added — 6 个核心 lib（配置引擎）

- **lib/config-layering.js**：YAML 解析（零依赖）/ 明文密码扫描 / 占位符检测 / bootstrap 识别 / K8s 清单识别 / 端口检测
- **lib/env-matrix.js**：矩阵加载 / 校验 / 客户配置提取 / 迁移差异计算 / 迁移计划（planHash）/ 应用 / 迁移报告
- **lib/config-doctor.js**：L0~L8 全链路体检（10 项）+ 可选连通性探测（TCP socket）
- **lib/config-probe.js**：DB/Redis/Nacos TCP 探测 + 地址解析
- **lib/config-init.js**：骨架生成（bootstrap/application/logback + .env.example ×5 + env-matrix + .gitignore）
- **lib/config-fix.js**：明文密码安全修复 + 复扫验证
- **lib/troubleshoot.js**：10 类故障诊断树（DB/Redis/Nacos/K8s/端口/Bean/Profile/Flyway/Feign/MQ）

#### Added — CLI + MCP

- `wl-skills-bd config init/migrate/doctor/fix` + `wl-skills-bd troubleshoot`
- MCP `wls_be_config` + `wls_be_troubleshoot`（9→11 工具）

#### Added — 测试

- `tests/config-layering.test.js`：10 组测试（明文扫描/bootstrap/env-matrix/init/doctor/fix/troubleshoot/probe/端到端）

### 重大改进 B：独立闭环与跨包契约统一

- 内置 `wl-delivery-profile.v1.json`，固定 `jh4j3-openapi3@1.0` 的标准 HTTP 操作、响应外壳、分页与 `revision` 并发约定；项目可独立安装，发现同名项目 Profile 时会做漂移校验。
- 协作产物统一为 `wl-api-contract`，带 `protocolVersion/source.profile/completion`，可与 `wl-skills-kit` 在没有 `wl-skills-design` 的情况下直接严格核对。
- 业务骨架完成度：export、关联查询及无确定性 patch 的自定义操作标记为 draft；`inspectImplementation` 同时验证 Service 已去除占位实现且 ServiceTest 存在操作证据。
- `codegen apply --require-complete` / MCP `requireComplete` 生产就绪门；draft 契约整批零写入。
- codegen 写入事务日志与失败全量恢复，覆盖源文件、状态文件、临时文件和新建目录。
- Java 8 扩展编译夹具覆盖 PATCH、body ID、无 ID 骨架、批量、关联与导出。

### Changed

- 自定义操作按 `path/body/none/batch` 生成可编译签名；前置条件改为类型安全 `Objects.equals`，批量操作限制 1000 条并采用全有或全无事务语义。
- `contract diff --strict` 同时阻断前后端 draft、未决问题、结构差异及降级文本校验 warning；legacy `api.md` 仅保留非严格兼容路径。
- MCP 与 CLI 复用相同 delivery profile、完成度证据和 strict 语义；MCP 生产写授权参数真正传入 codegen 核心。
- standards 总数 24 → 25，MCP 工具数 9 → 11。

### Verification

- 标准 CRUD 与全部扩展产物通过真实 Java 8 编译。
- 契约、协作、事务回滚、CLI、MCP、生产护栏与扩展场景均有回归测试。
- 配置分层 10 组测试覆盖 init/migrate/doctor/fix/troubleshoot/probe/端到端。
- `npm run verify`、`npm run verify:quality-maven` 与 `npm pack --dry-run --ignore-scripts` 作为发布检查。

### 工程闭环（配置分层，不是壳子）

```
config init          → 生成标准骨架（L1 占位符 + L2 .env.example + env-matrix）
       ↓
env-matrix.yml       → 声明客户差异（单一事实源）
       ↓
config migrate       → 切换客户（生成 L2 .env + K8s + 迁移报告）
       ↓
config doctor        → L0~L8 全链路体检（每项失败给"下一步查哪里"）
       ↓
config doctor --probe→ 连通性探测（DB/Redis/Nacos TCP 可达）
       ↓
config fix           → 安全修复（明文密码改占位符 + 复扫验证）
       ↓
troubleshoot "<错误>"→ 故障关键字诊断（错误码→排查步骤）
```

### Notes

- 边界：bd 不持有 Nacos 写凭据，不读 Nacos 服务端配置内容（SRE 域）；只校验 bootstrap.yml 声明的 dataId 模式合规
- 连通性探测用 TCP socket（端口可达性），不执行 SQL/PING，不持有真实凭据
- env-matrix 的 secrets 只写占位（"K8s Secret: xxx/key"），实际值在 K8s Secret/.env，不进 git
- 内置 10 类故障诊断树覆盖 mdm-service 实证的高频错误

## [0.11.0] - 2026-07-18 (稳定性与多环境护栏：定时任务/分支模型/Swagger 迁移/B20~B23)

### 重大改进：基于 mdm-service 实证反例补齐剩余事故源 + 后端多环境标准化

调研 mdm-service 实际代码发现 4 类未覆盖事故源（长锁无 watchdog、事务内 MQ/HTTP、HttpUtil 无超时、Swagger 2/3 混用）+ 巨型 Service（MdmModelService 3824 行、注入依赖过多）+ 空壳定时任务。同时把《项目开发手册》的多环境/分支/数据库集群约定固化为可执行规范，补齐后端多环境能力（对标前端 wl-skills-kit）。

### Added — 2 条新 standards（22→24）

- **23-scheduled-task.md**：定时任务规范。@Scheduled + cron 外部化、@SchedulerLock（ShedLock）多实例防重复、幂等性（增量/状态机/事件ID 去重）、超时熔断（业务超时 < 锁超时）、失败重试（≤3 次指数退避，Spring Retry）、日志监控、与事务/MQ 关系
- **24-multi-env.md**：多环境与分支模型规范。5 环境矩阵（dev/sit/uat/pre/prod）+ Nacos namespace 隔离、5 级分支（master/pre/uat/slt/dev + dev-{模块}-{工号}）、环境配置标准结构（bootstrap.yml + nacos dataId）、数据库集群归属（cx/non_cx/pt）、端口分配、配置加密（禁明文密码）、生产只读护栏、CI/CD 流水线模板

### Added — be-rules B20~B23（4 条新规则）+ B14 扩展

| 规则 | 标准 | 检测 | severity |
|---|---|---|---|
| B14（扩展）| 20 §3 | setIfAbsent + 长 TTL（>10min）缺 watchdog 续期 | error |
| B20 | 10 §7 + 22 | @Transactional 方法内调 MQ（rocketMQTemplate/kafkaTemplate/amqpTemplate）/ HTTP（HttpUtil/RestTemplate/HttpClient/WebClient）| error |
| B21 | 22 §1 | HttpUtil/RestTemplate 裸调用无 timeout | warn |
| B22 | 13 §8.2 | Swagger 2/OpenAPI 3 混用：同类 @Api+@Tag → error；纯 Swagger 2 → warn | warn |
| B23 | 02 + 19 | Service 注入依赖 > 10（巨型类信号）| warn |

### Added — contract schema + 验证

- contract schema 新增 `environment`（dev/sit/uat/pre/prod）和 `dbCluster`（cx/non_cx/pt）可选字段
- contract.js 验证新字段；buildContext 透传

### Added — 生产护栏运行时强制

- codegen.applyPlan 在 `environment=prod` 时默认阻断，返回 `production-write-guard` reason + 零写入
- 显式授权：`WL_ALLOW_PRODUCTION_WRITES=true`（CLI）或 `allowProductionWrites=true`（MCP）
- 识别优先级：contract.environment > WL_PROJECT_ENV > SPRING_PROFILES_ACTIVE > config.json > bootstrap.yml
- 新增 `detectEnvironment` / `isProductionGuardBlocked` 函数

### Added — doctor 环境体检

- 新增 `env-bootstrap` 检测项：bootstrap.yml 存在性 + profiles.active
- 新增 `env-config` 检测项：profile 白名单（dev/sit/uat/pre/prod）+ 生产授权状态
- 新增 `env-dbcluster` 检测项：datasource profile 识别 dbCluster（cx/non_cx/pt）
- 新增 `checkEnvironment` / `readBootstrapProfile` / `detectDbClusterFromDatasource` 函数

### Added — 扩展现有 standards

- **02** 业务中心×端口×数据库集群完整映射表（sale 10000-10099 cx / quality 10100-10199 cx / produce 10200-10299 cx / cost 10300-10339 cx / safe 10400-10499 non_cx / equipment 10500-10599 iot / env 10600-10699 non_cx / logistics 10700-10799 non_cx / energy 10800-10899 non_cx / mdm pt）
- **12** 数据库集群归属（cx/non_cx/pt → hx_cxdb1/hx_non_cxdb2/hx_ptdb）+ datasource profile 命名约定
- **13** §8.1 Apifox 集成最佳实践（springdoc 自动生成 OpenAPI 3 JSON，Apifox 定时同步）+ §8.2 Swagger 2/OpenAPI 3 并存策略（新代码 OpenAPI 3，存量允许保留，混用禁止）
- **18** §0 分支模型（master/pre/uat/slt/dev + dev-{模块}-{工号}）+ 合并铁律

### Added — 测试

- `codegen-production-guard.test.js`：environment 识别优先级、prod 默认阻断、显式授权、零写入全链路
- `be-rules.test.js` B20~B23 fixture（事务内 MQ/HTTP、HttpUtil 无超时、Swagger 混用、巨型 Service 注入）

### Changed

- standards 总数 22 → 24，版本 v0.10.0 → v0.11.0
- be-rules B 规则总数 19 → 23
- README 补 v0.11 能力表、稳定性与多环境护栏段、Swagger 与 Apifox 段
- AGENTS.md 加 v0.11 约束（长锁/事务内 MQ·HTTP/Swagger 选型/分支模型）
- catalog.json 补全 B20~B23 规则定义
- package.json test script 加 codegen-production-guard.test.js

### Verification

- `npm run verify`：版本/计数/Schema/规则/16 个测试套件全绿
- `be-rules.test.js`：B1~B23 全覆盖（B14 扩展 + B20~B23 新增 6 个 fixture）
- `codegen-production-guard.test.js`：生产护栏 5 个场景全绿
- `verify-version`：B 规则计数校验 19→23，standards 22→24

### Notes

- Swagger 2/OpenAPI 3 并存策略基于 mdm-service 全工程 Swagger 2 的现实：不强制迁移，新代码统一 OpenAPI 3 + Apifox 自动同步
- 生产护栏当前实现在 codegen.applyPlan 层，后续可扩展到 safe-fix.applyFixPlan 和 permissions export
- mdm-service 实证反例（MdmDataDistributeService 长 TTL 锁、saveDataBatch 事务内发 MQ、HttpUtil 无超时、MdmModelService 3824 行）均已纳入机器兜底
- 全部基于官方依据：Spring @Scheduled/ShedLock、Spring Cloud OpenFeign、Spring Retry、springdoc-openapi、Apifox、《项目开发手册》

---

## [0.10.0] - 2026-07-18 (数据安全与稳定性护栏：Redis/敏感写/限流熔断)

### 重大改进：把生产事故源从口头规范固化为机器兜底层

补齐数据库/缓存/外部调用的安全边界，避免 AI 生成代码踩 Redis OOM、分布式锁超卖、误删全表、级联雪崩等血泪事故。

### Added — 3 条新 standards（19→22）

- **20-redis-cache.md**：Key 命名（`{env}:{module}:{biz}:{id}`）、TTL 强制、Redisson RLock 分布式锁、缓存三大问题（穿透/击穿/雪崩）、大 Key 禁令、Jackson 序列化（禁 JDK）、禁用命令（KEYS \*/FLUSHDB/FLUSHALL）、Pipeline、Cache-Aside + 双删一致性
- **21-sensitive-write.md**：写操作分级（L1 自由/L2 审批/L3 双签/L4 DBA+窗口）、批量分批（≤1000）、物理删除/TRUNCATE/DROP 禁令、全表 UPDATE/DELETE 禁令、幂等键（Redis + DB 唯一索引）、跨库写（事务消息/Seata）、灰度发布（Feature Flag）、生产只读护栏、敏感操作二次确认、操作审计
- **22-resilience.md**：Feign 超时（连接 2s/读 5s）、重试（≤3 次指数退避，写操作禁重试）、熔断（CircuitBreaker 错误率/慢调用阈值）、舱壁隔离（独立线程池）、限流（Sentinel/Resilience4j）、降级（fallbackFactory 带异常）

### Added — be-rules B13~B19（机器兜底，7 条新规则）

| 规则 | 标准 | 检测 | severity |
|---|---|---|---|
| B13 | 20 | RedisTemplate set/setIfAbsent 缺 TTL | error |
| B14 | 20 | setnx/setIfAbsent 自实现锁（非 Redisson RLock）| error |
| B15 | 20 | KEYS \* / FLUSHDB / FLUSHALL | error |
| B16 | 20 | JdkSerializationRedisSerializer | warn |
| B17 | 21 | deleteBatchIds/deleteById/TRUNCATE/DROP TABLE | error |
| B18 | 21 | Mapper XML update/delete 缺 WHERE | error |
| B19 | 21 | saveBatch 显式批量 > 1000 | warn |

### Added — ops/data-safety Skill

- SKILL.md + USAGE.md：覆盖 Redis/敏感写/限流熔断的场景对照、生产护栏速查、错误码速查
- 触发词：Redis/缓存/分布式锁/批量删除/物理删/熔断/限流/Feign 超时/生产只读/二次确认

### Added — 扩展现有 standards

- **11-security-permission.md §9**：敏感操作二次确认（重置密码/批量删除/数据导出/角色权限变更/生产配置修改）
- **12-database-ddl.md §8.5**：生产 DDL/DML 敏感操作 8 阶段审批流程（申请→评审→DBA 双签→备份→窗口执行→验证→监控→回滚演练）

### Changed

- standards 总数 19 → 22，版本 v0.9.0 → v0.10.0
- be-rules B 规则总数 12 → 19
- skills 总数 10 → 11（+data-safety）
- catalog.json 补全 B13~B19 规则定义
- AGENTS.md 加 v0.10 强制约束 10/11/12（Redis/敏感写/生产护栏）
- standards/index.md 新增任务类型 I（数据安全与稳定性审计）
- be-rules.js 模块导出新检查函数，便于单元复用

### Verification

- `npm run verify`：版本/计数/Schema/规则/15 个测试套件全绿
- `be-rules.test.js`：B1~B19 全覆盖（B13~B19 新增 8 个 fixture 测试）
- `verify-version`：B 规则计数校验 12→19

### Notes

- B13~B19 当前**不在 safe-fix 自动修复白名单**（语义敏感，需人工），但全部进入 validate 检测
- 生产只读护栏当前以规范形式落地；后续可升级为 codegen/MCP 的运行时检查（识别 `environment=production`）
- 三大规范全部基于官方依据：Redis 官方、Redisson 官方、Spring Data Redis、Spring Cloud OpenFeign、Resilience4j、OWASP、Google SRE

---

## [0.9.0] - 2026-07-18 (业务命令/主从关联/ALTER/索引/导出/kit 兼容)

### 重大改进：从"单实体 CRUD 生成器"升级为"业务后端生成器"

补齐真实业务开发的四类高频场景：业务命令/状态机、主从关联、ALTER TABLE、自定义索引；同时打通前后端协议摩擦（kit api.md 兼容校验）和权限码搬运自动化。

### Added — Schema 扩展（contract.schema.json）

- `customOperations[]`：业务命令/状态机。声明 name/method/path/permission/kind（stateTransition/command/batch）、preconditions（六种操作符）、patch、requestFields；codegen 按四段式机械生成 Service 方法（校验存在→校验前置→构造 patch→updateById），Controller 生成对应 @PreAuthorize + @Operation 方法
- `relations[]`：一对多主从关联。声明 detailEntity/detailContractId/joinColumn/cascadeSoftDelete/exposeQuery；主 Controller 生成 queryXxxByParentId 接口，manifest 暴露关联契约
- `alter{}`：ALTER TABLE。声明 version/rollbackStrategy/verificationSql/operations（add/drop/modify）；codegen 生成 ALTER 迁移 SQL（不再生成 CREATE TABLE），Rollback.md 含 Expand-Contract 阶段标注
- `indexes[]`：自定义索引。声明 name/columns/unique；codegen 渲染到 migration（COMPANY_ID+IS_DELETE 联合索引仍默认生成）
- `api.permissions.export`（可选）：声明后生成 GET /export Controller + Service 骨架
- `externalId`（顶层/字段/操作/关联）：跨包稳定 ID 桥接 wl-skills-design 的 design-model.json

### Added — 协作契约扩展（collaboration.js）

- manifest 暴露 `extensionOperations`（export + customOperations）、`relations`、对应 models 与 apiConfig
- api.md 渲染扩展操作行、主从关联段
- compareManifest/compareOpenApi/comparePermissions 支持扩展操作核对
- `compareKitApiMarkdown`：核对 wl-skills-kit 风格 api.md（存在性核对 externalBasePath/详情字段/业务命令/关联实体；命名规范差异不阻断，业务命令缺失报 C405 error）
- `buildPermissionInventory` + `renderPermissionInventoryMarkdown`：把后端 5 类权限码 + export + customOperations 权限码导出为 kit `SYS_PERMISSION_INFO.md` 片段

### Added — MCP 工具（registry.js，7→9）

- `wls_be_db_preview`：只读预览契约生成的 DDL（CREATE 或 ALTER）、Expand-Contract 阶段标注与自定义索引，不写盘
- `wls_be_export_permissions`：从后端契约导出权限码为 kit SYS_PERMISSION_INFO.md 片段；默认预览，apply 必须传 confirmApply

### Added — CLI 命令

- `wl-skills-bd db preview <contract>`：只读 DDL 预览
- `wl-skills-bd permissions export <contract> --output <path>`：导出权限码
- `wl-skills-bd contract diff --kitApiMd <path>`：kit 风格 api.md 兼容校验

### Added — 规则与体检

- B5 写方法前缀扩展：识别 release/close/cancel/withdraw/convert/changeStatus/publish/archive/restore/print/send/reset/assign/transfer/lock/unlock/audit/verify（覆盖 kit api-contract 全部业务命令命名）
- doctor 新增 `contract-coverage` 检测项：扫描 CoreEntity 子类与 codegen 状态文件比对，报告无契约 Entity
- Mapper.xml 新增 `<select id="queryById">` 段（ID+租户安全查询），Mapper.java 新增 queryById 方法声明与 VO import
- Rollback.md 模板适配 ALTER 场景（变更类型 + Expand-Contract 阶段）

### Added — 示例契约

- `sale-order-master.contract.json`：完整扩展能力示例（indexes/customOperations stateTransition+command+batch/relations/export/externalId）
- `sale-order-master-alter.contract.json`：ALTER 场景示例（add+modify + 索引）

### Added — 测试

- `tests/contract-extensions.test.js`：全链路验证 indexes/customOperations/relations/export/alter/externalId + kit api.md 兼容 + 权限导出 + 确定性

### Changed

- profile `apiDefaults.export` 声明为可选（声明后 codegen 生成 export 接口）
- `license` MIT → UNLICENSED（与其他三包对齐，内部资产）
- package.json description 同步 v0.9.0 能力
- README/CHANGELOG/_registry/standards/SKILL.md/guides 同步扩展能力

### Verification

- `npm run verify`：版本/计数/Schema/规则/15 个测试套件（含 contract-extensions）
- `npm run verify:quality-maven`：Java 8 真实 Maven 生命周期
- Java 8 编译夹具：扩展模板（含 customOperations 四段式/relations/export）通过 javac 真编译

### Notes

- 字典后端不参与：字典是平台接口能力，前端 wl-skills-kit 的 dict-sync MCP 直接调用接口批量生成；后端 Entity 里字典字段就是普通 String
- 主从关联的从表用独立 contract 描述；主 contract 只声明 relations 引用，codegen 在主表生成 queryXxxByParentId 接口骨架，实际转发逻辑由业务注入从表 Service 补齐
- customOperations 的批量操作返回 `{successCount, failureCount, failedIds}` 标准结构，前端可统一处理

---

## [0.8.0] - 2026-07-18 (后端工程闭环全面升级)

### Added

- 受管资产生命周期：`init/update/diff/check/clean`、manifest、冲突零写入、覆盖前备份与安装漂移检查；
- 严格资源契约、兼容性 Profile 与 JSON Schema；契约驱动生成 14 个模板产物和 2 个前后端协作产物；
- codegen `validate/plan/apply`，SHA-256 `planHash`、显式确认、写前重算、冲突保护、备份与状态管理；
- 前端 `wl-backend-contract`、运行时 OpenAPI 3、权限清单的 `contract show/diff` 闭环；
- B1~B12 多格式报告（text/JSON/Markdown/SARIF）和规则配置/抑制证据；
- B3/B5 条件安全修复：预览、哈希确认、漂移零写入、备份、失败恢复、复扫与 FIX_BE 报告；
- 7 个 MCP 工具，严格入参 Schema、工作区路径边界、串行写调用和 CLI/MCP 单核心实现；
- JaCoCo 0.8.15 J8 类级门禁：Service 行/分支 70%/60%，Controller 行 50%；
- Node 22/24、Windows/Ubuntu CI，Java 8 真实 Maven 质量夹具与 npm 发布内容检查；
- `.editorconfig`、`.gitattributes` 和本地状态忽略规则。

### Changed

- 默认生成基线收敛为 `jh4j3-openapi3`：Java 8、Spring Boot 2、jh4j-cloud 3.1、直接 Service、显式租户、软删和 revision 乐观锁；
- Entity/CoreEntity 边界改为真实六个基础字段，`isDelete/revision` 显式声明；请求拆为 CreateDTO/UpdateDTO/PageDTO，响应拆为 VO/PageVO；
- Java 质量 Profile 在 Java 8 上真实固定 ArchUnit、Checkstyle、PMD 7、SpotBugs、Spotless 与 JaCoCo；P3C/PMD 6 隔离为非阻断 legacy profile；
- README、19 条 standards、Skill registry/pipeline、架构 ADR、规则覆盖矩阵、MCP/生成/协作指南按实际实现统一重写；
- 环境、复杂迁移、业务测试等未实现执行器的能力继续标记骨架，并移除虚构 CLI、自动备份/应用承诺和示例明文凭据；
- Node 最低版本升级到 22，发版检查必须包含完整包自检和 Java 8 真实 Maven 门禁。

### Removed

- 旧 DTO 单模板、伪 XML Maven 片段、PMD 7 与 P3C 混装配置，以及对 Springfox 批量自动迁移等不安全承诺；
- 生成链路中的 Controller→Mapper、请求租户字段、物理删除、缺 revision、DDL 自动执行/自动回滚等错误模式。

### Verification

- `npm run verify`；
- `npm run verify:quality-maven`（Java 8 / Maven 3.9.11 真实执行）；
- `npm pack --dry-run --ignore-scripts` 发布物审计。

---

## [0.7.1] - 2026-07-18 (全 Skill USAGE + README 重写 + 冗余清理)

### Fixed — README 严重滞后（停在 v0.5.0 描述）
- `README.md`：从 276 行重写到 280+ 行，反映 v0.7.0 真实能力：
  - 能力总览：18 条 → **19 条（含设计规约）**；B1~B8 → **B1~B12**；J1~J5 → **J1~J7**（加 P3C J6 + Knife4j J7）
  - 补：在线接口文档（Knife4j）/ 设计规约 / codegen-workflow 闭环 / 方法论原则（官方最佳实践 > 团队 > 存量）
  - 修正：npm 徽章 0.4.0 → 0.7.1；防胶水三层 → 四层保障

### Added — 全 10 Skill 配 USAGE.md（之前仅 4/10）
- 新增 6 个 USAGE.md：convention-audit-be / code-fix-be / api-design-be / business-doc-extract-be / db-migration / unit-test-gen
- 每个 USAGE 含：触发词 + 3 典型场景 + FAQ
- USAGE 覆盖率：4/10 → **10/10**

### Changed — USAGE 校验范围扩大
- `lint-skills.js`：USAGE 校验从 3 个 codegen 扩到**全部有 SKILL.md 的 Skill**（防未来遗漏）

### Removed — 冗余文件清理
- 删除 `docs/` 目录（3 文件 500+ 行）：analysis-report.md / env-standard-analysis.md / roadmap.md
  - 全是 v0.0.x 骨架期历史报告，内容已被 CHANGELOG/guides 完全取代且严重过时（roadmap 停在"17 条"实际已 19 条）
  - 不在 npm files（不发布但污染仓库）
  - 同源职责已由 `kit-internal/`（仓库内部）+ `files/.github/guides/`（产出）覆盖

### Changed
- 版本 0.7.0 → 0.7.1

### Notes
- 解决用户反馈：USAGE 覆盖不全 + README 过时 + docs 冗余
- 验证：`npm run verify` 全绿（含全部 10 Skill USAGE 校验）

---

## [0.7.0] - 2026-07-18 (在线接口文档标配 · OpenAPI 3 + Knife4j)

### 重大改进：API 文档从可选骨架升级为必遵标配 + 现代技术栈

参考生产项目（Knife4j+OpenAPI3 方案选型优雅），把 bd 的 13 从 47 行骨架 + Springfox 2 升级为落地 + OpenAPI 3 + Knife4j。启动后访问 /doc.html 按模块分组的中文接口文档。Springfox 2 已停更（2022 起），OpenAPI 3 是业界/官方现代标准。

### Changed — 13 规范重写（落地，技术栈升级）
- `13-api-doc-swagger.md`：47 行骨架 → 200+ 行落地
  - 技术栈：Springfox 2 → **OpenAPI 3 + Knife4j 4.4.0**（依据 Knife4j/springdoc 官方）
  - 强制度：🟡 建议 → **🔴 必遵**（接口文档是前后端契约载体）
  - 注解迁移对照表（@Api→@Tag / @ApiOperation→@Operation / @ApiModelProperty→@Schema）
  - Knife4j yml 声明式配置 + ★ 按模块分组（group-configs）+ 生产环境关闭
  - 反面教材：参考项目乱码/@Parameter 缺失/Controller 直连 Mapper

### Changed — 5 个模板迁移 OpenAPI 3（breaking change，用户确认）
- `Controller.java.tmpl`：@Api/@ApiOperation/@ApiImplicitParams/@ApiIgnore → @Tag/@Operation/@Parameters/@Parameter(hidden)
- `Entity.java.tmpl`：@ApiModel/@ApiModelProperty → @Schema
- `DTO.java.tmpl` / `PageDTO.java.tmpl` / `VO.java.tmpl`：同上
- 存量项目由 code-fix-be 辅助批量迁移

### Added — Knife4j 接入模板（J7）
- 新增 `java-quality/knife4j/`：README（接入指南）+ `knife4j-config.yml.tmpl`（按模块分组配置）
- `pom-plugins.xml` 加 Knife4j 依赖段 + 工具版本表
- `maven-snippets/README.md` 速查表加 Knife4j

### Changed — be-rules B2 兼容双注解
- B2 现在同时认 `@Operation`（OpenAPI 3 新）+ `@ApiOperation`（Springfox 2 存量兼容）
- 存量项目用旧注解不告警，新项目用新注解不告警

### Changed
- `rule-coverage.md`：加 J7 + standards/13 执行器映射
- `index.md`：13 状态 🟡骨架 → ✅落地；强制度 建议 → 必遵
- `lint-skills.js`：J7 → knife4j 目录映射
- 版本 0.6.0 → 0.7.0

### Notes
- 参考项目评估：方案选型优雅（Knife4j+OpenAPI3+yml），代码实现不健壮（跨层/乱码/参数缺），bd 学方案不照抄代码
- Apifox 同步：本轮留 roadmap（OpenAPI 3 JSON 导出能力已具备，团队 Apifox 平台就绪后做 CLI 自动同步）
- 验证：`npm run verify` 全绿

---

## [0.6.0] - 2026-07-17 (注释闭环 · 修复"规范要求 vs 模板实现"自相矛盾)

### Fixed — 🔴 核心 bug：模板零方法注释 vs 规范要求 Javadoc
之前 8 个 templates 全部缺方法 Javadoc，但 15 R24 要求"public 方法必须有 Javadoc"——AI 跟模板填空生成的代码反而违规（自己挖坑自己跳）。本次修复。

### Changed — 8 个 templates 补全合规注释（按"必要注释"原则）
- `Controller.java.tmpl`：类 Javadoc 补 @since + 职责（方法保留 @ApiOperation，不加重复 Javadoc）
- `Service.java.tmpl`：★ 每个方法补完整 Javadoc（业务规则 + @param/@return/@throws + 软删除说明）—— 业务核心，注释最重要
- `Mapper.java.tmpl`：接口方法补 @param/@return（黄山版 R24：接口方法强制）+ 常量注释
- `Entity/DTO/VO/PageDTO.java.tmpl`：类 Javadoc 补 @since + 职责说明（纯数据类字段已有 @ApiModelProperty，不重复）
- `Mapper.xml.tmpl`：补文件级注释（namespace 规则 + 三大硬约束提醒）

### Changed — 注释规范单一数据源（消除三处重复）
- `15 R23/R24`：删除正文，改为引用 `19 §9`（避免 15 R23/R24 + 19 §9 + Checkstyle 三处重复维护）
- `19 §9`：升级为权威定义，补 9.1 强制度分级表（接口/抽象强制 + 业务方法强制 + 纯数据类豁免 + Controller @ApiOperation 豁免）+ 9.3 模板已内置声明

### Added — be-rules B12（必要注释机器兜底）
- `lib/be-rules.js` 新增 B12：业务方法（save/update/delete/状态变更）+ Mapper 接口方法 缺 Javadoc → warn
- 豁免：Controller（@ApiOperation 已覆盖）、getter/setter、纯数据类字段
- 测试：2 个新用例（检出 + 不误报）全过

### Changed
- `AGENTS.md`：B1~B8 → B1~B12
- `rule-coverage.md`：B12 + 15 Javadoc 执行器更新
- 版本 0.5.1 → 0.6.0

### Notes
- "必要注释"边界（Clean Code + 黄山版平衡）：
  - 🔴 强制：类 Javadoc / 接口方法 / 复杂业务方法
  - 🟡 建议：普通 public 方法（签名自解释可豁免）/ Controller（@ApiOperation 已说明）
  - ⚪ 豁免：getter/setter / 纯数据类字段（用 @ApiModelProperty）
- 解决用户反馈："规范说了但模板没做"的自相矛盾；现在 codegen 读模板填空即合规

---

## [0.5.1] - 2026-07-17 (一致性修正 + codegen 闭环权威文档)

### Fixed — registry/pipeline 状态滞后（v0.4~v0.5 补厚后状态未同步）
- `_registry.md`：6 个 Skill 状态 🟡骨架 → ✅落地（entity/service/mapper-codegen + convention-audit-be + code-fix-be + standard-env-config-be）；补落地度统计行
- `_pipeline.md`：标题 v0.0.1 → v0.1；阶段总览补 api.md 唯一输入 + ⑧⑨ 计数同步 19 条；④ 团队基线无独立接口澄清；③④⑤ 加 templates/self_check 机制；⑧ 执行器清单补全（J1~J6）；⑨ 复扫闭环细化

### Added — codegen 闭环权威文档
- 新增 `guides/codegen-workflow.md`：定义三个闭环
  - **闭环一·生成顺序**：api.md → ②~⑦（8 阶段严格不跳级）+ 一个菜单 14 文件清单 + 每阶段防胶水机制
  - **闭环二·验证**：三层兜底（生成后 validate B1~B11 → 全量审计 19 条+J1~J6 → CI mvn verify）+ 19 规范×7 执行器覆盖矩阵
  - **闭环三·修复**：code-fix-be 强制复扫流程 + 复扫报告格式 + 修复对照表 + 修复禁区
- copilot-instructions 主入口加"生成代码必读"段，引用闭环文档

### Changed
- 版本 0.5.0 → 0.5.1

### Notes
- 解决用户反馈：明确"生成顺序/如何验证/如何修复"三闭环，让 codegen 不再是零散动作而是确定流程
- 一致性：registry 状态与各 SKILL.md frontmatter 严格对齐（lint-skills 已校验，未来保持）

---

## [0.5.0] - 2026-07-17 (设计规约 + 社区最佳实践闭环)

### 重大改进：从"语法级"升级到"设计级"代码质量管控

补齐代码质量第二根支柱——社区最佳实践 + 设计原则。解决 bd 只能查出语法问题（SELECT *、缺注解），查不出设计问题（上帝类、长方法、过度设计）的洼地。这是"生成代码能维护 vs 能用"的分水岭。

### Added — P0-A 设计规约（新章节，依据黄山版第七章 + SOLID + Clean Code + Refactoring）
- 新增 `standards/19-design.md`（260 行）：
  - 三大设计总则：YAGNI / KISS / DRY（黄山版第七章）
  - SOLID 五原则（含生成代码应用示例 + mdm-service 3373 行上帝类反面）
  - 长度红线：方法≤50行 / 类≤500行 / 圈复杂度≤10 / 参数≤5（be-rules B9/B10/B11 兜底）
  - 何时抽象/封装：三次法则 + 封装决策表（解决"该不该封装"高频疑问）
  - 设计模式适用清单：策略/模板方法/建造者等"何时用"（非罗列 23 种）
  - 反模式清单：上帝类/长方法/霰弹式修改/Feature Envy/过度设计
  - 方法/类设计规范 + 注释设计（与 15 联动）
  - AI 生成代码检查清单（10 项）

### Added — P0-B 阿里 P3C 规则集（J6 · 社区最佳实践机器卡控）
- 新增 `pmd/ali-p3c-ruleset.xml`：引用 `com.alibaba.p3c:p3c-pmd:2.1.1`（黄山版 54 条规则）
  - 覆盖 10 个规则集：ali-naming/ali-constant/ali-oop/ali-set/ali-concurrent/ali-flowcontrol/ali-exception/ali-comment/ali-other/ali-orm
  - 设计级补充：ExcessiveMethodLength(80) / ExcessiveParameterList(5) / CyclomaticComplexity(10) / ExcessiveClassLength(500) / GodClass
- 更新 `pmd/README.md`：两套规则集并存（PMD 官方 + P3C）+ 54 条分类速查
- 更新 `maven-snippets/pom-plugins.xml`：PMD 段加 p3c-pmd 依赖 + 双 ruleset 配置

### Added — P1 be-rules 扩 B9/B10/B11（设计级机器兜底，19 §3）
- `lib/be-rules.js` 新增 3 条规则（对所有 .java 触发）：
  - B9 类长度 >500 行（error，上帝类检测）
  - B10 方法长度 >80 行（warn/error）
  - B11 圈复杂度 >10（warn/error）
- 测试覆盖：4 个新用例（B9 检出+不误报 / B10 / B11）全过
- ★ 实战验证：对 mdm-service 跑出 B9 命中 2 个上帝类 + B10 命中 11 个长方法 + B11 命中 25 个高复杂度方法（含 MdmModelService 3373 行、saveModel 129 行/复杂度 17）

### Added — P1 Javadoc 规范（15 R23/R24 + Checkstyle）
- `15-code-quality.md` 新增 R23（类 Javadoc @author）/ R24（public 方法 Javadoc @param/@return/@throws）
- `checkstyle.xml` 加 JavadocType + JavadocMethod 检查

### Changed
- `rule-coverage.md`：新增 J6（P3C）+ B9/B10/B11 + 19 设计规约映射
- `index.md`：18→19 条；任务类型 E 审计必读含 19
- `copilot-instructions.md`：版本同步 v0.5.0 + 19 条
- `lint-skills.js`：J6→pmd 目录映射
- 版本 0.4.2 → 0.5.0

### Notes
- 代码质量双支柱完整：① 团队规范（02~18 语法/分层）② 社区最佳实践 + 设计（19 + P3C）
- 执行器覆盖：be-rules B9/B10/B11（regex 即时）+ Checkstyle Javadoc + P3C J6（CI 硬卡）
- 验证：`npm run verify` 全绿；11 个 be-rules 测试全过；mdm-service 实战命中上帝类/长方法/高复杂度
- 后续可选：14 单测骨架补厚 / SKILL.md 全部补厚 / MCP 扩 db-migration 工具

---

## [0.4.2] - 2026-07-17 (规范方法论修正 · 官方/社区最佳实践为基线)

### 重大修正：纠正"对齐存量代码"的方法论错误

之前 v0.4/v0.4.1 把 mdm-service（AI 生成的存量代码）当"权威基线"对齐，是本末倒置——存量代码有多租户硬编码"1"、SQL 注入、上帝类(3373行)、漏事务+混Feign 等严重缺陷。规范应高于存量代码。本次改为以**官方/社区最佳实践**为唯一基线，mdm-service 的缺陷明确标注为**反面教材**。

### Changed — 5 条规范依据权威来源重写
- `11-security`：依据 **MyBatis-Plus 官方多租户(TenantLineHandler 插件)** 重写 COMPANY_ID 部分；**明确禁止硬编码**（mdm-service 硬编码"1"致多租户失效，标注为反面教材）
- `10-transaction`：依据 **Spring 官方文档**（已核实 self-invocation/方法可见性/Propagation）；标注 mdm-service 漏事务+混Feign 反面
- `08-exception`：依据 **Effective Java(异常章节) + Spring @ControllerAdvice**；标注 dingtalk 22 处 RuntimeException 反面
- `09-logging`：依据 **SLF4J 官方(参数化日志) + OWASP 日志安全**
- `01-toolchain`：改为团队 jh4j-cloud 技术栈要求（非对齐存量项目）

### Changed — 清理"倒推/对齐存量代码"的错误指示（方法论）
- `_registry.md` / `guides/usage.md` / `guides/architecture.md`：删"按 mdm-service 真实代码风格倒推/为准"
- `templates/README.md`：模板来源改为"官方/社区最佳实践 + 团队 standards"
- `04/05/06` 标题：去"基于 mdm-service 真实代码"，改"依据 Spring/MyBatis-Plus 官方"
- `02/03`：基线措辞改 jh4j-cloud 体系 + Java 官方约定
- `api-design-be/SKILL.md`：按 Spring MVC 官方 RESTful 约定生成（非存量风格）
- `copilot-instructions.md`：新增方法论原则段——不对齐存量项目，存量偏离应整改

### Changed
- `verify-version.js`：README 徽章正则兼容新格式
- 版本 0.4.1 → 0.4.2

### Notes
- 修正后规范层方法论：官方/社区最佳实践 > 团队 standards > 存量代码（存量仅作反面教材或整改对象）
- 验证：`npm run verify` 全绿；危险措辞 grep 清零

---

## [0.4.1] - 2026-07-17 (5 条必遵规范骨架补厚)

### 重大改进：规范层从 11 落地/7 骨架 → 16 落地/2 骨架（建议级）

解决"🔴 必遵却只有 40-60 行骨架"的自相矛盾。5 条必遵规范全部补厚到落地深度，每条含决策表/模板/正反例，并对齐 mdm-service 真实代码。

### Changed — 5 条必遵规范补厚
- `01-toolchain`：35→70 行。补数据库类型探测决策表(Oracle/MySQL) + 7 项检测清单 + doctor 联动
- `08-exception`：47→130 行。补 ServiceAssert 全方法(isNotNull/isNull/isTrue/hasText，对齐 mdm-service 233 处用法) + 业务码字典分段 + ServiceException 模板 + 全局 Advice 完整版 + 正反例
- `09-logging`：40→110 行。补脱敏正则表(手机/身份证/银行卡) + traceId/MDC 复制 + 级别决策表 + 大字段截断
- `10-transaction`：60→140 行。补回滚矩阵(checked/RuntimeException) + 传播行为场景表(REQUIRED/REQUIRES_NEW) + self-injection 三方案 + 5 个禁止陷阱(Feign/MQ/自调用/吞异常/长事务) + 对齐 mdm-service 76 处真实写法
- `11-security`：43→130 行。补权限码同步流程 + COMPANY_ID 完整模板(对齐 29 处真实 BaseColumns) + 越权检查清单 + 公开接口规范 + 正反例

### Changed — 治理同步
- `standards/index.md`：01/08/09/10/11 状态 🟡骨架 → ✅已落地；主题描述更新
- `copilot-instructions.md`：版本同步 v0.4.1
- 版本 0.4.0 → 0.4.1

### Notes
- 规范层成熟度：18 条中 16 条已落地（仅 13 Swagger / 14 单测为🟡建议级骨架）
- 核心链路"架构→命名→各层→DDL→质量→性能→漏洞→异常→日志→事务→安全→提交"全部落地
- 验证：`npm run verify` 全绿

---

## [0.4.0] - 2026-07-17 (codegen SKILL 补厚落地)

### 重大改进：3 个 codegen Skill 从骨架升级到落地深度

解决 codegen SKILL.md 过薄（56~83 行）导致 AI 生成时缺乏执行步骤/边界用例/正反例的问题。对标 wl-skills-kit 的 SKILL.md（平均 200+ 行）+ USAGE.md（12 个）。

### Changed — SKILL.md 补厚（56→150+ 行）
- `entity-codegen/SKILL.md`：补完整执行步骤（5步）、字段类型映射表、占位符填空规则、DTO 校验生成规则、边界用例（树形/金额/富文本/枚举/时间范围）、正反例对照
- `service-codegen/SKILL.md`：补执行步骤（4步）、CRUD 5 方法模板展开、状态变更四段式、软删除实现、权限码命名速查、validate 自检对照、边界用例（批量/树形/联表/状态机）、正反例
- `mapper-xml-gen/SKILL.md`：补执行步骤（4步）、BaseColumns 生成规则、动态查询类型表、Oracle vs MySQL 差异表、foreach 批量、validate 自检对照、边界用例（联表/动态排序/IN/大字段）、正反例
- 三个 SKILL status 🟡骨架 → ✅已落地

### Added — 3 个 USAGE.md（执行细节，对标 kit 12 个）
- `entity-codegen/USAGE.md`：4 典型场景（标准CRUD/树形/金额/仅补VO）+ 占位符填空示例 + FAQ
- `service-codegen/USAGE.md`：4 典型场景（标准CRUD/状态变更/批量导入/联表详情）+ 权限码速查 + validate 对照 + FAQ
- `mapper-xml-gen/USAGE.md`：4 典型场景（分页/联表/批量IN/简单lambdaQuery）+ Oracle/MySQL 速查 + validate 对照 + FAQ

### Changed — 自检
- `lint-skills.js`：新增 core codegen Skill 必须配 USAGE.md 校验（entity/service/mapper）
- 版本 0.3.1 → 0.4.0

### Notes
- codegen 质量三层保障强化：① SKILL.md 有执行步骤指引 ② USAGE.md 有典型场景 + FAQ ③ templates 填空 + validate 自检
- 验证：`npm run verify` 全绿（含 USAGE.md 存在性校验）

---

## [0.3.1] - 2026-07-17 (多编辑器适配)

### Added — 全编辑器 MCP 接入（对标 wl-skills-kit）
- `files/.cursor/mcp.json`：Cursor 编辑器 MCP 配置（mcpServers 格式）
- `files/.vscode/mcp.json`：VS Code 编辑器 MCP 配置（servers + type:stdio 格式）
- `files/.kiro/settings/mcp.json`：Kiro 编辑器 MCP 配置
- init 后三套配置自动释放到业务工程根目录，各编辑器自动发现并启动 MCP server

### Changed — 指令文件同步
- `copilot-instructions.md`：第 6 节多编辑器适配从"待物化"改为"已物化"表格（6 编辑器）；补 MCP 3 工具说明；第 7 节阶段说明更新到 v0.3.1（18 标准/J1~J5/模板/复扫闭环全落地）
- `CLAUDE.md`："17 条"→"18 条"
- `AGENTS.md`：技术栈速查补 templates/validate/java-quality
- `verify-version.js`：新增三套编辑器 mcp.json 存在性 + JSON 合法性 + server 路径校验
- 版本 0.3.0 → 0.3.1

### Notes
- 编辑器覆盖：GitHub Copilot / Cursor / VS Code / Kiro / Claude Code / 通用 Agents 六端
- 验证：`npm run verify` 含多编辑器配置校验

---

## [0.3.0] - 2026-07-17 (P2 落地 · MCP 工具层 + Java 工具链补全 + 提交规范强制)

### 重大改进：Java 检查工具链完整 + AI 对话内可确定性调用

补齐 J3/J4/J5（PMD/SpotBugs/Spotless），Java 检查工具从 2 个到 5 个全覆盖；MCP 让 AI 在对话内直接调 validate/standards/templates；git hook 强制提交规范。

### Added — P2-A MCP 工具层（对标 kit/mcp）
- `mcp/server.js`：MCP 协议实现（stdio + JSON-RPC 2.0），3 个工具注册
- `mcp/registry.js`：工具注册中心（单一数据源）
- `mcp/tools/beRulesTools.js`：包装 lib/be-rules，暴露 wls_be_validate
- `mcp/schema-validator.js`：工具入参 JSON Schema 校验
- `.mcp.json`：编辑器接入配置
- 3 工具：`wls_be_validate`（扫 B1~B8）/ `wls_be_standards`（查 18 条规范）/ `wls_be_templates`（查 8 个代码模板）

### Added — P2-B Git Hook 强制提交规范
- `commitlint.config.js`：commitlint 配置（type-enum 9 种 + 格式校验）
- `files/.github/git-hooks/`：commit-msg hook + README，业务工程可一键接入
- 18-git-commit 从"文字规范"升级为"hook 强制卡控"

### Added — P2-C PMD/SpotBugs/Spotless（J3/J4/J5 补全）
- `java-quality/pmd/pmd-ruleset.xml`：性能+漏洞+质量规则集（J3）
- `java-quality/spotbugs/spotbugs-exclude.xml`：字节码分析 + 排除生成代码（J4）
- `java-quality/spotless/`：格式统一（google-java-format AOSP）（J5）
- 各含 README 接入指引；Java 检查工具链 J1~J5 全覆盖

### Changed
- verify-version.js 增 MCP 工具数 + 模板完整性 + mcp/ 纳入 files 校验
- test script 纳入 mcp-registry.test.js
- rule-coverage.md：J3/J4/J5 状态从"待落地"→"已落地"
- package.json 0.2.0 → 0.3.0；files 加 mcp；keywords 加 pmd/spotbugs/spotless/mcp

### Notes
- 验证：`npm run verify` 全绿（version + lint + test 含 MCP 用例）
- Java 检查工具链完整度：ArchUnit(J1) + Checkstyle(J2) + PMD(J3) + SpotBugs(J4) + Spotless(J5) + be-rules(regex B1~B8)，对标 kit 的 ESLint，但体现 Java 多元工具链
- 提交规范双保险：18-git-commit.md（人读）+ commit-msg hook（机强制）

---

## [0.2.0] - 2026-07-17 (P1 落地 · 引擎可用 + 闭环可验证)

### 重大改进：从"引擎孤岛"到"业务工程可用 + 闭环可验证"

解决三个根本缺陷：① be-rules 引擎无入口（孤岛）② codegen 无标准答案（自由发挥→胶水代码）③ 修复无复扫（改完不知对不对）。

### Added — P1-A Java 代码模板（堵胶水代码源头）
- `files/.github/templates/` 8 个标准骨架：Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml + README
- 对标 kit 的 templates/(45个)，物化团队基线(CoreEntity/JhServiceImpl/@PreAuthorize/@Transactional/软删/BaseColumns)
- 占位符填空机制：codegen Skill 读模板替换，非从零发挥

### Added — P1-B CLI validate（引擎对业务工程可用）
- `bin/wl-skills-bd.js` 新增 validate 命令：接 lib/be-rules.js，B1~B8 全跑，按规则分组输出，有 error 非零退出（CI 可阻断）
- 新增 doctor 命令：工具链 + java-quality 接入体检
- ★ 实测对 mdm-service 跑出 195 项（162 error + 33 warn），精准定位文件:行号，证明引擎非孤岛

### Added — P1-C/D 复扫闭环（对标 kit/code-fix）
- `convention-audit-be` 加 --quick 复扫模式 + 前后对比矩阵（仅查上次偏差，省 90% token）
- `code-fix-be` 落地强制复扫闭环（"不可跳过"硬约束）：修复后必须跑 validate，输出 error:0/变化矩阵
- 审计→修复→复扫 链条闭合

### Changed — codegen 三 SKILL 引用 templates
- entity-codegen / service-codegen / mapper-xml-gen：生成方式从"自由发挥"改为"读模板填空"
- 完成摘要加"生成后自检 wl-skills-bd validate"约束

### Changed
- package.json/README/bin/index 版本 0.1.0 → 0.2.0
- convention-audit-be / code-fix-be status 🟡骨架 → 🟡落地

### Notes
- 验证：`npm run verify` 全绿；validate 对真实 mdm-service 跑出 195 项
- 防"意大利面条代码"三层保障：① codegen 读模板填空 ② validate 生成后自检 ③ Checkstyle+ArchUnit CI 卡控
- 待续 P2：MCP wrapper / PMD+SpotBugs / SKILL.md 补厚

---

## [0.1.0] - 2026-07-17 (架构完善 · 自检闭环 + Java 质量执行器)

### 重大改进：从"纯骨架"升级为"可自检、可机器卡控"

解决两个根本缺陷：① 发版靠人眼（脚本全 echo）② 审计非确定性（文字清单无执行器）。对标 `wl-skills-kit` v2.12.6 的成熟架构，适配 Java 后端工具生态。

### Added — L0 自检层（对标 kit/scripts）
- `scripts/verify-version.js`：版本 + standards 计数(18) + skills 计数(10) + npm files 数组交叉校验（对标 kit/verify-version.js）
- `scripts/lint-skills.js`：SKILL.md Pre-flight/standards 引用/路径存在/行数/规则覆盖矩阵校验（对标 kit/lint-skills.js）
- `tests/be-rules.test.js` + `tests/verify-version.test.js`：执行器回归测试（对标 kit/tests）
- `package.json` 补 `verify`/`release:check`/`prepublishOnly` —— 发版前强制全量自检，杜绝漂移

### Added — L1 执行器层（防胶水代码核心）
- `lib/be-rules.js`：后端确定性规则引擎 B1~B8（正则/行级），对标 kit/ast-rules.js。覆盖：Controller 缺 @PreAuthorize(B1)、缺 @ApiOperation(B2)、SELECT *(B3)、${}注入(B4)、缺 @Transactional(B5)、目录文件数(B6)、缺 COMPANY_ID(B7)、裸 RuntimeException(B8)

### Added — L2 Java 质量规则集（机器确定性卡控，Java 生态）
- `files/.github/java-quality/archunit/`：ArchUnit 分层规则测试模板（J1）—— 把 standards/02"禁止跨层"从文字变成 CI 硬卡控
- `files/.github/java-quality/checkstyle/`：Checkstyle 规则集 checkstyle.xml（J2）—— standards/03/15 物化
- `files/.github/java-quality/maven-snippets/`：5 工具一键接入 pom 片段
- `files/.github/java-quality/README.md`：工具映射 + 三场景分工（IDE/CI/AI）

### Added — 治理基线
- `kit-internal/architecture.md`：三层职责 ADR（对标 kit/architecture.md）
- `kit-internal/rule-coverage.md`：规则覆盖矩阵（对标 kit/rule-coverage.md）—— 治理规则：阻断约定必须有 J*/regex 执行器兜底，lint-skills 自动校验

### Changed
- `package.json`：0.0.5 → 0.1.0；补 scripts；files 数组加 `lib`；keywords 加 checkstyle/archunit
- `bin/wl-skills-bd.js` / `README.md` / `standards/index.md`：版本同步 0.1.0
- `standard-env-config-be/SKILL.md`：Pre-flight 补 standards/01 引用

### Notes
- 工具映射：Checkstyle(命名/风格) + PMD(静态分析,P2) + SpotBugs(字节码,P2) + ArchUnit(架构分层) + Spotless(格式,P3)。对标 kit 的 ESLint，但体现 Java 多元工具链
- 三场景分工：IDE(实时) / Maven CI(build failure) / AI 审计(be-rules 即时跑)
- P0(自检) + P1(ArchUnit/Checkstyle/be-rules) 已闭环；P2(PMD/SpotBugs) + P3(Spotless) + SKILL.md 补厚 留后续逐个细化
- 验证：`npm run verify` 全绿（version + lint + test 三关）

---

## [0.0.5] - 2026-07-17 (团队开发要求闭环)

### Added

- `standards/12-database-ddl.md` 新增 §0.5「数据库物理库归属」：三大库(hx_cxdb1/hx_non_cxdb2/hx_ptdb)+三用户(cxuser/nonuser/ptuser)+业务模块落库映射表+MDM Oracle 特例+db-migration 选库决策（Pre-flight 必填）。对齐手册§"数据库划分"，闭环建表选库
- `standards/02-project-structure.md` 新增「业务中心 × 工程包名映射」：sale/quality/produce/cost/safe/mdm 的工程名↔根包↔前端工程映射 + 工程目录角色(wl-apis/wl-common)+构建顺序+AI 包名校验约束。对齐手册§"工程及包名称约定""工程目录具体划分"，闭环新建工程包名生成
- `skills/ops/standard-env-config-be/SKILL.md` 新增「业务模块端口段分配」：10000~10899 段位表+端口冲突校验+MDM 待登记段。对齐手册§"业务模块端口划分"，闭环环境配置防冲突

### Changed

- `standards/index.md`：12 / 02 主题描述扩充；任务类型 D（db-migration）必读含 12 物理库归属；版本 v0.0.4 → v0.0.5

### Notes

- 闭环目标：后端代码生成（建表选库 / 新建工程包名 / 环境端口）不再偏离团队开发要求
- 不纳入范围：分支规范/合并链（由团队 Git 规范卡控）；Code Review/错误码字典/接口版本化（共同盲区，后续）
- 零代码副作用：仅 standards + skill markdown 变更

---

## [0.0.4] - 2026-07-17 (编码层规范对齐手册)

### Added

- 新增 `standards/18-git-commit.md`：Git 提交信息规范（类型code + 模块名 + 功能点 + 具体内容），对齐《项目开发手册》§"代码提交"。仅约束提交信息，不含分支策略
- `standards/02-project-structure.md` 新增"单目录文件 ≤20、10 以内最佳"粒度红线（对齐手册§"业务服务目录划分"），并纳入 `convention-audit-be` 计数

### Changed

- `standards/index.md`：17 → **18** 条清单；任务类型 E（审计）必读范围含 18；门控示例同步
- 版本 v0.0.2 → v0.0.4

### Notes

- 范围界定：本次只补手册中**编码层**（建目录/文件/命名/代码写法/提交）的要求；分支规范、工程包名映射表、端口划分、构建顺序、物理库划分等**工程治理/运维**类不纳入 standards，由团队其他渠道卡控
- 零代码副作用：仅 standards markdown 变更，不碰任何业务工程
- 编码层核对结论：wl-skills-bd 在命名(03)/代码写法(04~07)/分层(02) 上与手册一致且更细，本次仅补齐"提交规范"与"单目录粒度"两处缺口

---

## [0.0.3] - 2026-07-12 (骨架增强 · 环境标准化)

### Added

- 新增横切 ops Skill `standard-env-config-be`（后端环境标准化）：bootstrap.yml 占位符检测 + K8s 四环境清单对齐 + 本地启动模板，与前端 `wl-skills-kit/standard-env-config` 职责对称、对象不同
- 新增 `docs/env-standard-analysis.md` 需求基线：通用性证据（archetype 同源三方对比）、华新 Profile、晋升梯队模板、PoC 验收路径
- 核心技能数 9 → **10**，注册进 `_registry.md` / `_pipeline.md`（标为横切 ops）/ `_best-practices.md`（场景 7）

### Notes

- 不碰 Nacos 内配置 / Dockerfile / CI / 业务代码，能力边界明确
- 当前为骨架：SKILL.md + USAGE.md 落地，CLI `standard-env` 子命令与 MCP 待 0.2.x

---

## [0.0.1] - 2026-05-14 (骨架初始化)

### Added

- 仓库骨架建立：`files/.github/{standards,skills,guides,reports}` + `kit-internal/` + `docs/` + `bin/`
- README.md（详尽版）：阐明定位、与 `wl-skills-kit` / `wl-skills-ui` 的关系、L1–L7 路线图、后端 Pipeline、Skill 蓝图、技术栈基线、共性 vs 团队规范分离原则
- 14 条后端 standards 占位（其中 6 条核心已落地内容，其余为骨架待填）
- 9 个核心 Skill 占位骨架（api-design-be / service-codegen / entity-codegen / mapper-xml-gen / convention-audit-be / business-doc-extract-be / db-migration / unit-test-gen / code-fix-be）
- `_registry.md` / `_pipeline.md` / `_best-practices.md` 三件套（与 kit 对齐）
- `copilot-instructions.md` 多编辑器主入口
- 分析报告：`docs/analysis-report.md` 详细记录三仓库扫描结论与建议

### Notes

- 当前为 **骨架版**：可作为团队共建基线，所有 Skill 的 Pre-flight / 执行细节 / 模板需在后续 0.1.x → 0.2.x 逐步补齐
- 基线项目参考：`mdm-service`（hx_test 分支，jh4j-cloud 3.1.0 + MyBatis-Plus + Oracle）
- 外部参考（不集成）：`CLAUDE规范文档/后端`（HZERO 体系）；共性已抽到 standards，差异性留给团队基线

[0.12.0]: about:blank
[0.11.0]: about:blank
[0.10.0]: about:blank
[0.9.0]: about:blank
[0.8.0]: about:blank
[0.7.1]: about:blank
[0.7.0]: about:blank
[0.6.0]: about:blank
[0.5.1]: about:blank
[0.5.0]: about:blank
[0.4.2]: about:blank
[0.4.1]: about:blank
[0.4.0]: about:blank
[0.3.1]: about:blank
[0.3.0]: about:blank
[0.2.0]: about:blank
[0.1.0]: about:blank
[0.0.5]: about:blank
[0.0.4]: about:blank
[0.0.3]: about:blank
[0.0.2]: about:blank
[0.0.1]: about:blank
