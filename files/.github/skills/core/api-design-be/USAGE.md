# 使用指南：api-design-be

该 Skill 已落地，目标是把业务/前端接口事实收敛成严格的 `wl-contract.json`，而不是直接从自然语言自由生成 Java。

## 最短流程

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd contract show wl-contract.json --format markdown
```

确认计划后：

```bash
wl-skills-bd codegen apply wl-contract.json --plan-hash <sha256> --confirm
```

## 必须确认的事实

- `profile`：当前支持 `jh4j3-openapi3`；
- `rootPackage/module/entity/table`；
- `api.requestPath` 与前端经过网关调用的 `api.externalBasePath`；
- page/detail/create/update/remove 五类权限码；
- Oracle/MySQL、迁移版本、验证 SQL 与不少于 20 字的恢复策略；
- 字段的 Java/DB 类型、创建必填、可写性、查询模式和列表/详情可见性。

缺少上述信息时输出缺口，不猜值。详情响应和 UpdateDTO 必须共同携带 `revision`，请求 DTO 不接受 `companyId`。

## 协作核对

```bash
wl-skills-bd contract diff wl-contract.json \
  --frontend docs/contracts/page.api.md \
  --openapi openapi.json \
  --permissions permissions.json \
  --strict
```

前端 Markdown 必须含唯一 fenced `wl-api-contract` JSON；旧机器块只允许非严格兼容。JSON 权限清单可以是字符串数组；文本清单会按权限码证据查找。`--strict` 还要求前后端 completion confirmed，并阻断证据不足或旧格式 warning；仅缺少可选 design `externalId` 的 C113 不阻断。

## 典型场景

- 无 design：直接从已评审需求分别建立 bd/kit 契约，再 strict diff；
- 前端先行：读取前端 `api.md`，把路径、字段、分页包装和权限码映射到契约，再 diff；
- 后端先行：先与业务/前端确认完整接口事实，创建契约和协作产物，由前端消费；
- 接口变更：只更新契约，重新 plan 查看影响面，不直接批量手改生成代码。

## 产物

codegen 会同步生成 `docs/contracts/{contractId}.backend-contract.json` 与 `.api.md`。二者是协作快照，机器事实仍是 `wl-contract.json`。
