# @agile-team/wl-skills-bd

> Java 8 后端工程的规范、契约代码生成、质量门、MCP 与安全修复闭环。

[![Status](https://img.shields.io/badge/status-v0.17.7-blue.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D22-green.svg)]()
[![JDK](https://img.shields.io/badge/JDK-8-blue.svg)]()
[![Standards](https://img.shields.io/badge/standards-28-orange.svg)]()

当前唯一经过验证的生成 Profile 是 `jh4j3-openapi3`：Java 8、Spring Boot 2、jh4j-cloud 3.1、MyBatis-Plus、OpenAPI 3。包内能力以机器 Schema、兼容矩阵和回归测试为准，不从存量业务代码猜约定。

## 核心能力

| 能力 | 已落地内容 |
|---|---|
| 工程资产生命周期 | `init/update/diff/check/clean`；manifest 增量更新、冲突零写入、强制覆盖前备份 |
| 契约生成 | 严格 `wl-contract.json` → 15 个固定工程产物 + 按命令生成的请求 DTO + 2 个前后端协作产物 |
| 业务扩展（v0.9） | `customOperations` 业务命令/状态机、`relations` 主从关联、`alter` ALTER TABLE、`indexes` 自定义索引、可选 `export`、`externalId` 跨包桥接 |
| 数据安全护栏（v0.10/v0.14） | B13~B19：Redis TTL/Redisson 锁/禁用命令、物理删禁令/全表写禁令/批量分批、受保护环境只读护栏、二次确认 |
| 稳定性与多环境（v0.11/v0.14） | B20~B23：事务内 MQ·HTTP/Swagger 混用/巨型 Service；定时任务、环境隔离和统一写护栏 |
| 独立协同（v0.12） | 内置统一 delivery profile；没有 design/kit 也能从评审需求独立生成；有 kit 时用 `wl-api-contract` 严格握手 |
| 配置分层（v0.12） | 三层分层模型 + env-matrix 单一事实源 + config init/migrate/doctor/fix + troubleshoot 故障诊断 |
| 任务驱动（v0.13） | 8 种任务类型精准触发（加接口/落库/改bug/审计...）；单点增量编辑 + 规则子集兜底，规范不形同虚设 |
| 行为契约测试（v0.16） | 从契约 customOperations 生成场景测试（正常/前置拒绝/状态转移/batch）；测行为不测镜像，避免冗余 |
| 生产保障契约（v0.17） | `assurance.level=production` 强制声明 SLO/RTO/RPO、权限、数据治理、一致性、韧性与六类评审证据；证据缺失时 completion 保持 draft |
| 安全与数据口径（v0.17） | B24 方法安全启用门、B25 敏感 `toString` 门；字段稳定语义 ID/定义/枚举/初始值/分级/脱敏/日志/所有者/唯一事实源 |
| 手册覆盖与高安全生成（v0.14） | 业务子域优先分层、强类型命令 DTO、租户/版本原子写、Flyway 不可变、DDL 评审报告和统一写链 |
| 模块目录与精准上下文（v0.15） | 当前模块增量扫描、一跳上下游快照、有界 Context Plan、服务/API/库表全局去重、codegen 上下文哈希门禁 |
| 生成安全 | `validate/plan/apply`，`planHash + --confirm`，生产/完成度/证据门、受保护业务区、写入失败全量回滚；batch 默认全成全败 |
| 快速审计 | B1~B25（含 Redis/敏感写/方法安全/敏感日志/限流熔断/定时任务/Swagger/巨型 Service）；text/JSON/Markdown/SARIF |
| Java 质量门 | J1~J5 + J8 默认阻断；J6 P3C 隔离审计；J7 OpenAPI 运行时能力 |
| 前后端协作 | 同一 manifest 核对前端 `api.md`、kit 风格 api.md、OpenAPI 3 和权限清单 |
| 权限搬运（v0.9） | `permissions export` 把后端权限码导出为 kit `SYS_PERMISSION_INFO.md` 片段 |
| 安全修复 | 仅 B3/B5 严格前置条件下自动修复；计划确认、备份、失败恢复、强制复扫 |
| AI 接入 | 16 个 MCP 工具，CLI/MCP 复用同一 `lib/` 实现和同一 JSON Schema |

## 快速开始

```bash
# 要求 Node.js >= 22
npx @agile-team/wl-skills-bd init --dry-run
npx @agile-team/wl-skills-bd init
npx @agile-team/wl-skills-bd doctor
npx @agile-team/wl-skills-bd validate src/main --format sarif --output reports/backend.sarif
```

`init` 会写入受管 manifest。重复执行不会盲目覆盖本地修改；用 `diff` 查看漂移，用 `check` 验证安装完整性，用 `update` 增量升级，用 `clean --dry-run` 先预览可清理资产。

## 大型工程模块目录与精准上下文

从 `.wl-skills-bd/catalog.config.example.json` 复制为 `.wl-skills-bd/catalog.config.json`，登记模块的契约根、源码根、负责人和显式一跳上下游。日常开发必须指定当前模块：

```bash
wl-skills-bd catalog plan --module order
wl-skills-bd catalog apply --module order --plan-hash <sha256> --confirm
wl-skills-bd catalog check --module order

wl-skills-bd context plan --module order \
  --task "增加订单创建接口" \
  --keywords "幂等,客户" \
  --json
```

模块模式只遍历 `order` 配置的契约/源码根。上游 `customer`、下游 `billing` 等模块只读取已生成快照，且仅把关系命中的契约列为候选，不扫描它们的源码目录。快照缺失时明确告警，不会偷偷回退全仓扫描。`catalog plan --full` 仅供 CI、首次初始化或显式全局治理。

机器快照写入 `.wl-skills-bd/catalog/`；人读文档写入 `docs/backend/`。每份生成文档都带用途、受众、范围、来源、目录哈希和 `editable: false` 注释头。当前模块文档是开发事实入口，项目索引只汇总快照。Catalog 会阻断重复契约、服务类、API 路由、权限码、表写归属和 Flyway 版本；配置存在时，codegen 还会校验当前模块新鲜度并将上下文哈希绑定到 `planHash`。

日常只需遵循五步：

1. `catalog check --module <module>`：确认当前模块目录新鲜；
2. `context plan --module <module> --task "<任务>"`：加载当前模块和命中的一跳契约；
3. 更新 `wl-contract.json`，执行 `codegen validate/plan/apply`；
4. 执行 `contract diff --strict`、`validate` 和 Maven 质量门；
5. 使用 `type(scope): 功能点-具体内容` 提交，CI 执行 `commit check --range <base>..HEAD`。

不要把 `catalog --full` 当作本地默认，也不要直接修改生成的 Catalog JSON/Markdown。

## 契约驱动生成

从安装后的示例开始：

```bash
cp .github/templates/examples/feature-category.contract.json wl-contract.json
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <sha256> --confirm
```

这条链路不依赖 `wl-skills-design` 或 `wl-skills-kit`。它们存在时可提供稳定 ID、页面契约和交叉验证；不存在时，bd 仍从已评审需求独立形成 `wl-contract.json` 并完成后端生成、检查和验证。

契约必须明确：Profile、根包、业务子域、Entity/表、外部网关路径、权限码、Oracle/MySQL、迁移版本、恢复策略、只读验证 SQL 和字段写策略。无业务命令时生成 17 个产物：

- 6 个模型：Entity、CreateDTO、UpdateDTO、PageDTO、VO、PageVO；
- 4 个服务/持久层：Controller、直接 Service、Mapper.java（含可选 queryById）、Mapper.xml（含 queryById 段）；
- 3 个 DDL 资产：正向 migration、人工恢复说明、DDL 风险/审批/验证预览报告；
- 2 个测试骨架：ServiceTest、ControllerTest；
- 2 个协作产物：`backend-contract.json`、`api.md`。

每个需要 body 的业务命令额外生成一个 `OperationRequestDTO`。分页的 `current/size` 与查询条件全部位于 JSON body；字段必须显式声明 `writable`，状态等命令字段应设为 `false`。

DDL 只生成，不连接数据库、不自动执行、不伪造自动回滚。生产变更继续由 DBA/CD 和人工审批负责。

标准 CRUD 是完整实现。export、关联查询或缺少确定性 patch 的业务命令会明确标记为 draft，并放入 `<wl-custom>` 保护区；人工补齐实现和测试后，后续 codegen 会保留该区域。需要拒绝所有业务骨架时，在 apply 增加 `--require-complete`。

生产契约还可声明 `assurance.level=production`。此时必须给出业务关键级别、SLO、RTO/RPO、认证与方法安全、审计、数据治理、幂等/事件/跨服务事务策略、超时/重试/熔断/限流，以及威胁模型、授权评审、压测、运行手册、恢复演练和数据评审六类非空证据文件。包只验证声明和证据链，不冒充安全、DBA、SRE 或业务审批；完整要求见 [生产保障规范](files/.github/standards/28-production-assurance.md)。

最小生产保障声明示例（证据路径相对业务项目根目录，文件必须存在且非空）：

```json
{
  "assurance": {
    "level": "production",
    "criticality": "core",
    "slo": { "availabilityPercent": 99.9, "p95LatencyMs": 500, "p99LatencyMs": 1000, "maxErrorRatePercent": 0.1 },
    "recovery": { "rtoMinutes": 60, "rpoMinutes": 15 },
    "security": { "authorizationModel": "tenant-data-scope", "methodSecurityRequired": true, "auditRequired": true },
    "dataGovernance": { "owner": "主数据团队", "sourceOfTruth": "feature-category", "classificationDefault": "internal", "retentionPolicy": "按企业主数据保留策略执行" },
    "consistency": { "idempotencyStrategy": "business-key", "eventDelivery": "none", "crossServiceTransaction": "none" },
    "resilience": { "dependencyTimeoutMs": 3000, "retryMaxAttempts": 1, "circuitBreakerRequired": true, "rateLimitRequired": true },
    "evidence": {
      "threatModelRef": "docs/evidence/threat-model.md",
      "authorizationReviewRef": "docs/evidence/authorization-review.md",
      "loadTestRef": "docs/evidence/load-test.md",
      "runbookRef": "docs/evidence/runbook.md",
      "restoreDrillRef": "docs/evidence/restore-drill.md",
      "dataReviewRef": "docs/evidence/data-review.md"
    }
  }
}
```

### 业务扩展能力（v0.9）

契约可选声明以下扩展，codegen 自动生成对应代码：

| 扩展字段 | 生成内容 | 典型场景 |
|---|---|---|
| `customOperations[]` | 强类型命令 DTO + 前置校验 + `ID/COMPANY_ID/IS_DELETE/REVISION` 原子写；batch 返回 successCount/failureCount/failures | submit/approve/reject/withdraw/changeStatus/convert/release/close/cancel/batchXxx |
| `relations[]` | 主 Controller 的 queryXxxByParentId 接口；manifest 暴露关联契约 | 订单/明细、配置/子项、主从表 |
| `alter{}` | `phase=expand` 只允许可空 add/显式 widening modify；`phase=contract` 只允许带审批单的 drop | 加字段、扩长度、审批后删废弃字段 |
| `indexes[]` | 渲染到 migration（唯一索引/普通索引） | 业务唯一键、查询性能索引 |
| `api.permissions.export` | GET /export Controller + Service 骨架 | 列表导出 |
| `externalId`（顶层/字段/操作/关联） | 写入 manifest 供 wl-skills-design design-model 跨包追溯 | 稳定 ID 桥接 |

业务命令命名规范与 wl-skills-kit api-contract 对齐；B5 规则已扩展识别全部业务命令前缀，确保 @Transactional 覆盖。

## 前后端协作

`wl-skills-bd` 不直接修改前端工程。bd 与 kit 各自可从评审需求独立建立契约，通过共同的 `jh4j3-openapi3@1.0` delivery profile 和 `wl-api-contract` 结构自然协同；design-model 只是可选追溯增强，不是硬依赖：

```bash
wl-skills-bd contract show wl-contract.json --format markdown \
  --output docs/contracts/feature.verified.api.md
wl-skills-bd contract diff wl-contract.json \
  --frontend docs/contracts/page.api.md \
  --openapi openapi.json \
  --permissions permissions.json \
  --strict
```

核对范围包括 Profile/协议、资源、API_CONFIG、HTTP 方法/路径、查询/请求/响应字段、`code=2000`、分页、`revision`、权限码和双方 completion。与前端 `wl-skills-kit` 的独立边界和严格握手见 [前后端契约指南](files/.github/guides/frontend-backend-contract.md)。

## 检查与安全修复

```bash
wl-skills-bd validate src/main --strict
wl-skills-bd validate src/main --format markdown --output reports/AUDIT_BE.md

wl-skills-bd fix plan src/main --rules B3,B5 --json
wl-skills-bd fix apply src/main --rules B3,B5 --plan-hash <sha256> --confirm
```

自动修复白名单只有：

- B3：能安全解析同 XML `BaseColumns`、别名一致且 SQL 不含危险文本替换时，将 `SELECT *` 替换为列清单；
- B5：能确定是公开写方法且不存在事务注解冲突时，补 `@Transactional(rollbackFor = Exception.class)`。

B1/B2/B4/B6~B12 以及不满足前置条件的 B3/B5 只报告证据和人工方案。apply 会重算计划、验证 `planHash`、备份原文件、失败时恢复，并强制复扫生成 `reports/FIX_BE_*.md`。

## Java 质量门

将 `.github/java-quality/maven-snippets/quality-profile.xml` 的 `<profile>` 合入父 POM，然后执行：

```bash
mvn verify -Pwl-quality
```

| 编号 | 工具 | 默认行为 |
|---|---|---|
| J1 | ArchUnit | 阻断 Controller→Mapper/Repository 等分层逆向依赖 |
| J2 | Checkstyle | 阻断命名、Javadoc、import 与规模偏差 |
| J3 | PMD 7 | 阻断缺陷、复杂度、资源和性能偏差 |
| J4 | SpotBugs | 阻断字节码缺陷 |
| J5 | Spotless | 阻断格式漂移 |
| J6 | P3C 2.1.1 / PMD 6 | 可选、非阻断、必须与 PMD 7 隔离运行 |
| J7 | Knife4j/OpenAPI | 运行时文档能力，不冒充静态质量门 |
| J8 | JaCoCo 0.8.15 | Service 类行/分支 ≥70%/60%，Controller 类行 ≥50% |

完整接入方式见 [Java 质量门说明](files/.github/java-quality/README.md)。

## MCP 工具

| 工具 | 写入 | 作用 |
|---|:---:|---|
| `wls_be_validate` | 否 | B1~B25 扫描 |
| `wls_be_doctor` | 否 | JDK/Maven/Profile/质量门/租户证据/契约覆盖体检 |
| `wls_be_codegen` | 条件 | 契约 validate/plan/apply |
| `wls_be_contract` | 否 | 协作契约 show/diff（前端/OpenAPI/权限/kit api.md） |
| `wls_be_safe_fix` | 条件 | B3/B5 安全修复闭环 |
| `wls_be_standards` | 否 | 读取 28 条规范 |
| `wls_be_templates` | 否 | 读取 16 个模板 |
| `wls_be_db_preview` | 否 | 只读预览 CREATE/ALTER DDL + Expand-Contract 阶段 |
| `wls_be_export_permissions` | 条件 | 导出权限码为 kit SYS_PERMISSION_INFO.md 片段 |
| `wls_be_config` | 条件 | 配置分层 init/migrate/doctor/fix；写操作保留计划与确认门 |
| `wls_be_troubleshoot` | 否 | DB/Redis/Nacos/K8s 等常见故障诊断树 |
| `wls_be_task` | 否 | 只读任务路由：自然语言/显式类型 → Skill、规则子集与统一安全写链 |
| `wls_be_catalog` | 条件 | 当前模块目录 plan/apply/check/show；默认禁止隐式全量扫描 |
| `wls_be_context` | 否 | 当前模块 + 一跳快照的有界上下文选择，不扫描关联源码 |
| `wls_be_commit` | 否 | `type(scope): 功能点-具体内容` 单条/range 校验与 Hook doctor |
| `wls_be_test` | 否 | 行为契约测试生成（gen/scenarios），测行为不测镜像 |

写工具默认停在 plan/preview；apply 必须显式确认。Cursor、VS Code、Kiro、Copilot、Claude Code 和通用 Agents 的配置随 `init` 安装。详见 [MCP 工作流](files/.github/guides/mcp-workflow.md)。

## 包架构

```text
files/.wl-skills-bd/   机器事实：Schema、Profile、兼容矩阵、规则目录
files/.github/        人读规范、Skills、模板、质量门、指南
lib/                  安装/契约/生成/审计/修复的确定性核心
bin/                  CLI 适配
mcp/                  16 个工具的协议与 Schema 适配
scripts/ + tests/     包自身治理、真实 Java 8 夹具和回归测试
```

详细设计见 [架构说明](kit-internal/architecture.md) 和 [规则覆盖矩阵](kit-internal/rule-coverage.md)。

## 能力边界

12 个 Skill 中 10 个已落地，1 个部分落地（db-migration：CREATE/ALTER/索引已自动生成），1 个仍是诚实标记的流程骨架（业务文档抽取）。项目上下文由 catalog/context 执行器落地；行为单测由 `test gen/scenarios` 落地；环境配置由 config init/migrate/doctor/fix 落地。无执行器的能力不展示虚构命令，也不承诺自动应用。

## 稳定性与多环境护栏（v0.11）

基于 mdm-service 实证反例，补齐 v0.10 之后发现的 4 类事故源：

| 场景 | 禁止 | 强制 | 兜底 |
|---|---|---|---|
| 分布式锁 | 长 TTL（>10min）无 watchdog | Redisson RLock 自动续期 | B14 扩展 |
| 事务内发 MQ/HTTP | 回滚后消息已发/长事务锁占用 | 移出事务或用事务消息 | B20 error |
| HttpUtil 裸调用 | 无超时拖垮线程池 | 加 .timeout 或用 Feign+熔断 | B21 warn |
| Swagger 2/OpenAPI 3 混用 | 同类 @Api+@Tag 冗余 | 统一 OpenAPI 3，存量保留 | B22（混用 error/纯 Swagger 2 warn） |
| Service 注入 > 10 | 巨型类信号 | 按子域拆分 | B23 warn |

**多环境与受保护环境护栏**（standards/24）：
- 5 环境矩阵：dev/sit/uat/pre/prod + Nacos namespace 隔离
- 业务中心 × 端口 × 数据库集群（cx/non_cx/pt）映射固化
- `pre/prod/production` 对 codegen/safe-fix/config/permissions apply 默认零写入，需评审后显式授权
- 分支与合并链由团队单独管控，不在 bd 内固化

## 数据安全护栏（v0.10）

把生产事故源从口头规范固化为机器兜底（be-rules B13~B19），AI 生成 Redis/批量/外部调用代码时强制对照 standards 20/21/22：

| 场景 | 禁止 | 强制 | 兜底 |
|---|---|---|---|
| Redis set | 无 TTL | 带过期时间 | B13 error |
| 分布式锁 | setnx 自实现 | Redisson RLock | B14 error |
| Redis 命令 | KEYS \*/FLUSHDB/FLUSHALL | SCAN | B15 error |
| Redis 序列化 | JDK 序列化 | Jackson + JavaTimeModule | B16 warn |
| 删除数据 | deleteBatchIds/TRUNCATE/DROP | 使用当前 profile 的软删列/删除值（默认 IS_DELETE=0） | B17 error |
| 全表写 | update/delete 无 WHERE | WHERE + COMPANY_ID 谓词 | B18 error |
| 批量写 | saveBatch > 1000 | ≤1000 或分批游标 | B19 warn |

`pre/prod/production` 的 codegen/safe-fix/config/permissions apply 默认阻断；敏感操作须二次确认。详见 [ops/data-safety](files/.github/skills/ops/data-safety/SKILL.md)。

## Swagger 与 Apifox（v0.11）

- **新代码统一 OpenAPI 3**（`io.swagger.v3.oas.annotations`），存量 Swagger 2 允许保留
- **Apifox 集成**：springdoc-openapi 自动生成 OpenAPI 3 JSON，Apifox 定时同步（sit/uat 环境）
- **B22 检测**：同类混用 @Api + @Tag → error；纯 Swagger 2 → warn
- 详见 [standards/13 §8.1/§8.2](files/.github/standards/13-api-doc-swagger.md)

## 配置分层与多环境管理（v0.12）

把"配置管理 + 环境迁移 + 故障排查"标准化为工程级闭环。任何业务项目套用同一套模式：一处声明（env-matrix）、全工程应用、一键体检、一键迁移、一键排查。详见 [standards/25](files/.github/standards/25-config-layering.md)。

**三层分层模型**：
- L1 代码库（git，零硬编码）：bootstrap.yml / application.yml / logback 全 `${VAR}` 占位
- L2 环境变量（部署侧，不进 git）：K8s ConfigMap + Secret / .env / CI 变量
- L3 Nacos 动态（运行时，namespace 隔离）：application-{env}.yml / datasource-{cluster}-{env}.yml

**工程闭环**：

```bash
# 1. 生成标准配置骨架（新项目 5 分钟搭好）
wl-skills-bd config init --project wl-sale --module sale --port 10000 --json
wl-skills-bd config init --project wl-sale --module sale --port 10000 --plan-hash <hash> --confirm

# 2. 声明客户差异（编辑 .wl-skills-bd/env-matrix.yml，单一事实源）

# 3. 客户迁移（内网→华新→下一个，L1 代码零改动）
wl-skills-bd config migrate --to huaxin --plan
wl-skills-bd config migrate --to huaxin --apply --plan-hash <hash> --confirm

# 4. 全链路体检（本地启动不了？查哪里？）
wl-skills-bd config doctor              # L0~L8 静态体检
wl-skills-bd config doctor --probe      # + DB/Redis/Nacos TCP 连通性探测

# 5. 安全修复（明文密码自动改占位符 + 复扫）
wl-skills-bd config fix --plan
wl-skills-bd config fix --plan-hash <hash> --confirm

# 6. 故障排查（错误关键字 → 诊断步骤）
wl-skills-bd troubleshoot "Communications link failure"
wl-skills-bd troubleshoot "NacosException"
wl-skills-bd troubleshoot "CrashLoopBackOff"
```

**L0~L8 体检项**：config-skeleton / config-secret（明文密码）/ config-placeholder / env-matrix / env-completeness / config-nacos / env-dbcluster / env-k8s-manifest / env-port / env-consistency / env-production-guard + 可选 probe-db/redis/nacos。`env-port` 优先校验 env-matrix 中项目冻结端口，不会用通用业务域范围覆盖已确认的客户端口。

**治理列闭环**：受管 profile 提供默认值；项目差异写入未受管的 `.wl-skills-bd/profile.local.json`，禁止直接编辑 `profiles/*.json` 制造安装漂移。合并后的 `softDelete/auditTime` 同时驱动 DDL、Entity、Service 与 Mapper XML；doctor 校验 profile、`rules.local.json`、本地 MyBatis-Plus 运行值三点一致。运行值仅由 Nacos 下发时，doctor 会明确标记“本地未验证”，联调前需保留配置证据。

**内置 10 类故障诊断树**：DB 连接 / Redis 连接 / Nacos 连接 / K8s Pod / 端口占用 / Bean 创建 / Profile 未激活 / Flyway 迁移 / Feign 超时 / MQ 失败。

> 边界：bd 不持有 Nacos 写凭据，不读 Nacos 服务端配置内容（SRE 域）；连通性探测用 TCP socket（端口可达性），不执行 SQL/PING，不持有真实凭据。

## 任务驱动与精准触发（v0.13）

bd 既能全链路新开发完整服务，也能像 wl-skills-kit 一样单点触发（加个接口/落库/改 bug）。关键：**任何任务模式都必须遵守对应规范兜底，不让约束形同虚设**。详见 [standards/26](files/.github/standards/26-task-driven.md)。

**8 种任务类型**：

| 任务 | 模式 | 触发词 | 规则子集 |
|---|---|---|---|
| new-service | full | 新开发/全套CRUD | B1-B25 子集 + J |
| add-api | incremental-contract | 加接口/加方法 | B1/B2/B5/B8/B12/B20/B24/B25 |
| add-field | incremental-contract | 加字段/落库 | B3/B4/B7/B18/B25 |
| add-business-cmd | incremental-contract | 加submit/状态机 | B5/B8/B17/B20/B24/B25 |
| fix-bug | fix | 改bug/修复 | B3/B5/B7/B8/B17/B18/B24/B25 |
| refactor | fix | 重构/优化 | B5-B12/B23/B24/B25 |
| audit | readonly | 审计/体检 | B1-B25 |
| config-op | config | 配置/连不上 | config-doctor |

**路由与安全写链**：

```bash
# 自然语言识别（推荐）
wl-skills-bd task "加个查询接口"           # → add-api
wl-skills-bd task "加字段落库"             # → add-field
wl-skills-bd task "改个空指针bug"          # → fix-bug
wl-skills-bd task "连不上redis"           # → config-op
wl-skills-bd task "新开发销售模块全套"      # → new-service
wl-skills-bd task --list                   # 列出 8 种任务

# 指定类型输出契约增量、计划确认和验证步骤；task 本身不写文件
wl-skills-bd task --type add-api
wl-skills-bd task --type add-field --target-file src/main/java/.../Foo.java
```

**规范兜底**：加接口/字段/业务命令先更新 `wl-contract.json`，再走 codegen validate/plan/apply 的 `planHash + --confirm + 回滚` 链，最后跑对应规则子集和 `contract diff --strict`。`task --apply` 会被明确拒绝，避免出现第二套无事务写入器。

## 行为契约测试（v0.16）

从契约 customOperations 自动生成关键场景测试，**测行为不测镜像**（避免冗余）。详见 [unit-test-gen](files/.github/skills/test/unit-test-gen/SKILL.md)。

```bash
# 列出测试场景
wl-skills-bd test scenarios wl-contract.json
# → submit（stateTransition）：2 个场景（正常路径 + 前置拒绝）
# → batchCancel（batch）：2 个场景（整批成功 + 前置失败整批拒绝）

# 生成完整 ServiceTest（含 smoke + 业务行为契约）
wl-skills-bd test gen wl-contract.json --output src/test/java/.../XxxServiceTest.java
```

**生成原则**：
- ✅ 正常路径：前置满足 → 调用真实 Service，直接断言实体状态/业务结果已变更
- ✅ 前置拒绝：状态不满足 → `assertThrows(ServiceException.class)`
- ✅ batch 原子语义：整批成功时验证计数与状态；任一记录不满足前置时 `assertThrows`，禁止部分成功
- ❌ 不测 DTO getter / 纯转发 / verify setter 调用次数（冗余）

> 生成 Service 使用显式、租户安全的 Mapper 边界（`selectActiveById/selectActiveByIds/updateAtomic`），测试直接 mock 这些边界；生成测试不得含 TODO、空断言或 `service.undefined`。权限负向、目标数据库 SQL、并发与压测属于集成/生产 assurance 证据，不由纯 Service 单测伪造。

## 包自身验收

```bash
npm run verify                 # 版本/计数/Schema/规则/测试套件（含协作契约、扩展编译、事务回滚与生产护栏）
npm run verify:quality-maven   # Java 8 真实 Maven 生命周期 + 实际生成源码 Checkstyle/Spotless/PMD 门
npm run release:check          # 全量验证 + npm 发布内容 dry-run
```

CI 固定 Node 22 和 Java 8。版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## 伴生工程

- 前端工程脚手架：[wl-skills-kit](../wl-skills-kit/README.md)
- 前端视觉能力：[wl-skills-ui](../wl-skills-ui/README.md)
