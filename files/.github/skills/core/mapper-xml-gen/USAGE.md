# 使用指南：生成 Mapper 数据访问（mapper-xml-gen）

生成 MyBatis Mapper 接口 + XML。XML 含 BaseColumns 显式字段、分页 select、动态条件、IN 查询。禁止 SELECT 星号、禁止美元符注入。

## 触发词

```
生成 Mapper / Mapper XML / 写 SQL / 自定义查询 / 分页 SQL / 生成数据访问层
```

## 典型场景

### 场景 A：标准分页查询（最常见）

输入：Entity + PageDTO
产出：Mapper.java（含 queryPage 方法）+ Mapper.xml（BaseColumns + 分页 select）

```
用户：帮我生成 特征量分类 的 Mapper 和分页查询
AI：  → 读 Entity 字段 → 展开 BaseColumns
      → 按 PageDTO 字段生成 <where><if> 动态条件
      → 软删除常驻 AND IS_DELETE = 1
```

### 场景 B：联表查询（JOIN）

联表补关联表名称字段：

```xml
<select id="queryPage" resultType="...MdmFeatureCategoryPageVO">
    SELECT
        t.ID, t.CATEGORY_CODE, t.CATEGORY_NAME,
        d.DESIGN_NAME AS designName              <!-- 关联表字段 -->
    FROM MDM_FEATURE_CATEGORY t
    LEFT JOIN MDM_FEATURE_DESIGN d ON t.DESIGN_ID = d.ID
    <where>
        AND t.IS_DELETE = 1
        <if test="param.categoryName != null and param.categoryName != ''">
            AND t.CATEGORY_NAME LIKE CONCAT(CONCAT('%', #{param.categoryName}), '%')
        </if>
    </where>
    ORDER BY t.CREATE_DATE_TIME DESC
</select>
```

> JOIN 时 resultType 用 PageVO（含关联字段 designName）。

### 场景 C：批量 IN 查询

```xml
<select id="selectByIds" resultType="...MdmFeatureCategory">
    SELECT <include refid="BaseColumns"/>
    FROM MDM_FEATURE_CATEGORY t
    WHERE t.IS_DELETE = 1
    AND t.ID IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

### 场景 D：简单查询（无需 XML）

简单条件查询用 Mapper 接口的 default 方法 + lambdaQuery，不写 XML：

```java
default MdmFeatureCategory getByCode(String code) {
    return selectOne(Wrappers.<MdmFeatureCategory>lambdaQuery()
            .eq(MdmFeatureCategory::getCategoryCode, code)
            .eq(MdmFeatureCategory::getIsDelete, 1));
}
```

> 复杂联表/动态条件才写 XML，简单的用 lambdaQuery。

## Oracle vs MySQL 速查

| 维度 | Oracle | MySQL |
|------|--------|-------|
| 模糊查询 | `CONCAT(CONCAT('%', #{x}), '%')` | `CONCAT('%', #{x}, '%')` |
| 分页 | MP 拦截器自动 ROWNUM | MP 拦截器自动 LIMIT |
| 字符串拼接 | `||` 或 CONCAT（仅2参）| CONCAT（多参）|
| NULL排序 | `NULLS LAST` | 默认 NULL 在前 |
| 日期函数 | `SYSDATE` / `TO_DATE` | `NOW()` / `STR_TO_DATE` |

> 分页**通常不用手写**——MyBatis-Plus 分页拦截器自动包裹。XML 只写 select 主体。

## validate 自检对照

| 规则 | 查什么 | 修复 |
|------|--------|------|
| B3 | `SELECT *` | 改 `<include refid="BaseColumns"/>` 显式列 |
| B4 | `${xxx}` 美元符拼接 | 改 `#{xxx}` 参数化（防注入）|
| B7 | SELECT 无 COMPANY_ID（启发式）| 确认是否需租户过滤 |

## 正反例

```
✅ <include refid="BaseColumns"/>
   AND t.NAME LIKE CONCAT(CONCAT('%', #{param.name}), '%')

❌ SELECT *                               B3 error
   WHERE name = '${name}'                 B4 error（注入风险）
```

## FAQ

**Q：BaseColumns 要不要包含审计字段（COMPANY_ID/IS_DELETE 等）？**
A：要。分页查询通常需要显示创建时间、创建人。IS_DELETE 在 where 条件常驻，不在 select 列也行，但建议列出。

**Q：namespace 写什么？**
A：Mapper.java 的全限定名，必须完全一致，否则 MyBatis 绑定失败。

**Q：XML 文件放哪？**
A：`xxx-service/src/main/resources/mapper/{module}/{Entity}Mapper.xml`。路径在 application.yml 的 `mybatis-plus.mapper-locations` 配置。

**Q：为什么模糊查询 Oracle 要嵌套两个 CONCAT？**
A：Oracle 的 CONCAT 只接受 2 个参数，不能 `CONCAT('%', x, '%')`，必须嵌套 `CONCAT(CONCAT('%', x), '%')`。MySQL 支持多参。

**Q：分页 SQL 要自己写 LIMIT/ROWNUM 吗？**
A：不用。MyBatis-Plus 分页拦截器（`PaginationInnerInterceptor`）自动包裹。XML 只写普通 select，传入 `JhPage` 对象即可。
