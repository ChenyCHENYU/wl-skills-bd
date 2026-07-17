---
name: api-design-be
description: |
  后端 API 契约设计与评审 Skill。读取前端 wl-skills-kit 产出的 src/views/{module}/api.md，
  按团队基线（jh4j-cloud + ApiResult + @PreAuthorize）生成 docs/api/{module}.md，
  含 HTTP 方法、路径（驼峰）、入参 DTO、出参 VO、权限码清单、与前端 api.md 的 diff。
  典型触发：「设计接口」「评审 api.md」「接口契约审查」「接口对齐」
status: 🟡 骨架
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
✅ 已读取 standards/13-api-doc-swagger.md  → Swagger 注解
```

## 前置检查

- [ ] 是否存在前端 `src/views/{module}/api.md`？若无，提示用户先跑 wl-skills-kit 的 `api-contract` Skill
- [ ] 是否存在 `docs/business/{module}.md`？无则建议先跑 `business-doc-extract-be`

## 产物

`docs/api/{module}.md`，模板：

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

## 4. 与前端 api.md 的 diff
- 新增 / 缺失 / 字段名不一致项
```

## 约束（骨架）

- 路径使用驼峰（团队基线，**不**使用 kebab-case）
- 权限码命名 `{module}_{resource}_{action}` 全小写下划线
- 列表查询统一 POST + queryPage 路径
- 所有写接口必带权限码与 `@ApiOperation`
- 若前端 `api.md` 缺权限码 / 字段类型，**红色标注**而不擅自补全

## 完成摘要

```
✅ api-design-be 完成
   - 输出: docs/api/{module}.md
   - 接口数: N
   - 权限码新增: M
   - 与前端 diff: X 项不一致（详见报告 §4）
   - 下一步建议: ③ entity-codegen
```

> **当前 v0.0.1 骨架**：本 Skill 仅含框架，AI 触发时按 Spring MVC 官方 RESTful 约定 + standards/04 生成契约。
