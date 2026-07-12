# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [0.0.3] - 2026-07-12 (骨架增强 · 环境标准化)

### Added

- 新增横切 ops Skill `standard-env-config-be`（后端环境标准化）：bootstrap.yml 占位符检测 + K8s 四环境清单对齐 + 本地启动模板，与前端 `wl-skills-kit/standard-env-config` 职责对称、对象不同
- 新增 `docs/env-standard-analysis.md` 需求基线：通用性证据（archetype 同源三方对比）、华新 Profile、晋升梯队模板、PoC 验收路径
- 核心技能数 9 → **10**，注册进 `_registry.md` / `_pipeline.md`（标为横切 ops）/ `_best-practices.md`（场景 7）

### Notes

- 不碰 Nacos 内配置 / Dockerfile / CI / 业务代码，能力边界明确
- 当前为骨架：SKILL.md + USAGE.md 落地，CLI `standard-env` 子命令与 MCP 待 0.2.x

---

## [0.0.1] - 2026-05-14 (骨架初始化)

### Added

- 仓库骨架建立：`files/.github/{standards,skills,guides,reports}` + `kit-internal/` + `docs/` + `bin/`
- README.md（详尽版）：阐明定位、与 `wl-skills-kit` / `wl-skills-ui` 的关系、L1–L7 路线图、后端 Pipeline、Skill 蓝图、技术栈基线、共性 vs 团队规范分离原则
- 14 条后端 standards 占位（其中 6 条核心已落地内容，其余为骨架待填）
- 9 个核心 Skill 占位骨架（api-design-be / service-codegen / entity-codegen / mapper-xml-gen / convention-audit-be / business-doc-extract-be / db-migration / unit-test-gen / code-fix-be）
- `_registry.md` / `_pipeline.md` / `_best-practices.md` 三件套（与 kit 对齐）
- `copilot-instructions.md` 多编辑器主入口
- 分析报告：`docs/analysis-report.md` 详细记录三仓库扫描结论与建议

### Notes

- 当前为 **骨架版**：可作为团队共建基线，所有 Skill 的 Pre-flight / 执行细节 / 模板需在后续 0.1.x → 0.2.x 逐步补齐
- 基线项目参考：`mdm-service`（hx_test 分支，jh4j-cloud 3.1.0 + MyBatis-Plus + Oracle）
- 外部参考（不集成）：`CLAUDE规范文档/后端`（HZERO 体系）；共性已抽到 standards，差异性留给团队基线

[0.0.3]: about:blank
[0.0.2]: about:blank
[0.0.1]: about:blank
