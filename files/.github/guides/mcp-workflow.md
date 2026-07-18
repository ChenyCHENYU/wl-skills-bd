# MCP 工具与写入安全

`wl-skills-bd` MCP Server 通过 stdio 暴露 12 个本地工程工具，不连接数据库、网关或生产系统。

## 工具清单

| 工具 | 类型 | 作用 |
|---|---|---|
| `wls_be_validate` | 只读 | B1~B23 扫描，支持相对路径和 quick |
| `wls_be_doctor` | 只读 | JDK/Maven/Profile/质量门/租户证据诊断 |
| `wls_be_codegen` | 受控写 | contract validate/plan/apply，16 个受管产物 |
| `wls_be_contract` | 只读 | 协作契约 show；前端/OpenAPI/权限 diff |
| `wls_be_safe_fix` | 受控写 | 仅 B3/B5 白名单修复与强制复扫 |
| `wls_be_standards` | 只读 | 查询 26 条规范 |
| `wls_be_templates` | 只读 | 查询 14 个模板白名单 |
| `wls_be_db_preview` | 只读 | CREATE/ALTER DDL 与 Expand-Contract 预览 |
| `wls_be_export_permissions` | 受控写 | 导出 kit 权限清单片段 |
| `wls_be_config` | 只读/受控写 | doctor/init/migrate/fix；写操作必须预览、确认并保留迁移证据 |
| `wls_be_troubleshoot` | 只读 | DB/Redis/Nacos/K8s 等常见故障诊断树 |
| `wls_be_task` | 只读 | 任务识别、Skill/规则子集和统一安全写链计划；不直接修改代码 |

所有文件参数必须是 `WL_PROJECT_ROOT` 内的相对路径。绝对路径、`../` 越界和指向项目外的符号链接会被拒绝。入参由严格 JSON Schema 校验，未知字段、错误枚举、错误类型或非法 planHash 不进入 handler。

## 启动

`wl-skills-bd init` 会释放 Cursor、VS Code 和 Kiro 配置；根 `.mcp.json` 可供兼容客户端使用。Server 从环境变量读取项目根：

```json
{
  "mcpServers": {
    "wl-skills-bd": {
      "command": "node",
      "args": ["node_modules/@agile-team/wl-skills-bd/mcp/server.js"],
      "env": { "WL_PROJECT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

## 写工具统一协议

1. 先调用 plan/预览，返回动作、冲突/人工项和 `planHash`，本次零写入；
2. 用户评审后，再传 `confirmApply: true` 和同一 `planHash`；
3. handler 在写前重新计算计划；源文件、模板、契约或状态变化会使旧 hash 失效；
4. codegen 任一冲突默认整批零写入，显式 force 才会备份后覆盖；
5. codegen 的 `requireComplete=true` 会阻断含业务骨架的 draft；保护区补全后由 contract show/diff 验证完成度；
6. safe-fix 不支持 force，任何漂移都必须重新预览；
7. safe-fix 写前备份、失败回滚，写后强制复扫并生成 FIX_BE 报告。
8. config 的 init/migrate/fix 遵守各自计划与确认协议；task/troubleshoot 永远只读，不能作为旁路写入口。

调用方不得在同一次模型动作中先取 hash 又未经用户评审直接 apply。`confirmApply` 是用户授权的传递，不是让 Agent 自动填 true 的便利开关。

## 协议实现保证

- 支持 `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25`；未知版本协商到 Server 首选版本；
- `tools/list` 与 handler 来自同一 registry；
- 请求按输入顺序串行调度，避免同一工作区写工具并发交错；
- 工具异常返回 MCP `isError`，非法 JSON-RPC 参数返回 `-32602`；
- Server banner 只写 stderr，不污染 stdout JSON-RPC 流。

## 变更记录

- 2026-07-18 v4：扩展为 12 个工具；加入配置闭环、故障诊断和只读任务路由，所有代码写入继续复用统一安全链。
- 2026-07-18 v3：扩展为 11 个工具，加入配置闭环与故障诊断。
- 2026-07-18 v2：扩展为 9 个工具，统一 completion、生产授权和 `requireComplete` 语义。
- 2026-07-18 v1：从 3 个占位工具升级为 7 个工程闭环工具，并统一路径边界、严格 schema 与写入确认协议。
