# wl-skills-bd 架构概要（业务工程视角）

## 分层模型（L0 → L4）

```
L0  api.md（前端契约）        ──┐
                                 │
L1  api-design-be             ◄──┤   后端契约确立（驼峰路径 + 权限码 + ApiResult）
                                 │
L2  entity-codegen            ◄──┤   数据模型（Entity / DTO / VO / Query）
    service-codegen                  Controller + Service 三层
    mapper-xml-gen                   Mapper 接口 + XML
                                 │
L3  db-migration              ◄──┤   表结构（CREATE/ALTER + ROLLBACK + 人工确认）
                                 │
L4  unit-test-gen             ◄──┤   测试（JUnit 5 + Mockito + MockMvc）
    convention-audit-be              规范审计
    code-fix-be                      违规修复
```

## 与 wl-skills-kit / wl-skills-ui 的同构

| 维度       | wl-skills-kit（前端）           | wl-skills-bd（后端）            |
| ---------- | ------------------------------- | ------------------------------- |
| L0         | 设计 Token / 组件语义           | 接口契约（共同消费 api.md）     |
| L1         | api-contract / business-doc     | api-design-be / business-doc-be |
| L2         | Vue 视图 / 组件 / store         | Entity / Service / Mapper       |
| L3         | sync 菜单 / 字典 / 权限         | db-migration                    |
| L4         | scan / audit / fix              | audit / unit-test / fix         |

## 设计原则

- **懒加载**：standards/SKILL 按需读取，避免 token 浪费
- **Pre-flight 强制**：每个 Skill 触发先声明已加载哪些规则
- **人工卡口**：DDL / 数据迁移 / 跨服务影响必须人工确认
- **官方/社区最佳实践优先**：抽象通用规则，代码风格遵循 Spring/MyBatis-Plus 官方 + 团队 standards 规范（**不**对齐某个存量项目）
- **多 AI 编辑器适配**：内容统一来源，多入口由 CLI 派生（0.2.x）

## 模块边界

| 关注点         | 由谁负责              |
| -------------- | --------------------- |
| 前端规范 / sync | `wl-skills-kit`       |
| 前端视觉 / 组件 | `wl-skills-ui`        |
| 后端规范 / codegen | `wl-skills-bd`（本包） |
| 业务模块代码    | 业务工程（如 mdm-service） |
