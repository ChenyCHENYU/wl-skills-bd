<!--
document-meta:
  purpose: 定义后端项目唯一的提交标题格式、配置来源和本地与 CI 的执行边界
  audience: backend-developers-and-maintainers
  source-of-truth: .wl-skills-bd/catalog.config.json
  maintained-by: wl-skills-bd
-->

# 18 · Git 提交信息规范（已落地）

> 本规范包含团队开发手册要求的“类型、模块、功能点、具体内容”，但将分隔符统一为工具链可确定校验的半角 Conventional Commits 格式。分支、合并链、仓库保护与发布分支仍由团队单独治理。

## 1. 唯一格式

```text
type(scope): 功能点-具体内容
```

- `type`：小写类型，白名单来自 `.wl-skills-bd/catalog.config.json` 的 `commit.types`。
- `scope`：必须是 `catalog.config.json` 中登记的模块 ID，不接受任意文本。
- `功能点-具体内容`：两侧均非空；默认必须使用半角 `-` 分隔。
- `type`、括号、冒号和空格必须使用半角字符；不再同时接受全角变体。
- 标题长度默认不超过 100 字符，可在配置允许范围内调整。

合法示例：

```text
feat(order): 订单创建-增加请求幂等校验
fix(customer): 客户查询-修复租户条件遗漏
docs(billing): 结算对账-补充人工恢复说明
```

## 2. 类型与 scope

默认类型为 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`style`、`build`、`ci`、`chore`、`revert`。项目可以删减或评审后扩展，执行器只认配置中的值。

scope 不再从包名、分支或个人记忆推断。模块新增、拆分、合并时，先更新项目 Catalog 配置并评审关系，再使用新的 scope。

## 3. 执行闭环

```bash
# 单条消息或 Git commit-msg 文件
wl-skills-bd commit validate --message "feat(order): 订单创建-增加幂等校验"
wl-skills-bd commit validate --file .git/COMMIT_EDITMSG

# 本地 Hook 状态
git config core.hooksPath .githooks
wl-skills-bd commit doctor

# CI 权威校验；range 基线由流水线提供
wl-skills-bd commit check --range origin/main..HEAD
```

本地 Hook 可被 `--no-verify` 绕过，只负责即时反馈。CI range 校验才是不可跳过的合并门禁。本包提供校验器和版本受控 Hook，不固化分支名称、不自动提交。

## 4. 提交质量

- 一个提交一个意图；功能与无关修复应拆分。
- 提交标题描述结果，不写“改一下”“更新代码”等无证据内容。
- AI 可以建议消息，但不得自动提交；提交动作由开发者完成。
- 生成代码、DDL 或文档时，提交前仍必须完成相应质量与安全闭环。

## 变更记录

- 2026-07-19 v0.15：统一为可执行的 `type(scope): 功能点-具体内容`，scope 接入模块 Catalog，本地 Hook 与 CI range 校验落地。
- 2026-07-18 v0.14：按团队边界移除分支模型，只保留提交信息规范。
