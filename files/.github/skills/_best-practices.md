# Backend Best Practices · 场景路由

> 先判断用户目标，再选择最小 Skill/CLI 组合。所有写操作都先计划、再确认、再验证。

## 新资源 CRUD

```text
业务事实/前端 api.md
  → project-context-governance：当前模块 Catalog + 一跳 Context Plan
  → api-design-be：形成 wl-contract.json
  → codegen validate
  → codegen plan
  → 人工确认 planHash
  → codegen apply
  → validate + mvn verify -Pwl-quality
  → contract diff
```

Catalog 启用时，当前模块目录过期或存在重复 API/权限/服务/表写身份必须停止。关联模块只读一跳快照，不得为了“全面”扫描全仓。契约不完整时同样停止生成，特别是外部路径、权限码、数据库类型、租户、revision 和 DDL 恢复策略。生成 DDL 不等于授权执行数据库变更。

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

`db-migration` 已确定性生成 CREATE、受限分阶段 ALTER、索引、人工恢复说明和 DDL_PREVIEW。复杂回填、跨库迁移和真实数据库执行仍需 DBA/开发者设计与审批。禁止自动连库、自动执行、自动反向 migration 或把恢复说明冒充可无损回滚。

## 单测补齐

生成模板是编译级起点。按 standards/14 补业务分支，并以 JaCoCo J8 实测为准；禁止报告“预估覆盖率”。数据库方言相关 SQL 应使用相应 Testcontainers 或受控测试环境验证。

## 陌生业务或仅咨询

- 陌生业务先用 `business-doc-extract-be` 只读整理证据，业务方确认后再设计契约；
- 仅咨询时读取相关 standards，不触发写入；
- 环境标准化使用 `config init/migrate/doctor/fix` 与 `troubleshoot`；写命令必须以当前文件哈希生成 planHash，并通过 confirm 后原子应用。

## 通用红线

- 不猜权限码、租户来源、数据库方言、外部网关路径或业务状态机；
- 不覆盖未受管/已修改文件，除非用户显式确认强制流程且已有备份；
- 不把 MCP 调用视为额外授权，写工具仍需 planHash 和确认；
- 不让备份目录进入源码扫描或提交；
- 不在报告、fixture、示例或日志中写真实凭据；
- 修复完成必须复扫，发布前必须执行包自检和 Java 8 真实质量验证。
