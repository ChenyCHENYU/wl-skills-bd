---
name: mapper-xml-gen
description: |
  生成 MyBatis Mapper 接口 + XML。XML 含 BaseColumns 显式字段、分页 select、动态条件、IN 查询 foreach。
  禁止 SELECT 星号、禁止美元符注入、Oracle 分页用 ROWNUM、模糊查询按方言。
  读 templates 填空，生成后跑 validate 查 B3/B4。对标 wl-skills-kit/mapper-xml-gen 落地深度。
  典型触发：「生成 Mapper」「Mapper XML」「写 SQL」「自定义查询」「分页 SQL」
status: ✅ 已落地
stage: ⑤ 数据访问
---

# mapper-xml-gen

## Pre-flight 声明（必填）

```
🚀 已触发技能 mapper-xml-gen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 C
✅ 已读取 standards/06-mapper-xml.md     → XML 硬规则
✅ 已读取 standards/02-project-structure.md → 包路径
✅ 已读取 templates/Mapper.java.tmpl + Mapper.xml.tmpl
✅ 数据库类型确认：{MySQL|Oracle}（决定分页/CONCAT/注释语法）
✅ Entity 已存在（字段来源）
```

## 前置检查

- [ ] Entity 已存在（步骤 ③ 产出）
- [ ] 表结构 / DDL 可见（字段列名依据）
- [ ] 数据库类型已确认（MySQL 用 LIMIT + 行内 COMMENT；Oracle 用 ROWNUM + COMMENT ON）

---

## 执行步骤（4 步）

### 步骤 1：生成 Mapper 接口

读 `templates/Mapper.java.tmpl`：

```java
@Mapper
public interface {Entity}Mapper extends JhBaseMapper<{Entity}> {
    JhPage<{Entity}PageVO> queryPage(JhPage<{Entity}PageVO> page, @Param("param") {Entity}PageDTO pageDTO);
}
```

- 继承 `JhBaseMapper<Entity>` 获基础 CRUD；默认业务模板只生成租户安全查询和软删除流程，不暴露物理删除
- 分页方法签名固定（`@Param("param")` 配合 XML `param.xxx`）
- 简单查询用 default 方法 + lambdaQuery，不写 XML：

```java
default {Entity} getByCode(String code) {
    return selectOne(Wrappers.<{Entity}>lambdaQuery().eq({Entity}::getCode, code));
}
```

### 步骤 2：生成 BaseColumns（从 Entity 字段循环）

读 `templates/Mapper.xml.tmpl`，`<sql id="BaseColumns">` 按 Entity 字段展开：

```xml
<sql id="BaseColumns">
    t.ID               AS id,
    t.CATEGORY_CODE    AS categoryCode,      <!-- 按 Entity 字段逐个映射 -->
    t.CATEGORY_NAME    AS categoryName,
    t.COMPANY_ID       AS companyId,          <!-- 审计字段也显式列出 -->
    t.IS_DELETE        AS isDelete,
    ...
</sql>
```

> **禁止 SELECT 星号**（validate B3 卡控）。每个字段 `t.COLUMN AS field` 显式映射。

### 步骤 3：生成动态查询（分页 select）

按 PageDTO 字段生成 `<where>` + `<if>`：

| 查询类型 | 写法 | 适用 |
|---------|------|------|
| 精确匹配 | `AND t.COL = #{param.field}` | 编码/状态 |
| 模糊匹配 | `AND t.COL LIKE CONCAT(CONCAT('%', #{param.field}), '%')` | 名称（Oracle）|
| 模糊匹配 | `AND t.COL LIKE CONCAT('%', #{param.field}, '%')` | 名称（MySQL）|
| 范围 | `AND t.COL >= #{param.start} AND t.COL <= #{param.end}` | 时间范围 |
| 多值 IN | `<foreach collection="param.ids" item="id" ...>` | 批量查询 |

**软删除条件常驻**（where 内首行）：

列名和有效值必须读取当前 profile。下例仅表示默认 profile；不得把 `1/0` 复制到已有项目。

