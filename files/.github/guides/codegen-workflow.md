# 后端代码生成闭环（权威流程）

本文是 `wl-skills-bd` 代码生成的唯一执行流程。生成器只消费经过校验的机器契约，不从自然语言或数据库表结构中猜测字段。

## 1. 单一输入

权威输入是后端资源契约 JSON，schema 位于：

```text
.wl-skills-bd/schemas/contract.schema.json
```

可从 `.github/templates/examples/feature-category.contract.json` 复制起步。契约必须显式声明：

- 兼容性 profile、根包、业务模块、实体与表；
- Controller 请求根路径、网关外部路径和五个逐操作权限码；
- Oracle/MySQL 类型、Java 类型、可写/查询/详情/列表字段白名单；
- Flyway 版本、只读验证 SQL 和人工恢复策略；
- 可选的多模块输出目录。

已评审需求、前端 `api.md`、可选 design-model 和数据库设计都属于契约的上游依据，不能直接替代机器契约。bd 不依赖 design 或 kit 的产物：没有上游机器文件时，也必须能从评审事实独立形成并验证 `wl-contract.json`。多来源有差异时先评审并修正契约，再生成代码。

## 2. 生成前模块门

项目存在 `.wl-skills-bd/catalog.config.json` 时，先确认当前模块快照新鲜并生成有界上下文：

```bash
wl-skills-bd catalog check --module <module>
wl-skills-bd context plan --module <module> --task "<本次任务>" --json
```

codegen 会再次执行当前模块前置检查，并把模块目录及一跳快照的 `contextHash` 纳入 `planHash`。当前模块过期时阻断；关联模块只读取快照，不扫描源码目录。未启用 Catalog 的小型/存量项目保持原有独立生成链。

## 3. 三段式命令

```bash
# 只校验，不生成
wl-skills-bd codegen validate wl-contract.json

# 生成确定性计划，不写盘；JSON 结果便于 CI/MCP 消费
wl-skills-bd codegen plan wl-contract.json --json

# 只能携带刚刚评审过的 planHash，并显式确认
wl-skills-bd codegen apply wl-contract.json \
  --plan-hash <planHash> --confirm
```

`apply` 会在写入前重新计划。如果契约、模板或目标文件在 plan 后变化，哈希失效并拒绝写入。任何一个目标存在未受管或本地修改时，默认整批零写入。确需覆盖时使用 `--force`，原文件先备份到 `.wl-skills-bd/.state/codegen-backups/`。

如果本次不允许存在任何业务占位，可在 apply 增加 `--require-complete`。标准 CRUD 能直接通过；export、relation 或缺少确定性 patch 的自定义操作会以 `contract-incomplete` 零写入，直到换用完整契约或进入“先生成、后在保护区补齐”的流程。

## 4. 固定产物（17+N 个）

| 分层 | 产物 |
|---|---|
| API model（6+N） | Entity、CreateDTO、UpdateDTO、PageDTO、VO、PageVO；每个需要 body 的业务命令另生成 OperationRequestDTO |
| Web/Service（2） | Controller、直接继承 `JhServiceImpl` 的 Service |
| Persistence（2） | Mapper.java、Mapper.xml |
| Database（3） | Flyway `V...sql`、不进入 Flyway 目录的人工恢复说明、DDL_PREVIEW 评审报告 |
| Test（2） | ServiceTest、ControllerTest |
| Collaboration（2） | 机器可读 backend-contract.json、与 `wl-skills-kit` 对接的 api.md |

生成边界：

- CreateDTO 不含 id、租户、软删、版本和审计字段；UpdateDTO 强制 id/revision，业务字段使用 Patch 语义。
- 每个顶层业务字段必须显式声明 `writable`；命令请求字段必须由 patch.fromRequest 或已确认实现消费。
- PageDTO 的 JSON body 同时承载 current/size 与查询条件；命令统一使用 OperationRequestDTO，不生成散落 RequestParam。
- VO/PageVO 不继承 Entity；返回字段只能来自契约白名单。详情 VO 固定返回 revision，完成乐观锁读写闭环。
- Service 从 `AuthUtil` 取租户；更新/软删走显式原子 SQL，同时限定 ID、COMPANY_ID、IS_DELETE=1、REVISION 并检查影响行数。
- 自定义 batch 单次最多 1000 条，先完成全量存在性/前置条件校验，再在同一事务更新，避免捕获异常后提交半批数据。
- Mapper XML 显式列名、显式租户条件、常驻软删除条件和稳定排序。
- Flyway 只生成正向版本迁移；ALTER 强制 expand/contract 分阶段，版本不可变；恢复说明必须经 DBA/发布审批，不生成自动执行的 `U` 或反向 `V` 脚本。

