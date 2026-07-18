---
name: api-design-be
description: |
  后端 API 契约设计与评审 Skill。读取前端 wl-skills-kit 产出的 src/views/{module}/api.md，
  按团队基线形成可校验的 wl-contract.json，再由 codegen 同步生成源码、wl-api-contract JSON 和 api.md，
  并核对 HTTP 方法、路径、DTO/VO、OpenAPI 与权限清单。
  典型触发：「设计接口」「评审 api.md」「接口契约审查」「接口对齐」
status: ✅ 已落地
stage: ② 设计阶段
---

# api-design-be

## Pre-flight 声明（必填）

```
🚀 已触发技能 api-design-be/SKILL.md       → 后端 API 契约设计
✅ 已读取 standards/index.md               → 任务类型 F
✅ 已读取 standards/03-naming.md           → 路径与字段命名
✅ 已读取 standards/04-controller.md       → Controller 模板
✅ 已读取 standards/11-security-permission.md → 权限码规范
✅ 已读取 standards/13-api-doc-swagger.md  → OpenAPI 3 注解
```

## 前置检查

- [ ] 是否存在前端 `src/views/{module}/api.md` 或经后端确认的等价接口输入？若无，停止并列出缺失信息
- [ ] 是否存在 `docs/business/{module}.md`？无则建议先跑 `business-doc-extract-be`

## 产物

先产出符合 `.wl-skills-bd/schemas/contract.schema.json` 的 `wl-contract.json`。`api.requestPath` 是 Controller 路径，`api.externalBasePath` 是前端经过网关调用的完整资源根路径，两者都必须明确。

执行：

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
```

计划确认后，codegen 同步生成 `docs/contracts/{contractId}.backend-contract.json` 与 `.api.md`。可读输出结构示例：

```markdown
# {模块} API 契约 v{x.y}

## 1. 资源路径
- 类路径：`/mdmFeatureCategory`
- 权限码前缀：`mdm_feature_category_`

## 2. 接口清单
| Method | Path                        | Operation          | 权限码                                | DTO                              | VO                          |
| ------ | --------------------------- | ------------------ | ------------------------------------- | -------------------------------- | --------------------------- |
| POST   | `/mdmFeatureCategory/queryPage` | 分页查询       | `mdm_feature_category_query_page`     | `MdmFeatureCategoryPageDTO`      | `JhPage<...PageVO>`         |
| ...    | ...                         | ...                | ...                                   | ...                              | ...                         |

## 3. DTO / VO 字段
...

## 4. 与前端 api.md / OpenAPI / 权限清单的 diff
- 新增 / 缺失 / 字段名不一致项
```

## 约束

- 路径使用驼峰（团队基线，**不**使用 kebab-case）
- 权限码命名 `{module}_{resource}_{action}` 全小写下划线
- 列表查询统一 POST + queryPage 路径
- 所有写接口必带权限码与 `@Operation`
- 若前端 `api.md` 缺权限码 / 字段类型，报告差异而不擅自补全
- 当前 Profile 固定 queryPage/getById/{id}/save/updateById/deleteById/{id}；需要另一套路由时新增兼容性 Profile，不做资源级临时覆盖
- 更新必须形成 `详情 revision → UpdateDTO id+revision` 的乐观锁闭环

## 完成摘要

```
✅ api-design-be 完成
   - 输出: wl-contract.json + docs/contracts/{contractId}.{backend-contract.json,api.md}
   - 接口数: N
   - 权限码新增: M
   - contract diff: X error / Y warning
   - 下一步建议: ③ entity-codegen
```

差异命令与 C1xx/C2xx/C3xx 规则见 `.github/guides/frontend-backend-contract.md`。
