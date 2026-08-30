# MCP 工具与写入安全

`wl-skills-bd` MCP Server 通过 stdio 暴露 16 个本地工程工具，不连接数据库、网关或生产系统。

## 工具清单

| 工具 | 类型 | 作用 |
|---|---|---|
| `wls_be_validate` | 只读 | B1~B31 扫描；默认摘要，支持 quick/staged/changed/rules/detail/maxItems/maxBytes，并返回 coverage/status |
| `wls_be_doctor` | 只读 | JDK/Maven/Profile/质量门/租户证据诊断 |
| `wls_be_codegen` | 受控写 | contract validate/plan/apply，17+N 个受管产物 |
| `wls_be_contract` | 只读/受控写 | seed/inspect/show/diff/impact/integration-inspect；migrate 使用计划确认链 |
| `wls_be_safe_fix` | 受控写 | 仅 B3/B5 白名单修复与强制复扫 |
| `wls_be_standards` | 只读 | 查询 29 条规范 |
| `wls_be_templates` | 只读 | 查询 16 个模板白名单 |
| `wls_be_db_preview` | 只读 | CREATE/ALTER DDL 与 Expand-Contract 预览 |
| `wls_be_export_permissions` | 受控写 | 导出 kit 权限清单片段 |
| `wls_be_config` | 只读/受控写 | doctor/init/migrate/fix；写操作必须预览、确认并保留迁移证据 |
| `wls_be_troubleshoot` | 只读 | DB/Redis/Nacos/K8s 等常见故障诊断树 |
| `wls_be_task` | 只读 | 任务识别、Skill/规则子集和统一安全写链计划；不直接修改代码 |
| `wls_be_catalog` | 只读/受控写 | 当前模块目录 plan/apply/check/show、section/cursor 与 integration-audit；其他模块只复用快照 |
| `wls_be_context` | 只读 | 当前模块与一跳上下游快照的预算化文件选择；不扫关联源码 |
| `wls_be_commit` | 只读 | 单条提交、Git range 与本地 Hook 接入检查 |
| `wls_be_test` | 只读 | 行为契约测试场景与可执行 ServiceTest 生成 |

所有文件参数必须是 `WL_PROJECT_ROOT` 内的相对路径。绝对路径、`../` 越界和指向项目外的符号链接会被拒绝。入参由严格 JSON Schema 校验，未知字段、错误枚举、错误类型或非法 planHash 不进入 handler。

## 统一结果预算

16 个工具都支持同一 `response` 对象：

```json
{
  "response": {
    "mode": "summary",
    "maxItems": 20,
    "maxBytes": 12000
  }
}
```

- `summary` 用于判断状态与下一步，`compact/full` 只在需要定位或读取正文时启用；
- 数组和字符串先按统一预算裁剪，响应声明 `originalBytes/returnedBytes/estimatedTokens/truncated`；
- 超预算完整结果短期保留在 MCP 进程内，使用同一工具和 `{ "response": { "cursor": "<nextCursor>" } }` 续取，不重跑 handler；
- cursor 有期限、绑定原工具且不写项目目录，过期或跨工具使用时 fail-closed。
- Catalog `show` 优先使用 `section/limit/cursor` 在执行核心内先裁剪；字段影响也使用自身证据 cursor，再叠加通用响应预算，避免重复全量扫描。

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
7. safe-fix 写前备份、失败回滚，写后强制复扫并生成 FIX_BE 报告；
8. permissions export 默认预览，apply 同样要求 confirmApply + 当前 planHash，并执行备份、原子写、哈希复验与失败回滚；
9. config 的 init/migrate/fix 全部纳入当前文件哈希、重算计划、原子写与失败回滚；task/troubleshoot 永远只读，不能作为旁路写入口；
10. catalog apply 同样要求当前 planHash、确认、写前重算、原子写和回滚；模块模式不得扫描其他模块源码；
11. contract migrate 默认只返回确定性动作与 unresolved；apply 要求同一 planHash，保留备份并在未授权 unresolved 时零写入；
12. `pre/prod/production` 的受控写默认阻断；显式授权只覆盖工程文件，不授权数据库、部署或外部系统写入。

调用方不得在同一次模型动作中先取 hash 又未经用户评审直接 apply。`confirmApply` 是用户授权的传递，不是让 Agent 自动填 true 的便利开关。

## 协议实现保证

- 支持 `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25`；未知版本协商到 Server 首选版本；
- `tools/list` 与 handler 来自同一 registry；
- 请求按输入顺序串行调度，避免同一工作区写工具并发交错；
- 全工具响应经过统一字节/数组预算；大结果游标只存于当前 MCP 进程并有数量、大小与时间上限；
- 工具异常返回 MCP `isError`，非法 JSON-RPC 参数返回 `-32602`；
- Server banner 只写 stderr，不污染 stdout JSON-RPC 流。

## 变更记录

- 2026-08-31 v8：在既有 16 工具内加入契约分类/迁移、字段影响、集成检查、Catalog 分区分页与重复工具审计。
- 2026-08-24 v7：16 工具统一 response 预算、token 估算与短期大结果 cursor；task 返回标准 Pipeline。
- 2026-07-19 v6：扩展为 15 个工具；加入模块增量 Catalog、一跳 Context Plan 和提交消息/range 校验。
- 2026-07-18 v5：17+N 代码生成产物、16 模板；permissions/config 纳入统一 planHash/原子写/回滚与受保护环境护栏。
- 2026-07-18 v4：扩展为 12 个工具；加入配置闭环、故障诊断和只读任务路由，所有代码写入继续复用统一安全链。
- 2026-07-18 v3：扩展为 11 个工具，加入配置闭环与故障诊断。
- 2026-07-18 v2：扩展为 9 个工具，统一 completion、生产授权和 `requireComplete` 语义。
- 2026-07-18 v1：从 3 个占位工具升级为 7 个工程闭环工具，并统一路径边界、严格 schema 与写入确认协议。
