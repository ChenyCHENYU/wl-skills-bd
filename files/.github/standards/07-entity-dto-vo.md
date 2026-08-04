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
- `XxxPageDTO`：含受校验的 `current/size` 和可选查询条件，不含可信租户字段；
  默认值和上限读取生效 Delivery Profile，无项目覆盖时基线为 `current=1,size=10,maxSize=200`。请求不传分页值时仍使用默认值，
  防止前端漏参造成空指针；超过上限由 Bean Validation 返回可理解的参数错误。
- `Xxx{Operation}RequestDTO`：每个自定义命令独立生成，按契约包含 `id` 或 `ids` 及业务请求字段；批量 `ids` 必须非空且最多 1000 条。

存量共享 `XxxDTO` 只属于 `legacy-shared-dto` 兼容模式，新资源不得默认使用。

- String 必填用 `@NotBlank`，非 String 必填用 `@NotNull`。
- 长度、范围、枚举值在 DTO 上声明 Bean Validation。
- 契约中的每个顶层业务字段必须显式声明 `writable: true|false`；只有 `true` 的字段可进入 Create/UpdateDTO，禁止依靠默认可写推断越权边界。
- 密码、token、证件号等敏感字段使用 `@ToString.Exclude`，禁止进入日志。
- 契约字段应声明稳定 `semanticId`、业务 `definition`、枚举范围、数据所有者和 `sourceOfTruth`；状态机字段还必须声明确定性初始值。
- `wl-api-contract` 中字符串长度、DECIMAL 总位数/小数位必须从数据库契约导出并携带
  `constraintSource`。前端只消费该机器字段，不得重新猜一套边界。
- 禁止让一个“宽 DTO”承载多个物理资源后再静默忽略未知字段。确需兼容存量共享 DTO 时，
  Service 必须按资源维护显式允许字段集合；请求出现资源外非空字段应返回字段名明确的
  参数错误，不能保存成功却丢数据。
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
| 开关/软删 | Integer 或枚举 | 软删值由 profile 声明，默认 1/0，项目覆盖必须贯穿完整生成链 |
| jh4j 审计时间 | String | `yyyy-MM-dd HH:mm:ss` |
| modern Profile 时间 | LocalDateTime | 必须统一 Jackson 格式与时区 |

## 5. 平台审计填充器与扩展点 Bean

1. jh4j-cloud 已提供 `MetaObjectHandler`（Bean 名 `metaHandlerConfig`）。业务模块不得再注册一个没有唯一选择声明的同类型 Bean，否则 MyBatis-Plus 创建 `sqlSessionFactory` 时会因候选 Bean 不唯一而启动失败（B28）。
2. 业务确需修正平台填充前的输入时，应使用装饰器：业务 Handler 标记 `@Primary`，通过 `@Qualifier("metaHandlerConfig")` 注入平台 Handler，只做最小归一化后委托平台 `insertFill/updateFill`。禁止重新实现并替换平台公司、用户、组织、应用编号和审计字段语义。
3. `EntityUtil`、Bean 拷贝或反序列化产生的日期空字符串必须在持久化边界归一为 `null`，再由平台 Handler 填充；禁止把 `""` 写入 `DATE/DATETIME/TIMESTAMP` 列，也不得通过关闭数据库严格模式掩盖类型错误。

## 6. 字段边界与上下文来源

1. 数据库存储长度、DECIMAL 精度和写入业务边界进入 Create/Update DTO；查询条件只有契约显式声明 `queryConstraints` 时才生成长度、数值或正则校验，禁止按字段名或表列宽猜查询规则。
2. 每组显式业务边界必须携带 `constraintSource/queryConstraintSource`；来源不足时保持待确认，不生成误导性的数字、长度或时间规则。
3. 跨字段起止时间必须通过 `validationRules.chronology` 声明并生成对象级校验，不能只校验单字段格式。
4. `contextSource=server` 的公司、用户、组织等可信上下文不得进入请求 DTO；`client` 上下文只允许出现在契约声明的操作中。
4. 新增任何框架 SPI/扩展点 Bean 时，除单元行为测试外，必须增加最小 Spring 容器测试：真实注册平台 Bean 与业务 Bean，并按接口类型 `getBean(...)`，证明上下文可启动且唯一候选正确。仅直接 `new` 业务实现的测试不能发现 Bean 冲突。

## 7. 机器门禁

- template-contract：模板引用字段必须由基类或 Entity 实际声明。
- codegen compile fixture：所有生成类型必须编译。
- contract-diff：VO 字段不得超出契约白名单。
- B9/B10/B11：数据类和业务类的规模/复杂度检查。

## 变更记录

- 2026-08-04 v0.18.0：分页口径改为生效 Profile 驱动；写入/查询约束、时间顺序和客户端/服务端上下文分离。
- 2026-08-03 v0.17.10：平台 `MetaObjectHandler` 装饰、空串日期归一和容器级唯一性测试闭环。
- 2026-08-01 v0.17.9：分页默认 1/10、机器字段边界来源和共享 DTO 非静默丢字段闭环。

- 2026-07-18 v0.14：字段可写性改为显式必填；分页参数纳入 PageDTO；自定义命令生成独立 RequestDTO。
- 2026-07-18 v0.8：按真实 CoreEntity 校准字段，禁止 VO 继承 Entity，明确 DTO 拆分。
