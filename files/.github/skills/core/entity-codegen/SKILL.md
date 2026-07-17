---
name: entity-codegen
description: |
  按 docs/api/{module}.md 契约 + 数据库 DDL 生成 Entity / DTO / VO / PageDTO / PageVO（5 文件）。
  Entity 继承 CoreEntity 含审计字段；DTO 含 @Validated 校验；VO 含 @ApiModelProperty。
  读 templates 填空，生成后跑 validate 自检。对标 wl-skills-kit/entity-codegen 落地深度。
  典型触发：「生成实体」「Entity」「DTO」「VO」「数据模型」「建实体类」
status: ✅ 已落地
stage: ③ 数据模型
---

# entity-codegen

## Pre-flight 声明（必填）

```
🚀 已触发技能 entity-codegen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 B
✅ 已读取 standards/02-project-structure.md → 包名映射 + 领域分包
✅ 已读取 standards/03-naming.md         → 类/字段命名
✅ 已读取 standards/07-entity-dto-vo.md  → Entity/DTO/VO 边界
✅ 已读取 standards/12-database-ddl.md   → §0.5 物理库归属 + 字段类型映射
✅ 已读取 templates/Entity.java.tmpl 等  → 标准骨架
✅ 工程根包确认：com.jhict.{prod}（见 standards/02 包名映射表）
✅ 数据库类型确认：{MySQL|Oracle}（见 standards/12 §0）
```

## 前置检查

- [ ] 是否存在 `docs/api/{module}.md`？若无，回退到 `api-design-be`
- [ ] 是否存在 DDL 脚本或表结构 dump？字段类型必须有依据
- [ ] 工程根包已确认（读父 pom.xml groupId）

---

## 执行步骤（5 步，逐步落地）

