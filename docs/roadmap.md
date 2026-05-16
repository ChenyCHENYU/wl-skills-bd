# wl-skills-bd 路线图

## v0.0.1 — 骨架（当前）

- ✅ 14 条 standards（6 ✅ 落地 / 8 🟡 骨架）
- ✅ 9 个 SKILL frontmatter + 流程纲要
- ✅ copilot-instructions.md 主入口
- ✅ 三件套：`_registry.md` / `_pipeline.md` / `_best-practices.md`
- ✅ kit-internal 维护文档（ADR-001/002/003）
- ✅ `docs/analysis-report.md` 分析报告

## v0.1.x — PoC（1-2 个迭代）

- 🎯 选 `mdm-service` 一个真实模块（特征量分类）跑通 ②→⑨ 全链路
- 🎯 8 条骨架 standards 补内容
- 🎯 9 个 SKILL 模板补完整（产物示例 + 反例 + 回归用例）
- 🎯 CLI `init` 实现：从 `wl-skills-bd/files/.github` 安装到业务工程
- 🎯 PoC 验收报告归档到 `docs/poc-report.md`

## v0.2.x — 工程化

- 🎯 CLI `update / diff / check / doctor` 实现
- 🎯 多 AI 编辑器派生：`CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.windsurf` / `.clinerules` / `.kiro` / `.trae` / `.qoder` 自动生成
- 🎯 与 wl-skills-kit 共享契约同步检查（权限码、api.md 格式）
- 🎯 上线 npm（私有源）

## v0.3.x — MCP 集成

- 🎯 DB schema 查询 MCP（替代手抄 DDL）
- 🎯 Git 状态 / Branch / Diff MCP
- 🎯 Jira / 飞书任务详情 MCP（task → SKILL 入参）

## v0.4.x — Domain Skills

- 🎯 `domain/` 类目下沉：行业 / 业务复杂模块的领域级 SKILL
- 🎯 跨服务编排 Skill（Saga / 分布式事务）

## v1.0 — 稳定生产版

- 🎯 全 14 条 standards 落地
- 🎯 9 个核心 SKILL 全部 ✅
- 🎯 至少 3 个真实业务服务全量接入
- 🎯 单测覆盖率红线 / 审计自动化跑在 CI

## 已识别但未排期

- AI 自动生成 Feign / OpenAPI 客户端 SDK
- 性能与可观测性 Skill（Prometheus 指标 / SkyWalking 接入）
- 安全扫描 Skill（依赖漏洞 / SQL 注入静态检测）
