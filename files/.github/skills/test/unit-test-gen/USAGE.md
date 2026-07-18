# 使用指南：unit-test-gen

## Service

围绕公开业务方法建立用例矩阵：成功、必填/唯一性失败、记录不存在、跨租户不可见、revision 冲突、事务异常。直接 Service 风格使用 `{Entity}ServiceTest`，不要生成不存在的 `ServiceImplTest`。

## Controller

使用 `@WebMvcTest` + MockMvc，至少覆盖：无权限、参数校验失败、正常 `code=2000`、路径变量、分页 `records/total` 和详情 revision。安全配置复杂时显式导入最小测试配置，不用关闭全部安全过滤器掩盖权限问题。

## 数据库

纯业务单元测试 mock Mapper；SQL/分页/索引/方言测试使用相应 MySQL/Oracle 环境。H2 通过不能证明目标数据库 SQL 正确。

## 验收命令

```bash
mvn verify -Pwl-quality
```

Service 类行/分支分别至少 70%/60%，Controller 类行至少 50%。报告位于 `target/site/jacoco/`。
