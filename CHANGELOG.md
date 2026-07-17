# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [0.0.5] - 2026-07-17 (团队开发要求闭环)

### Added

- `standards/12-database-ddl.md` 新增 §0.5「数据库物理库归属」：三大库(hx_cxdb1/hx_non_cxdb2/hx_ptdb)+三用户(cxuser/nonuser/ptuser)+业务模块落库映射表+MDM Oracle 特例+db-migration 选库决策（Pre-flight 必填）。对齐手册§"数据库划分"，闭环建表选库
- `standards/02-project-structure.md` 新增「业务中心 × 工程包名映射」：sale/quality/produce/cost/safe/mdm 的工程名↔根包↔前端工程映射 + 工程目录角色(wl-apis/wl-common)+构建顺序+AI 包名校验约束。对齐手册§"工程及包名称约定""工程目录具体划分"，闭环新建工程包名生成
- `skills/ops/standard-env-config-be/SKILL.md` 新增「业务模块端口段分配」：10000~10899 段位表+端口冲突校验+MDM 待登记段。对齐手册§"业务模块端口划分"，闭环环境配置防冲突

### Changed

- `standards/index.md`：12 / 02 主题描述扩充；任务类型 D（db-migration）必读含 12 物理库归属；版本 v0.0.4 → v0.0.5

### Notes

- 闭环目标：后端代码生成（建表选库 / 新建工程包名 / 环境端口）不再偏离团队开发要求
- 不纳入范围：分支规范/合并链（由团队 Git 规范卡控）；Code Review/错误码字典/接口版本化（共同盲区，后续）
- 零代码副作用：仅 standards + skill markdown 变更

---

## [0.0.4] - 2026-07-17 (编码层规范对齐手册)

### Added

- 新增 `standards/18-git-commit.md`：Git 提交信息规范（类型code + 模块名 + 功能点 + 具体内容），对齐《项目开发手册》§"代码提交"。仅约束提交信息，不含分支策略
- `standards/02-project-structure.md` 新增"单目录文件 ≤20、10 以内最佳"粒度红线（对齐手册§"业务服务目录划分"），并纳入 `convention-audit-be` 计数

### Changed

- `standards/index.md`：17 → **18** 条清单；任务类型 E（审计）必读范围含 18；门控示例同步
- 版本 v0.0.2 → v0.0.4

### Notes

- 范围界定：本次只补手册中**编码层**（建目录/文件/命名/代码写法/提交）的要求；分支规范、工程包名映射表、端口划分、构建顺序、物理库划分等**工程治理/运维**类不纳入 standards，由团队其他渠道卡控
- 零代码副作用：仅 standards markdown 变更，不碰任何业务工程
- 编码层核对结论：wl-skills-bd 在命名(03)/代码写法(04~07)/分层(02) 上与手册一致且更细，本次仅补齐"提交规范"与"单目录粒度"两处缺口

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

[0.0.5]: about:blank
[0.0.4]: about:blank
[0.0.3]: about:blank
[0.0.2]: about:blank
[0.0.1]: about:blank