## 5. 业务扩展保护区

生成器只能从契约确定标准 CRUD 和带实体 patch 的业务命令。export、relation 查询及缺少确定性 patch 的操作会在 Service 中生成 `<wl-custom name="...">` 区域，ServiceTest 中生成 `<wl-custom name="tests">` 区域。

- 只能在开始/结束标记之间补充业务实现和测试，不删除、重命名或嵌套标记；
- codegen 重新渲染时按 region name 合并现有内容；模板外部变化仍正常升级；
- 完成度检查要求方法体无 `UnsupportedOperationException/TODO/FIXME`，且 ServiceTest 存在真实 `@Test` 方法体、调用对应 Service 并包含 assertion 或 mock verify 证据；方法名、注释或空测试不算证据；
- 保护区以外的本地编辑仍按冲突处理，避免生成器猜测 Java 语义。

补齐后用 `contract show` 输出带本地实现证据的协作契约，`completion.contractStatus` 必须为 confirmed。

## 6. 生成后验证

每次生成完成后按顺序执行：

```bash
wl-skills-bd validate <本次生成目录> --strict
mvn test
mvn verify -Pwl-quality
```

包自身通过 `tests/java-compile-fixture.test.js` 将示例契约的生成结果交给真实 Java 8 编译器，覆盖模型、Controller、Service、Mapper 和两类测试模板。业务项目仍必须使用自己的依赖与 Maven profile 再编译一次。

DDL/数据变更还必须完成：

1. 人工检查 SQL diff、表归属、类型和治理字段；
2. 在目标数据库验证只读 SQL；
3. 完成 DBA/发布审批；
4. 先部署向后兼容的数据库变更，再部署应用；
5. 失败时按恢复说明 roll-forward 或人工处置。

## 7. 状态与污染控制

生成器仅管理 `.wl-skills-bd/.state/codegen-manifest.json` 中登记的文件。重复生成相同契约和相同工作区状态会得到相同 `planHash`；已删除模板产物只有在内容仍等于上次安装哈希时才会清理，已修改的过期文件会保留并报告。

禁止把 `.wl-skills-bd/.state/`、备份目录、生成预览目录或本地覆盖配置提交到业务仓库。

## 8. 前后端握手

同一个资源的路径、方法、请求字段、响应字段、分页结构和权限码必须来自同一契约。后端生成后至少同步以下内容给 `wl-skills-kit`：

- 五个操作路径与 HTTP 方法；
- Create/Update/Page 请求字段；
- VO/PageVO 返回字段；
- `ApiResult` 成功码 2000 与分页 `data.records`；
- 五个权限码和公开接口清单。

上述内容已由 `docs/contracts/{contractId}.backend-contract.json` 和 `.api.md` 自动生成，文件名保留兼容性，机器类型统一为 `wl-api-contract`。使用 `wl-skills-bd contract diff --strict` 同时核对页面 api.md、运行时 OpenAPI 3 JSON、权限清单和 completion；完整命令和差异码见 `frontend-backend-contract.md`。

契约差异未清零时不得以“前端适配一下”或“后端先兼容”绕过评审。

## 变更记录

- 2026-07-19 v0.15：增加当前模块 Catalog/Context 生成前置门，上下文哈希进入 codegen planHash。
- 2026-07-18 v0.14：升级为 17+N 产物；加入 OperationRequestDTO、DDL_PREVIEW、原子写、ALTER 阶段门和强测试证据。
- 2026-07-18：扩展为 16 个受管产物；增加网关外部路径、协作 manifest/api.md、OpenAPI/权限差异检查和 revision 读写闭环。
- 2026-07-18：切换为 schema/profile 驱动的确定性生成；增加 planHash、确认门、冲突零写入、备份与 Java 8 编译夹具。
- 2026-07-18：增加统一 delivery profile、`wl-api-contract`、业务保护区、实现/测试证据和 `--require-complete` 门。
