---
name: mapper-xml-gen
description: |
  生成 MyBatis Mapper 接口 + XML。XML 含 BaseColumns sql 片段、分页 select、IN 查询 foreach。
  禁止 SELECT *、禁止 ${} 拼接、Oracle 分页用 ROWNUM、模糊查询用 CONCAT(CONCAT('%',#{x}),'%')。
  典型触发：「生成 Mapper」「Mapper XML」「写 SQL」「自定义查询」
status: 🟡 骨架
stage: ⑤ 数据访问
---

# mapper-xml-gen

## Pre-flight 声明（必填）

```
🚀 已触发技能 mapper-xml-gen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 C
✅ 已读取 standards/06-mapper-xml.md     → XML 硬规则
✅ 已读取 standards/02-project-structure.md
```

## 前置检查

- [ ] Entity 已存在
- [ ] 表结构 / DDL 可见
- [ ] 字段类型对应清楚（VARCHAR2 → String，NUMBER → Integer/Long/BigDecimal）

## 产物

```
xxx-service/.../mapper/{module}/{Entity}Mapper.java
xxx-service/src/main/resources/mapper/{module}/{Entity}Mapper.xml
```

## 约束（骨架）

**Mapper 接口**：

- `@Mapper` 必加
- 继承 `JhBaseMapper<T>`
- 多参用 `@Param`，DTO 用 `@Param("param")` 配合 XML `param.xxx`
- 简单查询用 `Wrappers.lambdaQuery()` 写 default 方法

**Mapper XML**：

- `<sql id="BaseColumns">` 显式列出字段（禁 SELECT *）
- `<where>` + `<if test="...">` 做动态条件
- 模糊查询：`CONCAT(CONCAT('%', #{x}), '%')`
- IN 查询：`<foreach>`
- Oracle 分页：`ROWNUM` 子查询，**不用** LIMIT
- 软删除条件常驻：`AND IS_DELETE = 1`
- 所有 `#{x}` 显式带 `jdbcType`
- 转义：`<` → `&lt;`，`>` → `&gt;`

## 完成摘要

```
✅ mapper-xml-gen 完成
   - 产出: 2 个文件
   - 自定义 SQL 数: N
   - BaseColumns 字段数: M
   - 下一步建议: ⑥ db-migration（如果新表）或 ⑦ unit-test-gen
```
