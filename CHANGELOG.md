# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

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

[0.0.1]: about:blank
