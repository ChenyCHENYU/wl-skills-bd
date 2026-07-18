# wl-skills-bd 内部维护文档

> 本目录是**给本包维护者看的**，不会被分发到业务工程的 `.github/` 中。

## 目录

- [`architecture.md`](architecture.md) — 整体架构 + ADR 决策记录
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 贡献流程
- 后续可补 `*.MAINTAIN.md` 维护手册

## 维护边界

- `files/.github/` → 分发给业务工程的内容（用户视角）
- `kit-internal/` → 维护本包的内容（开发者视角）
- `docs/` → 用户/团队都可读的产品文档（分析报告 / 路线图）

## 当前版本

- v0.13.0：26 条 standards、11 个 Skill、14 个代码生成模板/16 个生成产物、7 个配置模板、B1~B23、J1~J8、12 个 MCP 工具；独立 delivery profile、wl-api-contract、业务保护区、严格完成度门、配置分层及只读任务路由均已闭环。
