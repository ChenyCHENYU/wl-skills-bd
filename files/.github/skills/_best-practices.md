# Backend Best Practices · 场景路由

> 先判断用户目标，再选择最小 Skill/CLI 组合。所有写操作都先计划、再确认、再验证。

## 新资源 CRUD

```text
业务事实/前端 api.md
  → api-design-be：形成 wl-contract.json
  → codegen validate
  → codegen plan
  → 人工确认 planHash
  → codegen apply
  → validate + mvn verify -Pwl-quality
  → contract diff
```

契约不完整时停止生成，特别是外部路径、权限码、数据库类型、租户、revision 和 DDL 恢复策略。生成 DDL 不等于授权执行数据库变更。

## 前端接口变更

先用 `contract diff` 找到方法、路径、字段、响应包装、权限码差异，再更新唯一后端契约并重新 plan。不要直接手改多个生成产物形成第二事实源。

## 存量工程体检

```text
doctor
  → validate（JSON/Markdown/SARIF）
  → Maven wl-quality
  → 人工确认修复范围
  → B3/B5 可走 safe-fix，其他规则人工修改
  → validate + Maven 复验
```

审计阶段只读。`--quick` 只适合反馈迭代，不能替代最终全量扫描。

## DDL 或数据迁移

`db-migration` 当前是流程骨架。新资源 codegen 可以生成 CREATE migration 和人工恢复说明；ALTER、回填、expand-contract 仍需 DBA/开发者评审。禁止自动连库、自动执行、自动反向 migration 或把恢复说明冒充可无损回滚。

## 单测补齐

生成模板是编译级起点。按 standards/14 补业务分支，并以 JaCoCo J8 实测为准；禁止报告“预估覆盖率”。数据库方言相关 SQL 应使用相应 Testcontainers 或受控测试环境验证。

## 陌生业务或仅咨询

- 陌生业务先用 `business-doc-extract-be` 只读整理证据，业务方确认后再设计契约；
- 仅咨询时读取相关 standards，不触发写入；
- 环境标准化当前没有 CLI/MCP 执行器，只能形成脱敏、人工确认的检查清单和补丁建议。

## 通用红线

- 不猜权限码、租户来源、数据库方言、外部网关路径或业务状态机；
- 不覆盖未受管/已修改文件，除非用户显式确认强制流程且已有备份；
- 不把 MCP 调用视为额外授权，写工具仍需 planHash 和确认；
- 不让备份目录进入源码扫描或提交；
- 不在报告、fixture、示例或日志中写真实凭据；
- 修复完成必须复扫，发布前必须执行包自检和 Java 8 真实质量验证。
