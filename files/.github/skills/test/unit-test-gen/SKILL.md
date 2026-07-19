---
name: unit-test-gen
description: |
  根据契约 customOperations 生成行为契约测试（正常路径/前置拒绝/状态转移/batch 计数），并通过 JaCoCo J8 覆盖率门禁。
  v0.16 起提供 test gen/scenarios CLI + wls_be_test MCP，从契约自动生成关键场景测试骨架。
  测"行为契约"不测"代码镜像"，避免冗余。
  典型触发：「生成单测」「补覆盖率」「Controller 测试」「Mock 测试」「测试生成」「单测」
status: ✅ 已落地
stage: ⑦ 测试
---

# unit-test-gen

> v0.16 起提供 `wl-skills-bd test gen/scenarios` CLI + `wls_be_test` MCP，从契约 customOperations 自动生成关键场景测试骨架。测"行为契约"不测"代码镜像"，避免冗余。

## Pre-flight 声明

```text
🚀 已触发技能 unit-test-gen/SKILL.md
✅ 已读取 standards/14-test-coverage.md
✅ 已读取目标 Service/Controller 与对应契约
✅ 已列出正常、边界、异常、租户与 revision 行为
```

## 流程

1. 读取公共方法、契约和业务校验，不测试私有实现；
2. Service 用 Mockito 隔离直接依赖，覆盖成功、业务异常、租户和乐观锁；
3. Controller 用 `@WebMvcTest`/MockMvc 覆盖权限、Bean Validation、路径和响应包装；
4. 方言相关 Mapper 使用对应数据库的集成测试；
5. 执行 `mvn verify -Pwl-quality`，以 JaCoCo 实测补齐分支；
6. 再执行 B1~B23 与完整质量门，确认测试代码本身也合规。

## 约束

- Java 8、JUnit 5、Mockito、AssertJ；
- 测试类 `{被测类}Test`，方法 `should_{result}_when_{condition}`；
- 不依赖真实外网、生产数据、共享状态或执行顺序；
- 不用 `skipTests`、扩大 excludes 或降低阈值规避 J8；
- 完成摘要只报告实际测试结果和 JaCoCo 数值，不写“预估覆盖率”。
