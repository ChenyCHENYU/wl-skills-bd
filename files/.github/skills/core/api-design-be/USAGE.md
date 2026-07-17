# 使用指南：接口设计（api-design-be）

> ⚠️ 当前 SKILL.md 仍为骨架，触发时按 **Spring MVC 官方 RESTful 约定 + standards/04** 落地。

## 触发词

```
接口设计 / 评审 api.md / 接口契约审查 / RESTful 校验
```

## 典型场景

### 场景 A：从前端 api.md 生成后端契约

```
用户：基于前端的 api.md 帮我评审后端契约
AI：  → 读前端 src/views/{module}/api.md
      → 校验 RESTful 命名 / 字段映射 / 错误码 / 权限码
      → 输出 docs/api/{module}.md（含权限码清单 + diff 摘要）
```

### 场景 B：纯后端起接口（无前端 api.md）

```
用户：给特征量分类设计 5 个 CRUD 接口
AI：  → 按 standards/04 命名（POST queryPage / GET getById/{id} / POST save / PUT updateById / DELETE deleteById/{id}）
      → 生成权限码 mdm_feature_category_query_page 等
      → 产出 docs/api/{module}.md（作为 codegen 输入）
```

## 权限码命名

`{module}_{resource}_{action}`（全小写下划线）。详见 standards/11。

## 预期产物

```
docs/api/{module}.md   ← 含 HTTP 方法/路径/入参出参/权限码
```

## FAQ

**Q：没前端 api.md 怎么办？**
A：可直接触发本 Skill 纯后端起契约，或补 api.md 后再来。

**Q：和 entity-codegen 什么关系？**
A：本 Skill 产出 api.md（契约），entity-codegen 消费它生成代码。无 api.md 不生成。
