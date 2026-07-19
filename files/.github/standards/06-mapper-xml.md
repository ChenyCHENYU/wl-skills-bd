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
            @Param(QUERY_PARAM_KEY) MdmFeatureCategoryPageDTO pageDTO,
            @Param("companyId") String companyId);

    /** 含 Lambda 表达式的便捷查询 */
    default MdmFeatureCategory getByFeatureKey(String featureKey) {
        return selectOne(Wrappers.<MdmFeatureCategory>lambdaQuery()
                .eq(MdmFeatureCategory::getFeatureKey, featureKey));
    }
}
```

**要点**：

- `@Mapper` 注解必加
- 继承 `JhBaseMapper<T>` 复用基础读写能力；受管业务更新和删除不得直接调用通用 `updateById/deleteById`，必须走下述原子 Mapper 方法
- 多参数方法用 `@Param`；租户参数必须由 Service 从 `AuthUtil` 获取，禁止从 DTO 透传
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

    <!-- ============ 分页查询：租户/软删条件常驻，排序来自契约白名单 ============ -->
    <select id="queryPage" resultType="com.jhict.mdm.api.vo.feature.MdmFeatureCategoryPageVO">
        SELECT <include refid="BaseColumns"/>
        FROM MDM_FEATURE_CATEGORY
        <where>
            AND IS_DELETE = 1
            AND COMPANY_ID = #{companyId,jdbcType=VARCHAR}
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
        ORDER BY CREATE_DATE_TIME DESC, ID DESC
    </select>

    <!-- ============ IN 查询 ============ -->
    <select id="selectByIds" resultType="com.jhict.mdm.api.entity.feature.MdmFeatureCategory">
        SELECT <include refid="BaseColumns"/>
        FROM MDM_FEATURE_CATEGORY
        WHERE IS_DELETE = 1
          AND COMPANY_ID = #{companyId,jdbcType=VARCHAR}
          AND ID IN
        <foreach collection="ids" item="id" open="(" separator="," close=")">
            #{id,jdbcType=VARCHAR}
        </foreach>
    </select>

    <!-- ============ Oracle 环境：TopN 用 ROWNUM 包裹，不用 LIMIT ============ -->
    <select id="selectTopN" resultType="com.jhict.mdm.api.entity.feature.MdmFeatureCategory">
        SELECT id, categoryCode, categoryName, parentId, featureKey, featureTable,
               featureField, companyId, revision, isDelete, createUserNo,
               createDateTime, updateUserNo, updateDateTime
        FROM (
            SELECT <include refid="BaseColumns"/>
            FROM MDM_FEATURE_CATEGORY
            WHERE IS_DELETE = 1
              AND COMPANY_ID = #{companyId,jdbcType=VARCHAR}
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
6. **分页必须稳定排序**：默认使用契约声明的固定列并追加 ID；前端排序字段只能映射到服务端白名单，禁止 `${sortField}` 直拼
   - **Oracle**：`ORDER BY xxx DESC NULLS LAST`（`NULLS LAST` 为 Oracle 专有语法）
   - **MySQL**：`ORDER BY xxx IS NULL, xxx DESC`（用 IS NULL 表达将 NULL 排到末尾）
7. **软删除与租户条件常驻**：所有业务 SELECT/UPDATE/DELETE 必须含 `IS_DELETE = 1` 和 `COMPANY_ID = #{companyId}`，或由 doctor 验证的统一插件注入
8. **IN 查询**用 `<foreach>`，不用字符串拼接
9. **批量 UPDATE / INSERT** 必须限定租户、检查影响行数，并维护 `REVISION/UPDATE_*`；物理删除不进入默认模板
10. **受管 UPDATE/软删必须原子化**：WHERE 同时包含 `ID`、`COMPANY_ID`、`IS_DELETE = 1`、`REVISION = expectedRevision`，SET 中执行 `REVISION = REVISION + 1`；影响行数不是 1 即视为越权/已删除/并发冲突
11. **动态 WHERE 不算安全边界**：禁止仅依赖 `<where><if .../></where>`，也禁止 `WHERE 1=1/TRUE`；租户和有效标记谓词必须无条件常驻

---

## 与外部 CLAUDE 规范的差异

| 维度        | 团队基线（MyBatis-Plus）                | CLAUDE（原生 MyBatis + HZERO）           |
| ----------- | --------------------------------------- | ----------------------------------------- |
| 通用 CRUD   | `JhBaseMapper` (MP `BaseMapper`) 自带   | `BaseMapper<T>` (HZERO)，需要 selectByPrimaryKey 等手写 |
| 主键        | 雪花 ID（String）                       | Oracle 序列 + 触发器                      |
| 乐观锁       | `REVISION` + `@Version`，写操作强制检查影响行数 | `OBJECT_VERSION_NUMBER` + `@VersionAudit` |
| 审计字段     | 自定义 `CREATE_DATE_TIME` 等            | `AuditDomain` 标配 `CREATION_DATE` 等     |
| 软删除       | `IS_DELETE = 1/0`                       | 不强制（业务自定）                        |

---

## 变更记录

- 2026-07-18 v0.14：受管更新/软删统一显式原子 SQL；补充动态 WHERE、恒真 WHERE 与租户谓词硬门禁。
- 2026-07-18 v0.8 租户谓词、稳定排序、乐观锁和显式列闭环
- 2026-05-14 v0.0.1 落地（基于 `MdmFeatureCategoryMapper.xml/.java` + CLAUDE 共性 §八）
