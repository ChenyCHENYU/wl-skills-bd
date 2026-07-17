# 06 · Mapper XML 规范（✅ 已落地，依据 MyBatis/MyBatis-Plus 官方）

---

## Mapper 接口

```java
package com.jhict.mdm.mapper.feature;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.jhict.common.data.mapper.JhBaseMapper;
import com.jhict.common.data.mybatis.entity.JhPage;
import com.jhict.mdm.api.dto.feature.MdmFeatureCategoryPageDTO;
import com.jhict.mdm.api.entity.feature.MdmFeatureCategory;
import com.jhict.mdm.api.vo.feature.MdmFeatureCategoryPageVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface MdmFeatureCategoryMapper extends JhBaseMapper<MdmFeatureCategory> {

    String QUERY_PARAM_KEY = "param";

    /** 分页查询 */
    JhPage<MdmFeatureCategoryPageVO> queryPage(
            JhPage<MdmFeatureCategoryPageVO> page,
            @Param(QUERY_PARAM_KEY) MdmFeatureCategoryPageDTO pageDTO);

    /** 含 Lambda 表达式的便捷查询 */
    default MdmFeatureCategory getByFeatureKey(String featureKey) {
        return selectOne(Wrappers.<MdmFeatureCategory>lambdaQuery()
                .eq(MdmFeatureCategory::getFeatureKey, featureKey));
    }
}
```

**要点**：

- `@Mapper` 注解必加
- 继承 `JhBaseMapper<T>` 获得 MyBatis-Plus 通用 CRUD（`selectById` / `selectList` / `insert` / `updateById` / `deleteById` 等）
- 多参数方法用 `@Param`；DTO/Query 单参数也建议用 `@Param("param")` + XML 用 `param.xxx`
- 简单条件查询用 `Wrappers.lambdaQuery()`，复杂查询走 XML

---

