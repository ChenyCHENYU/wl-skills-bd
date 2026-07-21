# Backend Skills Pipeline（可执行产物契约 v1）

> 主流程以机器可校验的后端资源契约 JSON 为中心。完整生成门见 `../guides/codegen-workflow.md`，前后端/OpenAPI/权限闭环见 `../guides/frontend-backend-contract.md`。

## 阶段总览

```text
已评审需求 + 可选 design-model/前端契约 + 数据模型
  │
  ▼
⓪ catalog/context ──► 当前模块目录 + 一跳快照 + 有界 Context Plan
  │
  ▼
① contract-design ──► wl-contract.json（唯一生成输入，schema 校验）
  │
  ▼
② codegen plan/apply ──► 15 个代码/DDL/测试/评审基础产物
  │                     + 2 个前后端协作契约产物 + N 个命令 RequestDTO
  ▼
③ contract diff ──► wl-api-contract + OpenAPI 3 + 权限清单 + completion 差异
  │
  ▼
④ validate ──► B1~B25 text/json/markdown/SARIF
  │
  ▼
⑤ Maven quality ──► ArchUnit + Checkstyle + PMD7 + SpotBugs + Spotless + JaCoCo
  │
  ▼
⑥ safe fix ──► 仅白名单自动修复 + 复扫；DDL/业务语义问题转人工
```

`business-doc-extract-be` 可在 ① 前生成 `docs/business/{module}.md`。design/kit 产物是可选输入，不是 bd 的硬依赖；`standard-env-config-be` 是独立横切流程，不改变上述资源契约。配置了项目 Catalog 后，codegen 会强制验证当前模块快照新鲜度并绑定上下文哈希。

## ⓪ 模块目录与精准上下文

```bash
wl-skills-bd catalog check --module <module>
wl-skills-bd context plan --module <module> --task "<任务>" --json
```

当前模块目录是开发事实入口。默认只扫描该模块配置的契约/源码根，其他模块只读取显式一跳关系的固定快照；快照缺失时告警，不回退全仓扫描。需要刷新时执行模块级 `catalog plan/apply`，`--full` 仅用于显式 CI/初始化治理。

## ① 契约设计

输入：

- 已评审需求，以及可选的 `wl-skills-kit` 页面 `api.md`/design-model；
- 业务规则、字段含义、状态机；
- 数据库归属与类型；
- Controller `requestPath`、网关 `externalBasePath`、五个权限码。

输出：符合 `.wl-skills-bd/schemas/contract.schema.json` 的 `wl-contract.json`。

门禁：

```bash
wl-skills-bd codegen validate wl-contract.json
```

不允许从自然语言直接生成代码；不允许省略 `externalBasePath` 后猜网关前缀；不允许把 `companyId/isDelete/审计字段` 作为普通业务字段。

## ② 确定性生成

```bash
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm
```

固定产物：

- Model 6：Entity、CreateDTO、UpdateDTO、PageDTO、VO、PageVO；自定义命令另生成 N 个 OperationRequestDTO；
- Controller/Service 2；Mapper.java/XML 2；
- Flyway/人工恢复说明/DDL_PREVIEW 3；Service/Controller Test 2；
- backend-contract.json/api.md 2。

基础契约固定 17 个产物；每个需要 JSON body 的自定义命令再增加 1 个 RequestDTO，因此总数为 `17+N`。

`apply` 前重新计划。计划漂移、哈希不符或任一冲突默认整批零写入；`--force` 仅在原文件备份后覆盖。

export/relation/非确定性命令生成 draft 和 `<wl-custom>` 区。人工补全实现与 ServiceTest 后，区域会在后续生成中保留；发布契约必须由实现证据升级为 confirmed。

## ③ 协作契约核对

```bash
wl-skills-bd contract diff wl-contract.json \
  --frontend <page-api.md> \
  --openapi <runtime-openapi.json> \
  --permissions <permission-inventory.json> \
  --strict
```

阻断项包括 method/path、请求字段、响应字段、分页结构、路径参数和权限码差异。OpenAPI 未提供 `x-permission` 时为 warning，必须再用权限清单完成强校验。

## ④ 规则审计

```bash
wl-skills-bd validate . --strict
wl-skills-bd validate . --format sarif --output reports/backend.sarif
```

B1~B25 独立执行；忽略项必须使用带理由的 `.be-rules-ignore` 或单行抑制。error 未清零不得进入下一阶段。

## ⑤ Java/Maven 质量门

业务工程执行自己的 `mvn test` / `mvn verify -Pwl-quality`。包提供的 `quality-profile.xml` 固定兼容 Java 8 的 ArchUnit、Checkstyle、PMD7、SpotBugs、Spotless、JaCoCo 组合；P3C PMD6 仅为非阻断 legacy profile，不能混入 PMD7 主门禁。

DDL 还必须单独完成数据库人工 diff、只读验证 SQL、DBA/发布审批和恢复策略评审；自动测试通过不代表允许执行 DDL。

## ⑥ 修复闭环

- 规则型、无语义歧义的问题可进入安全修复计划；
- DDL、权限分配、业务状态机、租户豁免、API 破坏性变更必须人工确认；
- 写入必须预览、确认、计划哈希、冲突零写入和备份；
- 修复后强制重跑原检查，报告 before/after/fixed/remaining；
- remaining error 非零时继续修复，不能把报告标成完成。

## Skill 与可执行器的关系

| Skill | 职责 | 必须落到的执行器/产物 |
|---|---|---|
| project-context-governance | 建立当前模块事实与一跳上下文 | catalog plan/apply/check + context plan |
| api-design-be | 汇总上游并形成资源契约 | contract schema + `codegen validate` |
| entity/service/mapper-xml-gen | 解释分层与业务扩展 | `codegen plan/apply` 标准骨架 |
| db-migration | DDL 评审和恢复策略 | Flyway 正向脚本 + rollback manual |
| unit-test-gen | 补充业务测试 | Maven test + 生成测试骨架 |
| convention-audit-be | 汇总规则与质量门 | B1~B25 + Maven quality + production assurance |
| code-fix-be | 受控修复和复扫 | planHash/confirm + closure report |

Skill 文档不能声称完成了执行器未实现的能力；命令输出和受管状态是闭环证据。

## 变更记录

- 2026-07-18 v1：改为机器契约单一输入，合并 16 产物生成、contract diff、B1~B12、Maven 门禁和安全修复闭环。
- 2026-07-18 v2：统一独立 delivery profile、wl-api-contract、completion 与业务保护区。
- 2026-07-18 v3：基础产物扩展为 17 个，并按命令增加 N 个 RequestDTO；DDL_PREVIEW 进入受管闭环。
