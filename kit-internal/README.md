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

- 当前基线：29 条 standards、12 个 Skill、16 个模板/17+N 个生成产物、7 个配置模板、B1~B31、J1~J8、16 个 MCP 工具；写入/查询约束、跨字段时间顺序、上下文来源、Profile HTTP/分页口径、Mapper 资源路径、框架扩展点容器测试与 Controller 真实端点均由契约/Profile/能力目录驱动，不绑定具体业务模块。
