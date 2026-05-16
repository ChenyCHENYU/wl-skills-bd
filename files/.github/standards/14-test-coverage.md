# 14 · 单元测试覆盖率红线（🟡 骨架）

## 红线（建议性，0.1.x 转为强制）

| 层           | 行覆盖率 | 分支覆盖率 |
| ------------ | -------- | ---------- |
| Service 实现 | ≥ 70%    | ≥ 60%      |
| Controller   | ≥ 50%    | —          |
| Mapper       | 可选     | —          |

## 框架

- JUnit 5 + Mockito + Spring Boot Test
- 集成测试：`@SpringBootTest` + `@AutoConfigureMockMvc`
- 数据库测试：Testcontainers + **MySQL**（主流项目）或 **Oracle XE**（mdm-service 等 Oracle 项目）；H2 可用于快速决策层单测，注意 Oracle / MySQL 方言差异

## 命名

- 测试类：`XxxServiceImplTest` / `XxxControllerTest`
- 测试方法：`should_{结果}_when_{条件}`，如 `should_throw_when_categoryCode_duplicated`

## Service 测试模板

```java
@ExtendWith(MockitoExtension.class)
class MdmFeatureCategoryServiceImplTest {

    @InjectMocks
    private MdmFeatureCategoryServiceImpl service;

    @Mock
    private MdmFeatureCategoryMapper mapper;

    @Test
    void should_throw_when_featureKey_duplicated() {
        MdmFeatureCategoryDTO dto = new MdmFeatureCategoryDTO();
        dto.setFeatureKey("DUP");
        when(mapper.getByFeatureKey("DUP")).thenReturn(new MdmFeatureCategory());

        assertThatThrownBy(() -> service.save(dto))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("feature_key 已存在");
    }
}
```

## 禁止事项

- 禁止 `@Disabled` 长期挂着不处理
- 禁止断言 `assertTrue(result != null)` 这种弱断言
- 禁止依赖外部网络 / 真实数据库的 "假单测"（应归类为集成测试）
- 禁止用 `Thread.sleep` 等待异步（用 `Awaitility`）

> TODO（0.1.x）：补 JaCoCo Maven 插件配置 + CI 红线脚本；按服务粒度产出覆盖率周报。