### 步骤 1：确认工程上下文

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{rootPackage}}` | 父 pom.xml groupId | `com.jhict.mdm` |
| `{{module}}` | 业务子域（驼峰）| `feature` / `sourceData` |
| `{{Entity}}` | PascalCase 实体名 | `MdmFeatureCategory` |
| `{{table}}` | DDL 表名（UPPER_SNAKE）| `MDM_FEATURE_CATEGORY` |
| `{{apiDesc}}` | api.md 中文名 | `特征量分类` |

> 根包必须按 standards/02 业务中心包名映射表填，禁止套用 mdm 到其他工程。

### 步骤 2：字段类型映射（standards/12）

读 DDL，逐字段按下表映射到 Java 类型：

| 数据库类型 | Java 类型 | 备注 |
|-----------|-----------|------|
| `VARCHAR2(N CHAR)` / `VARCHAR(N)` | `String` | 编码/名称/描述 |
| `NUMBER(1)` / `TINYINT` | `Integer` | 标志位 1/0 |
| `NUMBER(10)` / `INT` | `Integer` | 普通整数 |
| `NUMBER(20)` / `BIGINT` | `Long` | 大整数 |
| `NUMBER(20,2)` / `DECIMAL(20,2)` | `BigDecimal` | 金额（禁 double）|
| `DATE` | `LocalDate` | 日期 |
| `TIMESTAMP(6)` / `DATETIME` | `String`（团队基线用 String 存时间）| 团队基线见 mdm-service |
| `CLOB` / `TEXT` | `String` | 富文本/JSON |

> **审计字段不映射**：CoreEntity 已含（id/companyId/isDelete/revision/createUserNo/createDateTime/updateUserNo/updateDateTime），Entity 只写业务字段。

### 步骤 3：读模板填空

读 `templates/Entity.java.tmpl`，替换占位符：

```
{{rootPackage}}  → com.jhict.mdm
{{module}}       → feature
{{Entity}}       → MdmFeatureCategory
{{table}}        → MDM_FEATURE_CATEGORY
{{apiDesc}}      → 特征量分类
{{#fields}} 循环展开业务字段：
  {{field}}       → categoryCode
  {{fieldType}}   → String
  {{fieldComment}}→ 分类编码
```

### 步骤 4：DTO 校验注解生成规则

读 `templates/DTO.java.tmpl`，对每个字段判断校验：

| 字段特征 | 注解 | 示例 |
|---------|------|------|
| String + 必填 | `@NotBlank(message="xxx不能为空")` | 编码 |
| 非String + 必填 | `@NotNull(message="xxx不能为空")` | 状态值 |
| 有长度约束 | `@Size(max=N, message="xxx长度不能大于N")` | 名称 max=200 |
| 可选字段 | 无校验注解 | 备注 |

> PageDTO 字段**全部可选**（查询条件），不加 @NotBlank。

### 步骤 5：VO 展示字段

读 `templates/VO.java.tmpl`，VO `extends Entity`，补展示字段：

- 外键关联的名称（如 Entity 有 `designId`，VO 补 `designName`）
- 枚举中文（如 Entity 有 `status`，VO 补 `statusName`）
- 子列表（如分类 VO 含 `List<FieldVO> fields`）

---

## 产物（5 文件）

```
xxx-entity/.../entity/{module}/{Entity}.java          ← 数据库实体
xxx-entity/.../dto/{module}/{Entity}DTO.java           ← 新增/修改入参（带校验）
xxx-entity/.../dto/{module}/{Entity}PageDTO.java       ← 分页查询条件（全可选）
xxx-entity/.../vo/{module}/{Entity}VO.java             ← 详情出参（含展示字段）
xxx-entity/.../vo/{module}/{Entity}PageVO.java         ← 列表出参（精简字段）
```

---

## 边界用例（高频场景）

| 场景 | 处理 |
|------|------|
| 树形结构（parent_id）| Entity 加 `parentId`；VO 加 `List<XxxVO> children`（树构建走 Service）|
| 金额字段 | 用 `BigDecimal`（禁 double），DTO 加 `@DecimalMin("0")` |
| 富文本/JSON | Entity 用 `String`，DB 用 `CLOB`/`TEXT` |
| 枚举字段 | Entity 用 `String`/`Integer` 存值；单独建 `XxxEnum` 枚举类（api/enums/）|
| 多值查询 | PageDTO 用 `List<String>`，XML 用 `<foreach>` |
| 时间范围查询 | PageDTO 加 `xxxStart` + `xxxEnd` 两个字段 |

---

## 约束（强制）

- Entity 继承 `CoreEntity`（审计字段在父类，不重复声明）
- Entity 用 `@Getter @Setter @Accessors(chain=true)`（团队基线，非 @Data）
- VO `extends Entity` 复用字段 + 补展示字段（standards/07）
- DTO/VO 加 `@ApiModel`，字段加 `@ApiModelProperty`
- DTO 必填字段加 `@NotBlank`/`@NotNull` + 长度 `@Size`

---

## 正反例对照

```
✅ @Accessors(chain = true)              团队基线链式 setter
   @ApiModel(value = "featureCategory")
   public class MdmFeatureCategory extends CoreEntity {
       @ApiModelProperty(value = "分类编码")
       private String categoryCode;

❌ @Data                                  非团队基线（用 @Getter+@Setter+@Accessors）
   public class FeatureCategory {         缺 extends CoreEntity + @ApiModel
       private String code;               字段名缺 @ApiModelProperty
```

---

## 完成摘要

```
✅ entity-codegen 完成
   - 产出: 5 个文件（基于 templates 填空）
   - 字段数: Entity={n}, DTO={n}, VO={n}
   - 必填校验: {n} 个
   - ★ 生成后自检: 已跑 wl-skills-bd validate（查 B7/B8 不涉及本层）
   - 下一步建议: ④ service-codegen
```

## 变更记录
- 2026-07-17 v0.4 补厚落地（执行步骤 + 字段映射 + 边界用例 + 正反例）+ USAGE.md
- 2026-07-17 v0.2 加 templates 引用
- 2026-05-14 v0.0.1 骨架
