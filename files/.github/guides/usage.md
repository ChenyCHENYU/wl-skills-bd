# wl-skills-bd 使用指南

## 安装与诊断

```bash
npm install -D @agile-team/wl-skills-bd
npx wl-skills-bd init --dry-run
npx wl-skills-bd init
npx wl-skills-bd check
npx wl-skills-bd doctor
```

`init/update` 遇到未受管或本地修改文件默认整批零写入；`--force` 会先备份。`clean` 只删除内容仍等于安装哈希的受管文件。

建议在业务工程 `.gitignore` 加入：

```gitignore
.wl-skills-bd/.state/
```

## 新资源

1. 从 `.github/templates/examples/feature-category.contract.json` 复制资源契约；
2. 明确数据库、`requestPath`、`externalBasePath`、五个权限码和字段白名单；
3. `codegen validate`；
4. `codegen plan` 评审 16 个产物；
5. 携带 planHash 与 `--confirm` 执行 apply；
6. 若有业务骨架，只在 `<wl-custom>` 保护区补实现和 ServiceTest；
7. 执行 `contract diff --strict`、validate、Maven test/verify；
8. DDL 另走 DBA/发布审批。

命令见 `codegen-workflow.md` 和 `frontend-backend-contract.md`。

## 存量工程审计

```bash
wl-skills-bd validate . --strict
wl-skills-bd validate . --format sarif --output reports/backend.sarif
```

规则型且满足严格前置条件的 B3/B5 可进入安全修复：

```bash
wl-skills-bd fix plan src/main --rules B3,B5 --json
wl-skills-bd fix apply src/main --rules B3,B5 --plan-hash <hash> --confirm
```

其余规则按报告人工处理。修复器不会猜权限码、把 `${}` 盲换成 `#{}`、自动补租户谓词或生成空洞 Javadoc。

## 与前端协作

| 协作点 | 后端产物 | 校验 |
|---|---|---|
| URL/字段 | `docs/contracts/*.api.md` + machine block | `contract diff --frontend` |
| 运行实现 | 测试环境 OpenAPI 3 JSON | `contract diff --openapi` |
| 权限 | wl-api-contract 权限码 | `contract diff --permissions` |
| 响应 | code=2000、data.records/data.total | manifest + OpenAPI |

## MCP

`init` 会安装编辑器配置。12 个工具及写入确认协议见 `mcp-workflow.md`。CLI 与 MCP 共用同一实现；不要把 MCP 当作绕过 planHash/人工评审的后门。`wls_be_task` 只做任务路由，实际写入仍走 codegen/safe-fix/config。
