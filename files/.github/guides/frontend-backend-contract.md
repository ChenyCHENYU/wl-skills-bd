# 前后端独立闭环与协同契约

本指南定义 `wl-skills-bd` 与 `wl-skills-kit` 的协作边界：两个包都能从已评审需求独立开工，也能通过同一份 `wl-api-contract` 严格联调。`wl-skills-design` 能补充稳定 ID、页面结构和追溯关系，但不是 kit 或 bd 的运行前置依赖。

## 1. 独立，但不各说各话

每个包都内置同版本 `wl-delivery-profile.v1.json`。默认 Profile 是 `jh4j3-openapi3@1.0`，统一以下事实：

- 标准操作：`queryPage`、`getById/{id}`、`save`、`updateById`、`deleteById/{id}`；
- HTTP 方法：POST、GET、POST、PUT、DELETE；
- 响应：`{ code, message, data }`，业务成功码 `2000`；
- 分页：`data.records` / `data.total`；
- 主键是 string，更新使用 `id + revision` 乐观锁。

因此存在三种合法路径：

1. 端到端：design-model → kit + bd → 严格联调；
2. 无 design：评审需求 → kit + bd → 严格联调；
3. 单包：评审需求 → kit 或 bd 独立完成本侧工作，并输出标准契约供以后接入。

上游产物只能减少重复录入，不能成为下游硬依赖。若项目内放置同名 delivery profile，安装包会校验它与内置 Profile 是否漂移，不能静默覆盖。

## 2. 后端独立输入

后端代码生成只消费符合 `.wl-skills-bd/schemas/contract.schema.json` 的 `wl-contract.json`。可从安装后的示例复制，并根据评审需求填写字段、路径、权限、数据库和业务命令：

```bash
cp .github/templates/examples/feature-category.contract.json wl-contract.json
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm
```

不要求存在 design-model 或前端产物。若存在 `externalId`，它只作为可选追溯桥，不影响独立生成。

## 3. 统一机器契约

codegen 与 `contract show` 输出 `kind=wl-api-contract`、`protocolVersion=1.0` 的机器契约，包含：

- `source.profile`：交付 Profile；
- `resource`：资源、模块、权限前缀及可选稳定 ID；
- `transport`：响应、分页与外部根路径；
- `operations`：方法、路径、权限、请求/响应模型；
- `models`：前后端字段类型与必填性；
- `frontend.apiConfig`：前端实际请求地址；
- `completion`：confirmed/draft、未决问题、偏差和业务骨架清单。

Markdown 中必须且只能有一个 `wl-api-contract` fenced block。旧 `wl-backend-contract` 和纯文本 api.md 只在非严格模式兼容，并产生 warning；它们不能通过发布级 `--strict`。

## 4. 可编译不等于业务完成

标准 CRUD 由生成器完整实现。以下内容没有足够业务事实时会生成可编译占位并标记 draft：

- export 的格式、列、数据量与流式策略；
- relation 查询的实际从表 Service；
- 没有实体主键或确定性 patch 的自定义操作。

这些方法和 `ServiceTest` 含 `<wl-custom>` 受保护区。只在保护区内补充实现和测试；后续 codegen 会原样合并，不把正常业务补全误报为污染，也不会覆盖它。完成度检查同时要求：

- 对应 Service 方法体不再包含 `UnsupportedOperationException`、TODO 或 FIXME；
- 对应 ServiceTest 存在该方法的测试调用。

查看带本地实现证据的最终契约：

```bash
wl-skills-bd contract show wl-contract.json --format markdown \
  --output docs/contracts/feature.verified.api.md
```

首次生成若要求全部由生成器直接完成，可加 `--require-complete`；发现 draft 时整批零写入：

```bash
wl-skills-bd codegen apply wl-contract.json \
  --plan-hash <hash> --confirm --require-complete
```

## 5. 严格联调

kit 和 bd 可各自从需求建立契约，联调时比较结构化机器块：

```bash
wl-skills-bd contract diff wl-contract.json \
  --frontend <kit-page-api.md> \
  --openapi <runtime-openapi.json> \
  --permissions <permission-inventory.json> \
  --strict --json
```

严格模式阻断：

- Profile/协议、资源核心标识不一致；
- method/path/API_CONFIG/权限不一致；
- 请求、响应、分页或 revision 模型不一致；
- 前端或后端 completion 不是 confirmed；
- 仍有 openQuestions；
- 降级到旧版文本检查或 OpenAPI/权限证据不足产生阻断 warning。

`externalId` 只在两侧都提供且值不同时阻断；一侧缺失产生非阻断 C113，保证没有 design 包时仍能通过严格闭环。

## 6. 路径和权限边界

后端契约同时声明：

- `requestPath`：Controller 类级路径，例如 `mdmFeatureCategory`；
- `externalBasePath`：前端经过网关调用的路径，例如 `/mdm/mdmFeatureCategory`。

`externalBasePath` 必填且必须以 `/requestPath` 结尾。生成器不猜网关拓扑。权限码由 bd 契约确定，可导出为 kit 权限清单片段：

```bash
wl-skills-bd permissions export wl-contract.json \
  --output reports/SYS_PERMISSION_INFO.md
```

## 7. 发布闭环

建议 CI 顺序：

1. `codegen plan` 无冲突；受保护区修改应保持 `unchanged`；
2. `contract show` 的 completion 为 confirmed；
3. `contract diff --strict` 比较 kit 契约、运行时 OpenAPI 和权限清单；
4. `wl-skills-bd validate . --strict`；
5. `mvn test && mvn verify -Pwl-quality`；
6. DDL 另行完成 DBA diff、只读验证、审批和恢复策略评审。

任何 error、阻断 warning、draft 或未决问题未清零，都不能宣称前后端闭环完成；唯一例外是缺少可选 design 追溯 ID 的 C113。

## 变更记录

- 2026-07-18 v3：统一 `wl-api-contract` 与 delivery profile；明确各包独立工作、可选 design 追溯、业务保护区和严格完成度门。
- 2026-07-18 v2：增加 kit 文本兼容校验和权限码搬运。
- 2026-07-18 v1：建立后端契约到前端、OpenAPI 和权限清单的可执行闭环。
