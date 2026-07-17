# 使用指南：单元测试生成（unit-test-gen）

> ⚠️ 当前 SKILL.md 仍为骨架，触发时按 **standards/14（测试覆盖红线，待补厚）** 落地。

## 触发词

```
单元测试 / 集成测试 / 接口测试 / Mock 测试 / Controller 测试
```

## 典型场景

### 场景 A：Service 单测（最常见）

```
用户：给 MdmFeatureCategoryService 生成单测
AI：  → 读 Service 方法签名
      → 用 JUnit 5 + Mockito（mock baseMapper / 依赖 Service）
      → 覆盖正常路径 + 边界（空/异常/状态非法）
      → 产出 MdmFeatureCategoryServiceTest.java
```

### 场景 B：Controller 集成测试（MockMvc）

```
用户：给 MdmFeatureCategoryController 生成集成测试
AI：  → @SpringBootTest + MockMvc
      → 覆盖每个 @Operation（含权限/校验/正常返回）
      → 产出 MdmFeatureCategoryControllerTest.java
```

## 技术栈（团队基线）

- JUnit 5（不用 JUnit 4）
- Mockito（mock 依赖）
- MockMvc（Controller 集成测试）
- AssertJ（流式断言，替代 hamcrest）
- 测试数据：H2（快速）或 Testcontainers MySQL/Oracle（方言准确）

## 测试规范（待 14 补厚）

- 测试类命名：`{被测类}Test`
- 测试方法命名：`should_{预期}_when_{条件}`（如 `should_throwException_when_idNotExist`）
- 一个测试方法只断言一个行为（单一职责）
- 测试方法不依赖执行顺序（独立）
- 覆盖：正常路径 + 边界值 + 异常路径

## 预期产物

```
src/test/java/.../{Entity}ServiceTest.java
src/test/java/.../{Entity}ControllerTest.java
```

## FAQ

**Q：测试覆盖率红线是多少？**
A：standards/14 待补厚（建议行覆盖≥60%、分支覆盖≥40%）。当前按"关键方法必测"执行。

**Q：骨架阶段生成质量如何？**
A：当前 SKILL 薄，AI 按 JUnit5+Mockito 官方约定生成。如发现偏差反馈到 kit-internal。
