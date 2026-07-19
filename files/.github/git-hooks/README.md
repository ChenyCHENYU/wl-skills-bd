<!--
document-meta:
  purpose: 说明后端项目如何启用提交信息校验，以及本地 Hook 与 CI 的职责边界
  audience: backend-developers-and-maintainers
  source-of-truth: .wl-skills-bd/catalog.config.json
  maintained-by: wl-skills-bd
-->

# Git 提交规范接入

唯一合法标题格式为：

```text
type(scope): 功能点-具体内容
```

`type` 白名单、`scope` 模块白名单与标题长度统一来自 `.wl-skills-bd/catalog.config.json`，由 `wl-skills-bd commit` 校验，不再维护第二份 commitlint 配置。

## 本地即时反馈

安装包后会得到版本受控的 `.githooks/commit-msg`。在项目根目录执行一次：

```bash
git config core.hooksPath .githooks
chmod +x .githooks/commit-msg  # Linux/macOS；init 会尽量自动设置
wl-skills-bd commit doctor
```

Hook 可被 `--no-verify` 绕过，因此它只负责提前反馈，不能作为最终合规证明。

## CI 权威门禁

CI 必须检查本次变更引入的全部提交：

```bash
wl-skills-bd commit check --range origin/main..HEAD
```

分支基线由团队流水线传入。CI 校验失败必须阻断合并；不要在包内固化分支名称。

## 单条消息排查

```bash
wl-skills-bd commit validate --message "feat(order): 订单创建-增加幂等校验"
wl-skills-bd commit validate --file .git/COMMIT_EDITMSG
```
