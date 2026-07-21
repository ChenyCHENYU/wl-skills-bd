# 使用指南：unit-test-gen

## Service

围绕公开业务方法建立用例矩阵：成功、必填/唯一性失败、记录不存在、跨租户不可见、revision 冲突、事务异常。直接 Service 风格使用 `{Entity}ServiceTest`，不要生成不存在的 `ServiceImplTest`。

`test gen <contract>` 会为 customOperations 生成可执行测试：状态机正常路径、每个前置条件的拒绝路径、path+body 参数消费，以及 batch 整批成功/任一前置失败整批拒绝。测试直接 mock `selectActiveById/selectActiveByIds/updateAtomic` 边界并断言状态或结果；禁止 TODO、空测试、`service.undefined`、只 verify 调用次数或“部分成功”语义。

## Controller

使用 `@WebMvcTest` + MockMvc，至少覆盖：无权限、参数校验失败、正常 `code=2000`、路径变量、分页 `records/total` 和详情 revision。安全配置复杂时显式导入最小测试配置，不用关闭全部安全过滤器掩盖权限问题。

## 数据库

纯业务单元测试 mock Mapper；SQL/分页/索引/方言测试使用相应 MySQL/Oracle 环境。H2 通过不能证明目标数据库 SQL 正确。

## 验收命令

```bash
mvn verify -Pwl-quality
```

Service 类行/分支分别至少 70%/60%，Controller 类行至少 50%。报告位于 `target/site/jacoco/`。

生产级交付还需要权限负向、目标数据库 SQL、并发冲突/幂等、压测和恢复演练证据；纯 Service 单测不得冒充这些外部证据（standards/28）。
