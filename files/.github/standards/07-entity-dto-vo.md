# 07 · Entity / DTO / VO / Query 规范（✅ 已落地）

---

## 总览：一表四类

| 类型   | 位置                          | 用途                       | 关键注解                                    |
| ------ | ----------------------------- | -------------------------- | ------------------------------------------- |
| Entity | `xxx-entity/api/entity/`      | 数据库映射                  | `@TableName` `@TableField` `@TableId` (MP) |
| DTO    | `xxx-entity/api/dto/`         | API 入参 / 跨层传输         | `@Data` `@NotBlank` `@NotNull` `@ApiModelProperty` |
| VO     | `xxx-entity/api/vo/`          | API 出参 / 列表视图         | `@Data` `@ApiModelProperty`                |
| Query  | `xxx-api/api/query/`          | 复杂查询条件 / 导出参数      | `@Data`                                     |

---

## 1. Entity（数据库实体）

```java
@Data
@TableName("MDM_FEATURE_CATEGORY")
@ApiModel("特征量分类实体")
public class MdmFeatureCategory implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 字段名常量，供 LambdaQuery / 排序使用 */
    public static final String FIELD_ID = "id";
    public static final String FIELD_CATEGORY_CODE = "categoryCode";

    @TableId(value = "ID", type = IdType.INPUT)        // 业务侧 IdWorker 生成
    @ApiModelProperty("主键")
    private String id;

    @TableField("CATEGORY_CODE")
    @ApiModelProperty("分类编码")
    private String categoryCode;

    @TableField("CATEGORY_NAME")
    @ApiModelProperty("分类名称")
    private String categoryName;

    @TableField("PARENT_ID")
    private String parentId;

    @TableField("IS_DELETE")
    @ApiModelProperty("是否有效：1=有效, 0=删除")
    private Integer isDelete;

    /* 团队约定的审计字段（标准 5 件套） */
    @TableField(value = "CREATE_USER_NO", fill = FieldFill.INSERT)
    private String createUserNo;

    @TableField(value = "CREATE_DATE_TIME", fill = FieldFill.INSERT)
    private LocalDateTime createDateTime;

    @TableField(value = "UPDATE_USER_NO", fill = FieldFill.INSERT_UPDATE)
    private String updateUserNo;

    @TableField(value = "UPDATE_DATE_TIME", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateDateTime;

    @TableField("REVISION")
    @Version                                            // MyBatis-Plus 乐观锁
    private Integer revision;
}
```

**Entity 要点**：

- **可以**使用 `@Data`（无父类冲突，与 HZERO 不同）
- 主键 String 类型存雪花 ID
- 必备审计 5 件套：`createUserNo / createDateTime / updateUserNo / updateDateTime / revision`
- 软删除字段 `isDelete: Integer (1/0)`
- 非数据库字段加 `@TableField(exist = false)`

---

## 2. DTO（请求 / 跨层传输）

```java
@Data
@ApiModel("特征量分类分页查询参数")
public class MdmFeatureCategoryPageDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    @ApiModelProperty("分类编码（模糊）")
    private String categoryCode;

    @ApiModelProperty("分类名称（模糊）")
    private String categoryName;

    @ApiModelProperty("父级 ID")
    private String parentId;
}

@Data
@ApiModel("特征量分类保存 DTO")
public class MdmFeatureCategoryDTO implements Serializable {

    @ApiModelProperty("主键（更新时必填）")
    private String id;

    @NotBlank(message = "分类编码不能为空")
    @ApiModelProperty(value = "分类编码", required = true)
    private String categoryCode;

    @NotBlank(message = "分类名称不能为空")
    @ApiModelProperty(value = "分类名称", required = true)
    private String categoryName;

    @ApiModelProperty("父级 ID")
    private String parentId;
}
```

**DTO 要点**：

- `@Data` + `implements Serializable`
- 字段加 `@ApiModelProperty`；必填字段加 `@NotBlank` / `@NotNull` 校验
- 命名：`XxxDTO`（通用）/ `XxxPageDTO`（分页查询）/ `XxxCreateDTO` / `XxxUpdateDTO`（按场景细分）
- **不复用 Entity 作为 DTO**，避免字段污染

---

## 3. VO（出参视图）

```java
@Data
@ApiModel("特征量分类分页 VO")
public class MdmFeatureCategoryPageVO implements Serializable {

    @ApiModelProperty("主键")
    private String id;

    @ApiModelProperty("分类编码")
    private String categoryCode;

    @ApiModelProperty("分类名称")
    private String categoryName;

    // 仅出参字段
    @ApiModelProperty("子节点数量")
    private Integer childCount;
}
```

**VO 要点**：

- 入参不使用 VO；出参不使用 DTO（角色分离）
- 列表 / 树 / 分页可以各自定义 VO：`XxxPageVO` / `XxxTreeVO` / `XxxDetailVO`

---

## 4. Query（复杂查询）

```java
@Data
public class DemoQuery {
    @ApiModelProperty("关键字（多字段模糊）")
    private String keyword;

    @ApiModelProperty("创建时间起")
    private LocalDate createDateStart;

    @ApiModelProperty("创建时间止")
    private LocalDate createDateEnd;

    @ApiModelProperty("ID 列表")
    private List<String> ids;
}
```

---

## 5. Excel EO

```java
@Data
public class MdmFeatureCategoryEO {
    @ExcelProperty(value = "分类编码", index = 0)
    private String categoryCode;

    @ExcelProperty(value = "分类名称", index = 1)
    private String categoryName;
}
```

---

## 禁止事项

- 禁止 Entity / DTO / VO 互相 `extends`（用 `BeanUtil` 拷贝）
- 禁止 Entity 加 Spring 注解
- 禁止 DTO / VO 包含数据库字段（`createDateTime` 等仅 VO 按需暴露）
- 禁止省略 `@ApiModelProperty`（影响 Swagger 文档质量）

---

## 变更记录

- 2026-05-17 v0.0.2 补充 R16 / R17 / R29（基于《后端代码规范》PDF）
- 2026-05-14 v0.0.1 落地

---

## R16 · POJO 必须重写 toString()

Entity / DTO / VO / Query 必须有 `toString()` 方法，便于日志打印对象内容。

```java
// ✅ Lombok @Data 自动生成，无需手写
// ✅ 无法使用 @Data 时手写（IDE 生成即可）
@Override
public String toString() {
    return "MdmFeatureCategory{id='" + id + "', code='" + categoryCode + "'}";
}
```

> 使用 `@Data` 时自动满足此规则。

---

## R17 · POJO 字段必须使用包装类型（Integer/Long/Boolean 等），禁止基本类型

```java
// ❌ int/long/boolean 默认值为 0/false，无法区分"未传"与"传了 0/false"
@Data
public class OrderDTO {
    private int amount;
    private boolean deleted;
}

// ✅ 包装类型默认 null，语义清晰
@Data
public class OrderDTO {
    private Integer amount;
    private Boolean deleted;
}
```

> Entity 同样适用（`isDelete: Integer`，非 `int`）。

---

## R29 · 布尔字段名禁止以 is 开头

```java
// ❌ MyBatis-Plus / Jackson 序列化时去掉 is 前缀导致字段名不匹配
private Boolean isDeleted;   // getter: isIsDeleted / isDeleted → 序列化为 "deleted"
private Boolean isSuccess;

// ✅ 直接用语义名
private Boolean deleted;
private Boolean success;
private Boolean enabled;
```

> 数据库字段可以用 `IS_DELETE`，映射到 Java 时去掉 `is`：`private Integer deleted`。
