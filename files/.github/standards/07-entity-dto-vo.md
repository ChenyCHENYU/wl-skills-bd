# 07 · Entity / DTO / VO 规范（✅ 已落地）

> 类型边界以接口契约和实际 jh4j-cloud 3.1.0 基类为准，禁止靠继承隐式暴露字段。

## 1. Entity

- Entity 继承 `CoreEntity`，复用实际存在的六个字段：`id/companyId/createUserNo/updateUserNo/createDateTime/updateDateTime`。
- 当前基类的时间字段是 String，新模板必须保持兼容；新平台 Profile 可选择 `LocalDateTime`，但不可在同一模块混用。
- `CoreEntity` 不含 `isDelete/revision`，业务 Entity 必须显式声明：

```java
@TableLogic(value = "1", delval = "0")
private Integer isDelete;

@Version
private Integer revision;
```

- Entity 只用于持久化，禁止作为 Controller 入参/出参。
- 数据库列与 Java 字段不一致时显式使用 `@TableField`；表名显式 `@TableName`。

## 2. DTO

确定性 codegen 默认生成：

- `XxxCreateDTO`：不含 id、companyId、isDelete、revision、审计字段。
- `XxxUpdateDTO`：必须含 String id 和 Integer revision，只包含可修改字段。
- `XxxPageDTO`：含受校验的 `current/size` 和可选查询条件，不含可信租户字段；`size` 上限 200。
- `Xxx{Operation}RequestDTO`：每个自定义命令独立生成，按契约包含 `id` 或 `ids` 及业务请求字段；批量 `ids` 必须非空且最多 1000 条。

存量共享 `XxxDTO` 只属于 `legacy-shared-dto` 兼容模式，新资源不得默认使用。

- String 必填用 `@NotBlank`，非 String 必填用 `@NotNull`。
- 长度、范围、枚举值在 DTO 上声明 Bean Validation。
- 契约中的每个顶层业务字段必须显式声明 `writable: true|false`；只有 `true` 的字段可进入 Create/UpdateDTO，禁止依靠默认可写推断越权边界。
- 密码、token、证件号等敏感字段使用 `@ToString.Exclude`，禁止进入日志。
- 契约字段应声明稳定 `semanticId`、业务 `definition`、枚举范围、数据所有者和 `sourceOfTruth`；状态机字段还必须声明确定性初始值。
- `confidential/restricted` 字段必须声明脱敏策略，`logPolicy` 只能排除，禁止通过 Lombok `@ToString`、异常消息或审计扩展字段泄露原值（B25）。
- 数据分级、脱敏、留存和唯一事实源属于业务口径，生产契约必须在 standards/28 的 data review 证据中由数据所有者确认。

## 3. VO

- `XxxVO` 和 `XxxPageVO` 独立声明契约白名单字段。
- 禁止 Entity/DTO/VO 相互 extends。
- 默认不返回 companyId、isDelete 和内部审计账号；详情 VO 必须返回 revision，供 UpdateDTO 完成乐观锁闭环。PageVO 仅在列表直接编辑且契约明确时返回 revision。
- PageVO 只含列表展示字段，DetailVO 可含关联名称和子列表。

## 4. 类型映射

| 数据含义 | Java 类型 | API 规则 |
|---|---|---|
| 雪花 ID | String | JSON 返回字符串 |
| 金额 | BigDecimal | 禁止 double |
| 开关/软删 | Integer 或枚举 | 与现网 1/0 基线一致 |
| jh4j 审计时间 | String | `yyyy-MM-dd HH:mm:ss` |
| modern Profile 时间 | LocalDateTime | 必须统一 Jackson 格式与时区 |

## 5. 机器门禁

- template-contract：模板引用字段必须由基类或 Entity 实际声明。
- codegen compile fixture：所有生成类型必须编译。
- contract-diff：VO 字段不得超出契约白名单。
- B9/B10/B11：数据类和业务类的规模/复杂度检查。

## 变更记录

- 2026-07-18 v0.14：字段可写性改为显式必填；分页参数纳入 PageDTO；自定义命令生成独立 RequestDTO。
- 2026-07-18 v0.8：按真实 CoreEntity 校准字段，禁止 VO 继承 Entity，明确 DTO 拆分。
