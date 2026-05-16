---
name: unit-test-gen
description: |
  基于 ServiceImpl / Controller 生成 JUnit 5 + Mockito 单元测试，命名 should_{result}_when_{condition}。
  Service 测试覆盖正常流 + 业务校验失败 + 状态机异常分支；Controller 测试用 MockMvc。
  典型触发：「生成单测」「写测试」「Mock 测试」「单元测试」
status: 🟡 骨架
stage: ⑦ 测试
---

# unit-test-gen

## Pre-flight 声明（必填）

```
🚀 已触发技能 unit-test-gen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 G
✅ 已读取 standards/14-test-coverage.md  → 覆盖率红线 + 命名
✅ 已读取 standards/05-service.md        → 业务方法签名
```

## 前置检查

- [ ] 目标 ServiceImpl / Controller 已存在
- [ ] 测试目录结构 `src/test/java/...` 与主代码包对齐

## 产物

```
xxx-service/src/test/java/.../{Entity}ServiceImplTest.java
xxx-service/src/test/java/.../{Entity}ControllerTest.java
```

## Service 测试模板

```java
@ExtendWith(MockitoExtension.class)
class {Entity}ServiceImplTest {

    @InjectMocks
    private {Entity}ServiceImpl service;

    @Mock
    private {Entity}Mapper mapper;

    @Test
    void should_return_id_when_save_success() { ... }

    @Test
    void should_throw_when_business_unique_key_duplicated() { ... }

    @Test
    void should_throw_when_status_not_allowed() { ... }
}
```

## Controller 测试模板

```java
@WebMvcTest({Entity}Controller.class)
class {Entity}ControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockBean private {Entity}Service service;

    @Test
    @WithMockUser(authorities = "mdm_feature_category_save")
    void should_201_when_save_success() throws Exception {
        mockMvc.perform(post("/mdmFeatureCategory/save")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"categoryCode\":\"C1\",\"categoryName\":\"N1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(200));
    }
}
```

## 用例覆盖建议（按场景）

| 场景             | 必测                              |
| ---------------- | --------------------------------- |
| save             | 正常 / 业务唯一冲突 / 必填字段缺失 |
| updateById       | 正常 / 记录不存在 / 状态不允许    |
| deleteById       | 正常 / 记录不存在                 |
| 状态变更         | 每个状态转换的允许与拒绝          |
| 分页查询          | 空结果 / 关键字过滤                |

## 约束

- 用 `should_xxx_when_yyy` 命名
- 使用 AssertJ（`assertThatThrownBy(...)`），不用 JUnit 原生 `assertThrows` 字符串断言
- **不依赖** 真实 DB / 网络
- `@Disabled` 必须含原因 + 责任人 + 跟踪 ID

## 完成摘要

```
✅ unit-test-gen 完成
   - 产出: ServiceImplTest / ControllerTest
   - 用例数: N
   - 预估覆盖率: Service ≈ x%, Controller ≈ y%
   - 下一步建议: ⑧ convention-audit-be
```