## XML 完整骨架

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.jhict.mdm.mapper.feature.MdmFeatureCategoryMapper">

    <!-- ============ 公共字段（禁止 SELECT *） ============ -->
    <sql id="BaseColumns">
        ID AS id,
        CATEGORY_CODE AS categoryCode,
        CATEGORY_NAME AS categoryName,
        PARENT_ID AS parentId,
        FEATURE_KEY AS featureKey,
        FEATURE_TABLE AS featureTable,
        FEATURE_FIELD AS featureField,
        COMPANY_ID AS companyId,
        REVISION AS revision,
        IS_DELETE AS isDelete,
        CREATE_USER_NO AS createUserNo,
        CREATE_DATE_TIME AS createDateTime,
        UPDATE_USER_NO AS updateUserNo,
        UPDATE_DATE_TIME AS updateDateTime
    </sql>

    <!-- ============ 分页查询：默认不加 ORDER BY，由 JhPage 控制 ============ -->
    <select id="queryPage" resultType="com.jhict.mdm.api.vo.feature.MdmFeatureCategoryPageVO">
        SELECT <include refid="BaseColumns"/>
        FROM MDM_FEATURE_CATEGORY
        <where>
            AND IS_DELETE = 1
            <if test="param != null">
                <if test="param.categoryCode != null and param.categoryCode != ''">
                    AND CATEGORY_CODE LIKE CONCAT(CONCAT('%', #{param.categoryCode}), '%')
                </if>
                <if test="param.categoryName != null and param.categoryName != ''">
                    AND CATEGORY_NAME LIKE CONCAT(CONCAT('%', #{param.categoryName}), '%')
                </if>
                <if test="param.parentId != null and param.parentId != ''">
                    AND PARENT_ID = #{param.parentId,jdbcType=VARCHAR}
                </if>
            </if>
        </where>
    </select>

    <!-- ============ IN 查询 ============ -->
    <select id="selectByIds" resultType="com.jhict.mdm.api.entity.feature.MdmFeatureCategory">
        SELECT <include refid="BaseColumns"/>
        FROM MDM_FEATURE_CATEGORY
        WHERE IS_DELETE = 1
          AND ID IN
        <foreach collection="ids" item="id" open="(" separator="," close=")">
            #{id,jdbcType=VARCHAR}
        </foreach>
    </select>

    <!-- ============ Oracle 环境：TopN 用 ROWNUM 包裹，不用 LIMIT ============ -->
    <select id="selectTopN" resultType="com.jhict.mdm.api.entity.feature.MdmFeatureCategory">
        SELECT * FROM (
            SELECT <include refid="BaseColumns"/>
            FROM MDM_FEATURE_CATEGORY
            WHERE IS_DELETE = 1
            ORDER BY UPDATE_DATE_TIME DESC NULLS LAST
        ) WHERE ROWNUM &lt;= #{limit,jdbcType=INTEGER}
    </select>

    <!-- ============ MySQL 环境：TopN 用 LIMIT，NULLS LAST 改为 IS NULL 排序 ============ -->
    <!--
    <select id="selectTopN" resultType="...">
        SELECT <include refid="BaseColumns"/>
        FROM feature_category
        WHERE is_delete = 1
        ORDER BY update_date_time IS NULL, update_date_time DESC
        LIMIT #{limit,jdbcType=INTEGER}
    </select>
    -->

</mapper>
```

---

## 硬规则（违反必报）

1. **禁止 `SELECT *`**：必须 `<sql id="BaseColumns">` 显式列出
2. **模糊查询用** `CONCAT(CONCAT('%', #{x}), '%')`，**禁止** `%${x}%`（SQL 注入）
3. **XML 中 `<` `>` 转义** 为 `&lt;` / `&gt;`
4. **分页语法需区分数据库**：
   - **Oracle 项目**（主数据类等）：TopN 用 `ROWNUM` 子查询包裹，不用 `LIMIT`
   - **MySQL 项目**（主流）：`LIMIT #{offset}, #{size}`（MyBatis-Plus 内置分页拦截器自动生成，常规分页查询无需手写）
5. **JDBC Type 显式声明**：`#{x,jdbcType=VARCHAR}` / `#{id,jdbcType=BIGINT}`
6. **分页查询默认不加 `ORDER BY`**：排序由 `JhPage` / 业务前端传递；仅 TopN / 时间线显式排序
   - **Oracle**：`ORDER BY xxx DESC NULLS LAST`（`NULLS LAST` 为 Oracle 专有语法）
   - **MySQL**：`ORDER BY xxx IS NULL, xxx DESC`（用 IS NULL 表达将 NULL 排到末尾）
7. **软删除条件常驻**：所有 SELECT 必须含 `AND IS_DELETE = 1`
8. **IN 查询**用 `<foreach>`，不用字符串拼接
9. **批量 UPDATE / INSERT** 直接写 SQL，**手动维护** `UPDATE_DATE_TIME` / `UPDATE_USER_NO`

---

## 与外部 CLAUDE 规范的差异

| 维度        | 团队基线（MyBatis-Plus）                | CLAUDE（原生 MyBatis + HZERO）           |
| ----------- | --------------------------------------- | ----------------------------------------- |
| 通用 CRUD   | `JhBaseMapper` (MP `BaseMapper`) 自带   | `BaseMapper<T>` (HZERO)，需要 selectByPrimaryKey 等手写 |
| 主键        | 雪花 ID（String）                       | Oracle 序列 + 触发器                      |
| 乐观锁       | 不强制（通过 `REVISION` 字段，业务维护）| `OBJECT_VERSION_NUMBER` + `@VersionAudit` |
| 审计字段     | 自定义 `CREATE_DATE_TIME` 等            | `AuditDomain` 标配 `CREATION_DATE` 等     |
| 软删除       | `IS_DELETE = 1/0`                       | 不强制（业务自定）                        |

---

## 变更记录

- 2026-05-14 v0.0.1 落地（基于 `MdmFeatureCategoryMapper.xml/.java` + CLAUDE 共性 §八）
