<!--
document-meta:
  purpose: 提供 wl-skills-bd 从安装、模块上下文、代码生成到提交校验的最短使用路径
  audience: backend-developers-and-ai-agents
  source-of-truth: package-cli-and-standards
  maintained-by: wl-skills-bd
-->

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

## 当前模块上下文

首次从示例创建配置，登记模块边界、契约根、源码根、负责人和一跳上下游：

```bash
cp .wl-skills-bd/catalog.config.example.json .wl-skills-bd/catalog.config.json
```

日常开发只检查和刷新当前模块：

```bash
wl-skills-bd catalog check --module order
wl-skills-bd catalog plan --module order
wl-skills-bd catalog apply --module order --plan-hash <hash> --confirm
wl-skills-bd context plan --module order --task "增加订单创建接口" --json
```

其他模块只读取一跳快照；只有关系或任务关键词命中的契约进入上下文。快照缺失时告警并等待协同，不扫描对方源码、不扩大到全仓。`--full` 只用于 CI、首次初始化或显式治理。

## 新资源

1. 刷新当前模块 Catalog 并生成有界 Context Plan；
2. 从 `.github/templates/examples/feature-category.contract.json` 复制资源契约；
3. 明确数据库、`requestPath`、`externalBasePath`、五个权限码和字段白名单；
4. `codegen validate`；
5. `codegen plan` 评审 17 个基础产物及 N 个命令 RequestDTO；
6. 携带 planHash 与 `--confirm` 执行 apply；
7. 若有业务骨架，只在 `<wl-custom>` 保护区补实现和 ServiceTest；
8. 执行 `contract diff --strict`、validate、Maven test/verify；
9. DDL 另走 DBA/发布审批。

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

`init` 会安装编辑器配置。15 个工具及写入确认协议见 `mcp-workflow.md`。CLI 与 MCP 共用同一实现；不要把 MCP 当作绕过 planHash/人工评审的后门。`wls_be_task` 只做任务路由，实际写入仍走 codegen/safe-fix/config/catalog。

## 提交

```bash
git config core.hooksPath .githooks
wl-skills-bd commit doctor
wl-skills-bd commit validate --message "feat(order): 订单创建-增加幂等校验"
wl-skills-bd commit check --range origin/main..HEAD
```

本地 Hook 用于即时反馈，CI range 校验才是合并门禁。唯一格式为 `type(scope): 功能点-具体内容`，scope 必须是 Catalog 中登记的模块。
