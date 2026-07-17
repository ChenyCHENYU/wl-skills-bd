---
name: entity-codegen
description: |
  按 docs/api/{module}.md 契约 + 数据库 DDL 生成 Entity / DTO / VO / Query。
  Entity 含 MyBatis-Plus 注解 + 审计 5 件套；DTO 含 @Validated；VO 含 @ApiModelProperty。
  典型触发：「生成实体」「Entity」「DTO」「VO」「数据模型」
status: 🟡 骨架
stage: ③ 数据模型
---

# entity-codegen

## Pre-flight 声明（必填）

```
🚀 已触发技能 entity-codegen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 B
✅ 已读取 standards/02-project-structure.md
✅ 已读取 standards/03-naming.md
✅ 已读取 standards/07-entity-dto-vo.md
✅ 已读取 standards/12-database-ddl.md   → 字段类型映射
```

## 前置检查

- [ ] 是否存在 `docs/api/{module}.md`？若无，回退到 `api-design-be`
- [ ] 是否存在 DDL 脚本或表结构 dump？字段类型必须有依据

## ★ 生成方式：读模板填空（非自由发挥）

**必须**先读对应模板骨架，按占位符替换生成，禁止凭记忆从零写：

| 产物 | 模板 | 填空变量 |
|------|------|---------|
| Entity | `templates/Entity.java.tmpl` | rootPackage/module/Entity/table/fields |
| DTO | `templates/DTO.java.tmpl` | + required/notNull/maxLength（按字段约束）|
| PageDTO | `templates/PageDTO.java.tmpl` | queryFields（全可选）|
| VO | `templates/VO.java.tmpl` | displayFields（外键名等展示字段）|

> 模板路径见 `.github/templates/README.md`。模板固化了团队基线（CoreEntity/@Validated/Swagger/审计字段），改模板即改基线。

## 产物

```
xxx-entity/src/main/java/com/{co}/{prod}/api/entity/{module}/{Entity}.java
xxx-entity/src/main/java/com/{co}/{prod}/api/dto/{module}/{Entity}DTO.java
xxx-entity/src/main/java/com/{co}/{prod}/api/dto/{module}/{Entity}PageDTO.java
xxx-entity/src/main/java/com/{co}/{prod}/api/vo/{module}/{Entity}VO.java
xxx-entity/src/main/java/com/{co}/{prod}/api/vo/{module}/{Entity}PageVO.java
```

## 约束（骨架）

- Entity 必带 `@TableName` / `@TableField` / `@TableId(type=IdType.INPUT)`
- Entity 必含审计 5 件套（createUserNo/createDateTime/updateUserNo/updateDateTime/revision）
- Entity 含 `isDelete: Integer`
- DTO 中必填字段加 `@NotBlank` / `@NotNull` + 业务校验注解
- VO **不复用** Entity；列表 VO / 详情 VO 按需拆分
- 全字段加 `@ApiModelProperty`，时间字段加 `example`
- Lombok `@Data` + `implements Serializable` + `serialVersionUID = 1L`

## 完成摘要

```
✅ entity-codegen 完成
   - 产出: 5 个文件（基于 templates 填空）
   - 字段数: Entity={n}, DTO={n}, VO={n}
   - 必填校验: {n} 个
   - ★ 生成后自检: 已跑 wl-skills-bd validate（或建议用户跑）
   - 下一步建议: ④ service-codegen
```