```xml
<where>
    AND t.IS_DELETE = 1          <!-- 1=有效，0=删除，常驻 -->
    <if test="param.categoryCode != null and param.categoryCode != ''">
        AND t.CATEGORY_CODE LIKE CONCAT(CONCAT('%', #{param.categoryCode}), '%')
    </if>
</where>
ORDER BY t.CREATE_DATE_TIME DESC
```

### 步骤 4：Oracle vs MySQL 差异处理

| 维度 | Oracle | MySQL |
|------|--------|-------|
| 分页 | `ROWNUM` 子查询（`WHERE ROWNUM <= N`）| `LIMIT #{offset}, #{size}`（MP 拦截器自动）|
| 模糊 | `CONCAT(CONCAT('%', #{x}), '%')`（仅2参）| `CONCAT('%', #{x}, '%')`（3参）|
| 注释 | `COMMENT ON COLUMN` 单独语句 | `COMMENT '...'` 行内 |
| NULL排序 | `ORDER BY x DESC NULLS LAST` | `ORDER BY x DESC`（NULL 默认在前）|

> 分页**通常不用手写**：MyBatis-Plus 分页拦截器自动包裹。XML 只写 select 主体，MP 自动加 LIMIT/ROWNUM。

---

## 产物（2 文件）

```
xxx-service/.../mapper/{module}/{Entity}Mapper.java
xxx-service/src/main/resources/mapper/{module}/{Entity}Mapper.xml
```

> XML 的 namespace 必须与 Mapper.java 全限定名完全一致。

---

## 约束（强制）

**Mapper 接口**：
- `@Mapper` 必加
- 继承 `JhBaseMapper<T>`
- 多参用 `@Param`，DTO 用 `@Param("param")`

**Mapper XML**：
- **禁止** `SELECT *`（B3 error）
- **禁止** `${}` 拼接（B4 error，SQL 注入）；统一用 `#{x}`
- `<sql id="BaseColumns">` 显式列字段
- `<where>` + `<if>` 动态条件
- 软删除条件常驻 `AND <profile.softDelete.column> = <profile.softDelete.activeValue>`
- 转义：`<` → `&lt;`，`>` → `&gt;`，`&` → `&amp;`
- 模糊查询按数据库方言（见步骤 4）

---

## 边界用例

| 场景 | 处理 |
|------|------|
| 联表 JOIN | LEFT JOIN 补关联表字段，resultType 用 PageVO（含关联字段）|
| 动态排序 | `<choose><when test="param.sortField==...">ORDER BY ...</when></choose>` |
| 批量 IN | `<foreach collection="param.ids" item="id" open="(" separator="," close=")">#{id}</foreach>` |
| EXISTS 子查询 | `WHERE EXISTS (SELECT 1 FROM ... WHERE ...)` |
| 大字段延迟 | BaseColumns 不含 CLOB，详情查询单独 select |
| COMPANY_ID 过滤 | B7 启发式检查（需确认是否租户隔离场景）|

---

## 正反例对照

```
✅ <include refid="BaseColumns"/>           显式字段片段
   <where>
     AND t.IS_DELETE = 1                    默认 profile 的软删常驻示例
     AND t.NAME LIKE CONCAT(CONCAT('%', #{param.name}), '%')   #{} 安全

❌ SELECT * FROM table                      B3 error（禁星号）
   WHERE name LIKE '%${name}%'              B4 error（美元符注入）
   （无 IS_DELETE 条件）                     B7 软删遗漏
```

---

## 完成摘要

```
✅ mapper-xml-gen 完成
   - 产出: Mapper.java + Mapper.xml（基于 templates 填空）
   - 自定义 SQL 数: {N}
   - BaseColumns 字段数: {M}
   - 方言: {Oracle|MySQL}
   - ★ 生成后自检: wl-skills-bd validate（B3 SELECT星号 / B4 美元符注入 / B7 缺COMPANY_ID）
   - 下一步建议: ⑥ db-migration（如果新表）或 ⑦ unit-test-gen
```

## 变更记录
- 2026-07-17 v0.4 补厚落地（执行步骤 + BaseColumns + 动态条件 + 方言差异 + 边界用例 + 正反例）+ USAGE.md
- 2026-07-17 v0.2 加 templates 引用
- 2026-05-14 v0.0.1 骨架
