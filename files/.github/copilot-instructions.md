# Copilot Instructions — wl-skills-bd 后端主入口

本文件是后端业务工程的统一 AI 入口。具体场景先查 `.github/skills/_registry.md`，再按 `.github/standards/index.md` 懒加载相关规范；不要一次读完全部 28 条。

## 技术基线

- Java 8、Spring Boot 2、jh4j-cloud 3.1、MyBatis-Plus；
- OpenAPI 3：`@Tag/@Operation/@Schema`；
- 返回：`ApiResult.success(message, data)`，业务成功码 2000；
- 分页：`JhPage<T>`，响应 `data.records/data.total`；
- Controller → 直接 Service → Mapper，禁止 Controller 直调 Mapper；
- 租户从 `AuthUtil` 获取，SQL 显式 `COMPANY_ID`；软删列和值读取当前 profile（默认 1=有效、0=删除，项目覆盖时禁止沿用默认值）；
- UpdateDTO 必须 id/revision，详情 VO 必须返回 revision；受管更新/软删使用包含租户、有效标记和 revision 的显式原子 SQL。

数据库类型不能猜。Oracle/MySQL、物理库归属与目标 Profile 必须从工程配置和用户上下文确认。

## 生成主流程

```text
已评审需求 / 可选 design-model 或前端契约 / 数据模型
  → wl-contract.json（唯一 codegen 输入）
  → codegen plan（17+N 产物，零写入）
  → planHash + 人工确认 → apply
  → contract diff（前端/OpenAPI/权限）
  → contract diff --strict（wl-api-contract/OpenAPI/权限/completion）
  → validate B1~B23
  → Maven verify -Pwl-quality（J1~J5/J8）
  → DDL/权限/发布人工卡口
```

生成前必须读 `.github/guides/codegen-workflow.md`；启用 Catalog 的项目先以当前模块执行 `catalog check/context plan`，不得全仓扫描。前后端协作读 `frontend-backend-contract.md`；MCP 写入规则读 `mcp-workflow.md`。

## Pre-flight

触发 Skill 时先声明：

```text
🚀 已触发 {skill}
✅ 已读取 standards/index.md → 任务类型
✅ 已读取本次必需规范 → 文件列表
✅ 已确认工程 Profile/JDK/Maven/数据库
⚠️ 本次写入、DDL、权限或破坏性 API 风险与确认点
```

## 高风险边界

- DDL 只生成正向 Flyway、只读验证 SQL 和人工恢复说明；不得由 AI/MCP 执行数据库写入；
- ALTER 必须分 expand/contract；contract drop 需 approvalRef，Flyway 版本和既有迁移内容不可变；
- 数据回填、批量 UPDATE/DELETE、权限发布、角色授权必须走对应审批；
- Controller 路径/字段/权限变更必须更新后端契约并执行 contract diff；
- `companyId` 不得来自请求；租户拦截器豁免必须有可验证证据；
- 不允许把 `${}` 机械替换为 `#{}`，也不允许猜权限码、租户谓词、业务异常或 Javadoc。

## 检查与修复

```bash
wl-skills-bd doctor
wl-skills-bd validate . --strict
wl-skills-bd validate . --format sarif --output reports/backend.sarif
```

`code-fix-be`/`fix` 只自动处理满足严格前置条件的 B3/B5。先 plan，评审 diff，再用同一 planHash + confirm apply；写后复扫不可跳过。其他规则转人工或结构重构。

## MCP（15 个工具）

| 工具 | 作用 |
|---|---|
| `wls_be_validate` | B1~B23 只读扫描 |
| `wls_be_doctor` | 环境与门禁诊断 |
| `wls_be_codegen` | validate/plan/受控 apply |
| `wls_be_contract` | show/diff 前端、OpenAPI、权限 |
| `wls_be_safe_fix` | B3/B5 受控修复与复扫 |
| `wls_be_standards` | 查询 27 条规范 |
| `wls_be_templates` | 查询 16 个模板 |
| `wls_be_db_preview` | 只读 DDL/Expand-Contract 预览 |
| `wls_be_export_permissions` | 受控导出 kit 权限清单片段 |
| `wls_be_config` | 配置 doctor/init/migrate/fix；写入需确认 |
| `wls_be_troubleshoot` | 常见后端故障只读诊断 |
| `wls_be_task` | 只读任务路由；不得绕过 codegen/safe-fix/config 写链 |
| `wls_be_catalog` | 模块目录 plan/apply/check/show；默认只扫描当前模块 |
| `wls_be_context` | 当前模块 + 一跳快照的有界上下文；不扫关联源码 |
| `wls_be_commit` | 提交消息/range 校验与 Hook doctor |

写工具默认只预览，并统一执行 planHash、写前重算、原子写、失败回滚和写后复验。Agent 不得自行把 `confirmApply` 设为 true 来绕过用户评审；pre/prod/production 还必须取得显式工程文件写授权。

## 方法论

规范以官方/社区最佳实践、团队 standards、机器 Profile 和本次契约为准；存量代码只作为待审计事实，不自动晋升为标准答案。Skill 文档不能承诺执行器未实现的能力。
