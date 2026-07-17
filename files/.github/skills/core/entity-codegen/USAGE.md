# 使用指南：生成实体数据模型（entity-codegen）

从 `docs/api/{module}.md` 契约 + DDL 生成 Entity / DTO / VO / PageDTO / PageVO 五件套。读 `templates/` 填空，生成后跑 validate 自检。

## 触发词

```
生成实体 / 生成 Entity / 生成 DTO / 生成 VO / 数据模型 / 建实体类 / 建模型
```

## 典型场景

### 场景 A：标准 CRUD 实体（最常见）

输入：一张业务表 DDL + api.md 字段清单
产出：5 文件（Entity/DTO/PageDTO/VO/PageVO）

```
用户：帮我生成 特征量分类 的实体，表 MDM_FEATURE_CATEGORY
AI：  → 读 DDL → 映射字段类型 → 读 templates/Entity.java.tmpl 填空
      → 生成 5 个文件 → 跑 validate
```

### 场景 B：树形结构实体

输入：含 `PARENT_ID` 的表
特殊处理：Entity 加 `parentId`；VO 加 `List<XxxVO> children`（树构建逻辑在 Service，不在 Entity）

### 场景 C：含金额字段

```
DDL: AMOUNT NUMBER(20,2)
→ Entity: private BigDecimal amount;     // 禁 double
→ DTO:   @NotNull @DecimalMin("0") private BigDecimal amount;
```

### 场景 D：仅补 VO（Entity/DTO 已存在）

回退到只生成 VO + PageVO，不覆盖已有文件（先展示 diff）。

## 占位符填空示例

DDL 片段：
```sql
CATEGORY_CODE VARCHAR2(64 CHAR) NOT NULL,
CATEGORY_NAME VARCHAR2(200 CHAR) NOT NULL,
SORT_ORDER    NUMBER(10)
```

填入 Entity.java.tmpl：
```java
@ApiModelProperty(value = "分类编码")
private String categoryCode;          // VARCHAR2(64) → String

@ApiModelProperty(value = "分类名称")
private String categoryName;          // VARCHAR2(200) → String

@ApiModelProperty(value = "排序号")
private Integer sortOrder;            // NUMBER(10) → Integer
```

填入 DTO.java.tmpl（CATEGORY_CODE NOT NULL → 必填）：
```java
@NotBlank(message = "分类编码不能为空")
@Size(max = 64, message = "分类编码长度不能大于64")
private String categoryCode;
```

## 与其他 Skill 的衔接

| 衔接 | 说明 |
|------|------|
| 前置 | `api-design-be` 产出 docs/api/{module}.md（字段+权限码） |
| 后置 | `service-codegen`（消费 Entity/DTO/VO 生成 Controller+Service） |
| 后置 | `mapper-xml-gen`（消费 Entity 生成 Mapper+XML） |
| 后置 | `db-migration`（新表时生成 DDL，本 Skill 消费 DDL 反向生成 Entity） |

## FAQ

**Q：Entity 要不要加 @TableName 注解？**
A：团队基线 Entity 继承 CoreEntity，CoreEntity 或 MyBatis-Plus 配置已处理驼峰→下划线映射。如类名与表名不符才显式加 `@TableName("XXX_TABLE")`。

**Q：VO 为什么 extends Entity 而不独立？**
A：复用数据库字段 + 追加展示字段（如关联名称），避免字段重复声明。但 VO **不接受请求**（standards/07）。

**Q：时间字段用 String 还是 LocalDateTime？**
A：团队基线（mdm-service）`CREATE_DATE_TIME` 等审计字段在 CoreEntity 用 String 存。业务时间字段按 api.md 约定，优先 String（与前端一致）。

**Q：PageDTO 和 DTO 有什么区别？**
A：DTO 用于新增/修改（必填字段加 @NotBlank 校验）；PageDTO 用于分页查询（字段全可选，不加校验）。

**Q：生成后怎么确认没问题？**
A：跑 `wl-skills-bd validate`。Entity 层主要查 B7（COMPANY_ID）和 B8（异常），更多靠 Checkstyle 查命名。
