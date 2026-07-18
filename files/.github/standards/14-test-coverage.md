# 14 · 测试与覆盖率规范（✅ 已落地）

> 强制度：🔴 必遵。JaCoCo J8 在 `mvn verify -Pwl-quality` 阶段按类执行覆盖率门禁。

## 覆盖率红线

| 范围 | 行覆盖率 | 分支覆盖率 |
|---|---:|---:|
| `..service..` 业务类 | ≥ 70% | ≥ 60% |
| `..controller..` 接口类 | ≥ 50% | 暂不阻断 |
| Mapper/Entity/DTO/VO/配置与生成代码 | 不设统一比例 | 不设统一比例 |

门禁使用 `CLASS` 粒度而不是包平均值，避免高覆盖率类掩盖零测试业务类。若某类确实只有委托代码，优先写最小行为测试；排除项必须在父 POM 评审并说明原因，禁止用大范围通配符绕过门禁。

## 测试分层

| 类型 | 建议工具 | 关注点 |
|---|---|---|
| Service 单元测试 | JUnit 5 + Mockito + AssertJ | 正常流、业务校验、租户、乐观锁、事务失败 |
| Controller 切片测试 | `@WebMvcTest` + MockMvc | 权限、校验、HTTP 路径、`ApiResult` 包装 |
| 集成测试 | `@SpringBootTest` | Spring 装配、事务与跨组件协作 |
| 数据库方言测试 | Testcontainers MySQL/Oracle | SQL、索引、分页和方言差异 |

H2 只适合不依赖数据库方言的快速测试，不得用 H2 通过来证明 Oracle/MySQL SQL 正确。测试禁止依赖外部网络、共享测试库或执行顺序。

## 用例最低集合

- 创建：成功、必填校验、唯一键冲突、请求不能注入 `companyId`；
- 更新：成功、记录不存在、revision 冲突、跨租户不可见；
- 删除：成功、记录不存在、软删值和租户谓词正确；
- 分页/详情：空结果、过滤条件、`records/total`、详情返回 revision；
- 权限：受保护接口无权限失败，登记的公开接口按设计放行。

## 命名与断言

- 测试类：`{被测类}Test`；当前直接 Service 风格使用 `{Entity}ServiceTest`，不生成不存在的 `ServiceImplTest`；
- 测试方法：`should_{result}_when_{condition}`；
- 断言业务结果和重要副作用，不只断言“非空”；
- 异常测试同时断言类型与稳定业务码/消息片段；
- Mockito 只 mock 直接依赖，不 mock 被测类内部实现；
- 每个测试独立创建数据，禁止依赖前一个测试留下的状态。

## 生成模板的边界

`ServiceTest.java.tmpl` 与 `ControllerTest.java.tmpl` 提供可编译的 smoke 骨架，但不能从字段契约推断完整业务分支。生成后必须按上面的最低集合补充业务用例，直到 JaCoCo 实测通过；禁止在完成摘要中写“预估覆盖率”冒充真实报告。

## 执行

```bash
mvn verify -Pwl-quality
```

报告位于各 Maven 模块的 `target/site/jacoco/`。门禁失败时先定位零覆盖类和未覆盖分支，再补行为测试；不得通过降低比例、扩大 excludes、`skipTests` 或 `-Djacoco.skip=true` 规避。

## 禁止事项

- 长期保留无责任人/跟踪项的 `@Disabled`；
- `Thread.sleep` 等待异步结果；应使用可控时钟、回调或 Awaitility；
- 测试中打印结果但不断言；
- 为覆盖率调用私有方法或复制生产逻辑；应通过公共行为覆盖；
- 将真实凭据、生产地址或个人数据写入 fixture；
- 把生成测试当作覆盖率验收完成。

## 变更记录

- 2026-07-18 v0.8.0：落地 JaCoCo 0.8.15 J8，新增 Java 8 真实 Maven 验证与类级阈值。
- 2026-05-14 v0.0.1：建立建议性骨架。
