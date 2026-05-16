# 贡献指南

## 提交流程

1. 在 `kit-internal/architecture.md` 追加 ADR（如涉及架构决策）
2. 修改 `files/.github/...` 内容
3. 更新根 `CHANGELOG.md`
4. 提交 PR，跟 `mdm-service` 一个真实模块跑回归验证

## 命名约定（本包内）

- standards 文件：`{编号2位}-{kebab-case}.md`
- SKILL 目录：`skills/{core|data|test|ops|domain}/{kebab-name}/`
- SKILL 文件：`SKILL.md` + `USAGE.md`（可选）
- ADR：递增编号，不复用

## 不允许

- 不要在 `files/.github/copilot-instructions.md` 加业务逻辑
- 不要把维护者文档（kit-internal）放进 files/ 分发包
- 不要直接编辑生成的 `CLAUDE.md` / `AGENTS.md` 派生文件（0.2.x 由 CLI 生成）
