# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [0.5.1] - 2026-07-17 (一致性修正 + codegen 闭环权威文档)

### Fixed — registry/pipeline 状态滞后（v0.4~v0.5 补厚后状态未同步）
- `_registry.md`：6 个 Skill 状态 🟡骨架 → ✅落地（entity/service/mapper-codegen + convention-audit-be + code-fix-be + standard-env-config-be）；补落地度统计行
- `_pipeline.md`：标题 v0.0.1 → v0.1；阶段总览补 api.md 唯一输入 + ⑧⑨ 计数同步 19 条；④ 团队基线无独立接口澄清；③④⑤ 加 templates/self_check 机制；⑧ 执行器清单补全（J1~J6）；⑨ 复扫闭环细化

### Added — codegen 闭环权威文档
- 新增 `guides/codegen-workflow.md`：定义三个闭环
  - **闭环一·生成顺序**：api.md → ②~⑦（8 阶段严格不跳级）+ 一个菜单 14 文件清单 + 每阶段防胶水机制
  - **闭环二·验证**：三层兜底（生成后 validate B1~B11 → 全量审计 19 条+J1~J6 → CI mvn verify）+ 19 规范×7 执行器覆盖矩阵
  - **闭环三·修复**：code-fix-be 强制复扫流程 + 复扫报告格式 + 修复对照表 + 修复禁区
- copilot-instructions 主入口加"生成代码必读"段，引用闭环文档

### Changed
- 版本 0.5.0 → 0.5.1

### Notes
- 解决用户反馈：明确"生成顺序/如何验证/如何修复"三闭环，让 codegen 不再是零散动作而是确定流程
- 一致性：registry 状态与各 SKILL.md frontmatter 严格对齐（lint-skills 已校验，未来保持）

---

## [0.5.0] - 2026-07-17 (设计规约 + 社区最佳实践闭环)

### 重大改进：从"语法级"升级到"设计级"代码质量管控

补齐代码质量第二根支柱——社区最佳实践 + 设计原则。解决 bd 只能查出语法问题（SELECT *、缺注解），查不出设计问题（上帝类、长方法、过度设计）的洼地。这是"生成代码能维护 vs 能用"的分水岭。

### Added — P0-A 设计规约（新章节，依据黄山版第七章 + SOLID + Clean Code + Refactoring）
- 新增 `standards/19-design.md`（260 行）：
  - 三大设计总则：YAGNI / KISS / DRY（黄山版第七章）
  - SOLID 五原则（含生成代码应用示例 + mdm-service 3373 行上帝类反面）
  - 长度红线：方法≤50行 / 类≤500行 / 圈复杂度≤10 / 参数≤5（be-rules B9/B10/B11 兜底）
  - 何时抽象/封装：三次法则 + 封装决策表（解决"该不该封装"高频疑问）
  - 设计模式适用清单：策略/模板方法/建造者等"何时用"（非罗列 23 种）
  - 反模式清单：上帝类/长方法/霰弹式修改/Feature Envy/过度设计
  - 方法/类设计规范 + 注释设计（与 15 联动）
  - AI 生成代码检查清单（10 项）

### Added — P0-B 阿里 P3C 规则集（J6 · 社区最佳实践机器卡控）
- 新增 `pmd/ali-p3c-ruleset.xml`：引用 `com.alibaba.p3c:p3c-pmd:2.1.1`（黄山版 54 条规则）
  - 覆盖 10 个规则集：ali-naming/ali-constant/ali-oop/ali-set/ali-concurrent/ali-flowcontrol/ali-exception/ali-comment/ali-other/ali-orm
  - 设计级补充：ExcessiveMethodLength(80) / ExcessiveParameterList(5) / CyclomaticComplexity(10) / ExcessiveClassLength(500) / GodClass
- 更新 `pmd/README.md`：两套规则集并存（PMD 官方 + P3C）+ 54 条分类速查
- 更新 `maven-snippets/pom-plugins.xml`：PMD 段加 p3c-pmd 依赖 + 双 ruleset 配置

### Added — P1 be-rules 扩 B9/B10/B11（设计级机器兜底，19 §3）
- `lib/be-rules.js` 新增 3 条规则（对所有 .java 触发）：
  - B9 类长度 >500 行（error，上帝类检测）
  - B10 方法长度 >80 行（warn/error）
  - B11 圈复杂度 >10（warn/error）
- 测试覆盖：4 个新用例（B9 检出+不误报 / B10 / B11）全过
- ★ 实战验证：对 mdm-service 跑出 B9 命中 2 个上帝类 + B10 命中 11 个长方法 + B11 命中 25 个高复杂度方法（含 MdmModelService 3373 行、saveModel 129 行/复杂度 17）

### Added — P1 Javadoc 规范（15 R23/R24 + Checkstyle）
- `15-code-quality.md` 新增 R23（类 Javadoc @author）/ R24（public 方法 Javadoc @param/@return/@throws）
- `checkstyle.xml` 加 JavadocType + JavadocMethod 检查

### Changed
- `rule-coverage.md`：新增 J6（P3C）+ B9/B10/B11 + 19 设计规约映射
- `index.md`：18→19 条；任务类型 E 审计必读含 19
- `copilot-instructions.md`：版本同步 v0.5.0 + 19 条
- `lint-skills.js`：J6→pmd 目录映射
- 版本 0.4.2 → 0.5.0

### Notes
- 代码质量双支柱完整：① 团队规范（02~18 语法/分层）② 社区最佳实践 + 设计（19 + P3C）
- 执行器覆盖：be-rules B9/B10/B11（regex 即时）+ Checkstyle Javadoc + P3C J6（CI 硬卡）
- 验证：`npm run verify` 全绿；11 个 be-rules 测试全过；mdm-service 实战命中上帝类/长方法/高复杂度
- 后续可选：14 单测骨架补厚 / SKILL.md 全部补厚 / MCP 扩 db-migration 工具

---

## [0.4.2] - 2026-07-17 (规范方法论修正 · 官方/社区最佳实践为基线)

### 重大修正：纠正"对齐存量代码"的方法论错误

之前 v0.4/v0.4.1 把 mdm-service（AI 生成的存量代码）当"权威基线"对齐，是本末倒置——存量代码有多租户硬编码"1"、SQL 注入、上帝类(3373行)、漏事务+混Feign 等严重缺陷。规范应高于存量代码。本次改为以**官方/社区最佳实践**为唯一基线，mdm-service 的缺陷明确标注为**反面教材**。

### Changed — 5 条规范依据权威来源重写
- `11-security`：依据 **MyBatis-Plus 官方多租户(TenantLineHandler 插件)** 重写 COMPANY_ID 部分；**明确禁止硬编码**（mdm-service 硬编码"1"致多租户失效，标注为反面教材）
- `10-transaction`：依据 **Spring 官方文档**（已核实 self-invocation/方法可见性/Propagation）；标注 mdm-service 漏事务+混Feign 反面
- `08-exception`：依据 **Effective Java(异常章节) + Spring @ControllerAdvice**；标注 dingtalk 22 处 RuntimeException 反面
- `09-logging`：依据 **SLF4J 官方(参数化日志) + OWASP 日志安全**
- `01-toolchain`：改为团队 jh4j-cloud 技术栈要求（非对齐存量项目）

### Changed — 清理"倒推/对齐存量代码"的错误指示（方法论）
- `_registry.md` / `guides/usage.md` / `guides/architecture.md`：删"按 mdm-service 真实代码风格倒推/为准"
- `templates/README.md`：模板来源改为"官方/社区最佳实践 + 团队 standards"
- `04/05/06` 标题：去"基于 mdm-service 真实代码"，改"依据 Spring/MyBatis-Plus 官方"
- `02/03`：基线措辞改 jh4j-cloud 体系 + Java 官方约定
- `api-design-be/SKILL.md`：按 Spring MVC 官方 RESTful 约定生成（非存量风格）
- `copilot-instructions.md`：新增方法论原则段——不对齐存量项目，存量偏离应整改

### Changed
- `verify-version.js`：README 徽章正则兼容新格式
- 版本 0.4.1 → 0.4.2

### Notes
- 修正后规范层方法论：官方/社区最佳实践 > 团队 standards > 存量代码（存量仅作反面教材或整改对象）
- 验证：`npm run verify` 全绿；危险措辞 grep 清零

---

## [0.4.1] - 2026-07-17 (5 条必遵规范骨架补厚)

### 重大改进：规范层从 11 落地/7 骨架 → 16 落地/2 骨架（建议级）

解决"🔴 必遵却只有 40-60 行骨架"的自相矛盾。5 条必遵规范全部补厚到落地深度，每条含决策表/模板/正反例，并对齐 mdm-service 真实代码。

### Changed — 5 条必遵规范补厚
- `01-toolchain`：35→70 行。补数据库类型探测决策表(Oracle/MySQL) + 7 项检测清单 + doctor 联动
- `08-exception`：47→130 行。补 ServiceAssert 全方法(isNotNull/isNull/isTrue/hasText，对齐 mdm-service 233 处用法) + 业务码字典分段 + ServiceException 模板 + 全局 Advice 完整版 + 正反例
- `09-logging`：40→110 行。补脱敏正则表(手机/身份证/银行卡) + traceId/MDC 复制 + 级别决策表 + 大字段截断
- `10-transaction`：60→140 行。补回滚矩阵(checked/RuntimeException) + 传播行为场景表(REQUIRED/REQUIRES_NEW) + self-injection 三方案 + 5 个禁止陷阱(Feign/MQ/自调用/吞异常/长事务) + 对齐 mdm-service 76 处真实写法
- `11-security`：43→130 行。补权限码同步流程 + COMPANY_ID 完整模板(对齐 29 处真实 BaseColumns) + 越权检查清单 + 公开接口规范 + 正反例

### Changed — 治理同步
- `standards/index.md`：01/08/09/10/11 状态 🟡骨架 → ✅已落地；主题描述更新
- `copilot-instructions.md`：版本同步 v0.4.1
- 版本 0.4.0 → 0.4.1

### Notes
- 规范层成熟度：18 条中 16 条已落地（仅 13 Swagger / 14 单测为🟡建议级骨架）
- 核心链路"架构→命名→各层→DDL→质量→性能→漏洞→异常→日志→事务→安全→提交"全部落地
- 验证：`npm run verify` 全绿

---

## [0.4.0] - 2026-07-17 (codegen SKILL 补厚落地)

### 重大改进：3 个 codegen Skill 从骨架升级到落地深度

解决 codegen SKILL.md 过薄（56~83 行）导致 AI 生成时缺乏执行步骤/边界用例/正反例的问题。对标 wl-skills-kit 的 SKILL.md（平均 200+ 行）+ USAGE.md（12 个）。

### Changed — SKILL.md 补厚（56→150+ 行）
- `entity-codegen/SKILL.md`：补完整执行步骤（5步）、字段类型映射表、占位符填空规则、DTO 校验生成规则、边界用例（树形/金额/富文本/枚举/时间范围）、正反例对照
- `service-codegen/SKILL.md`：补执行步骤（4步）、CRUD 5 方法模板展开、状态变更四段式、软删除实现、权限码命名速查、validate 自检对照、边界用例（批量/树形/联表/状态机）、正反例
- `mapper-xml-gen/SKILL.md`：补执行步骤（4步）、BaseColumns 生成规则、动态查询类型表、Oracle vs MySQL 差异表、foreach 批量、validate 自检对照、边界用例（联表/动态排序/IN/大字段）、正反例
- 三个 SKILL status 🟡骨架 → ✅已落地

### Added — 3 个 USAGE.md（执行细节，对标 kit 12 个）
- `entity-codegen/USAGE.md`：4 典型场景（标准CRUD/树形/金额/仅补VO）+ 占位符填空示例 + FAQ
- `service-codegen/USAGE.md`：4 典型场景（标准CRUD/状态变更/批量导入/联表详情）+ 权限码速查 + validate 对照 + FAQ
- `mapper-xml-gen/USAGE.md`：4 典型场景（分页/联表/批量IN/简单lambdaQuery）+ Oracle/MySQL 速查 + validate 对照 + FAQ

### Changed — 自检
- `lint-skills.js`：新增 core codegen Skill 必须配 USAGE.md 校验（entity/service/mapper）
- 版本 0.3.1 → 0.4.0

### Notes
- codegen 质量三层保障强化：① SKILL.md 有执行步骤指引 ② USAGE.md 有典型场景 + FAQ ③ templates 填空 + validate 自检
- 验证：`npm run verify` 全绿（含 USAGE.md 存在性校验）

---

## [0.3.1] - 2026-07-17 (多编辑器适配)

### Added — 全编辑器 MCP 接入（对标 wl-skills-kit）
- `files/.cursor/mcp.json`：Cursor 编辑器 MCP 配置（mcpServers 格式）
- `files/.vscode/mcp.json`：VS Code 编辑器 MCP 配置（servers + type:stdio 格式）
- `files/.kiro/settings/mcp.json`：Kiro 编辑器 MCP 配置
- init 后三套配置自动释放到业务工程根目录，各编辑器自动发现并启动 MCP server

### Changed — 指令文件同步
- `copilot-instructions.md`：第 6 节多编辑器适配从"待物化"改为"已物化"表格（6 编辑器）；补 MCP 3 工具说明；第 7 节阶段说明更新到 v0.3.1（18 标准/J1~J5/模板/复扫闭环全落地）
- `CLAUDE.md`："17 条"→"18 条"
- `AGENTS.md`：技术栈速查补 templates/validate/java-quality
- `verify-version.js`：新增三套编辑器 mcp.json 存在性 + JSON 合法性 + server 路径校验
- 版本 0.3.0 → 0.3.1

### Notes
- 编辑器覆盖：GitHub Copilot / Cursor / VS Code / Kiro / Claude Code / 通用 Agents 六端
- 验证：`npm run verify` 含多编辑器配置校验

---

## [0.3.0] - 2026-07-17 (P2 落地 · MCP 工具层 + Java 工具链补全 + 提交规范强制)

### 重大改进：Java 检查工具链完整 + AI 对话内可确定性调用

补齐 J3/J4/J5（PMD/SpotBugs/Spotless），Java 检查工具从 2 个到 5 个全覆盖；MCP 让 AI 在对话内直接调 validate/standards/templates；git hook 强制提交规范。

### Added — P2-A MCP 工具层（对标 kit/mcp）
- `mcp/server.js`：MCP 协议实现（stdio + JSON-RPC 2.0），3 个工具注册
- `mcp/registry.js`：工具注册中心（单一数据源）
- `mcp/tools/beRulesTools.js`：包装 lib/be-rules，暴露 wls_be_validate
- `mcp/schema-validator.js`：工具入参 JSON Schema 校验
- `.mcp.json`：编辑器接入配置
- 3 工具：`wls_be_validate`（扫 B1~B8）/ `wls_be_standards`（查 18 条规范）/ `wls_be_templates`（查 8 个代码模板）

### Added — P2-B Git Hook 强制提交规范
- `commitlint.config.js`：commitlint 配置（type-enum 9 种 + 格式校验）
- `files/.github/git-hooks/`：commit-msg hook + README，业务工程可一键接入
- 18-git-commit 从"文字规范"升级为"hook 强制卡控"

### Added — P2-C PMD/SpotBugs/Spotless（J3/J4/J5 补全）
- `java-quality/pmd/pmd-ruleset.xml`：性能+漏洞+质量规则集（J3）
- `java-quality/spotbugs/spotbugs-exclude.xml`：字节码分析 + 排除生成代码（J4）
- `java-quality/spotless/`：格式统一（google-java-format AOSP）（J5）
- 各含 README 接入指引；Java 检查工具链 J1~J5 全覆盖

### Changed
- verify-version.js 增 MCP 工具数 + 模板完整性 + mcp/ 纳入 files 校验
- test script 纳入 mcp-registry.test.js
- rule-coverage.md：J3/J4/J5 状态从"待落地"→"已落地"
- package.json 0.2.0 → 0.3.0；files 加 mcp；keywords 加 pmd/spotbugs/spotless/mcp

### Notes
- 验证：`npm run verify` 全绿（version + lint + test 含 MCP 用例）
- Java 检查工具链完整度：ArchUnit(J1) + Checkstyle(J2) + PMD(J3) + SpotBugs(J4) + Spotless(J5) + be-rules(regex B1~B8)，对标 kit 的 ESLint，但体现 Java 多元工具链
- 提交规范双保险：18-git-commit.md（人读）+ commit-msg hook（机强制）

---

## [0.2.0] - 2026-07-17 (P1 落地 · 引擎可用 + 闭环可验证)

### 重大改进：从"引擎孤岛"到"业务工程可用 + 闭环可验证"

解决三个根本缺陷：① be-rules 引擎无入口（孤岛）② codegen 无标准答案（自由发挥→胶水代码）③ 修复无复扫（改完不知对不对）。

### Added — P1-A Java 代码模板（堵胶水代码源头）
- `files/.github/templates/` 8 个标准骨架：Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml + README
- 对标 kit 的 templates/(45个)，物化团队基线(CoreEntity/JhServiceImpl/@PreAuthorize/@Transactional/软删/BaseColumns)
- 占位符填空机制：codegen Skill 读模板替换，非从零发挥

### Added — P1-B CLI validate（引擎对业务工程可用）
- `bin/wl-skills-bd.js` 新增 validate 命令：接 lib/be-rules.js，B1~B8 全跑，按规则分组输出，有 error 非零退出（CI 可阻断）
- 新增 doctor 命令：工具链 + java-quality 接入体检
- ★ 实测对 mdm-service 跑出 195 项（162 error + 33 warn），精准定位文件:行号，证明引擎非孤岛

### Added — P1-C/D 复扫闭环（对标 kit/code-fix）
- `convention-audit-be` 加 --quick 复扫模式 + 前后对比矩阵（仅查上次偏差，省 90% token）
- `code-fix-be` 落地强制复扫闭环（"不可跳过"硬约束）：修复后必须跑 validate，输出 error:0/变化矩阵
- 审计→修复→复扫 链条闭合

### Changed — codegen 三 SKILL 引用 templates
- entity-codegen / service-codegen / mapper-xml-gen：生成方式从"自由发挥"改为"读模板填空"
- 完成摘要加"生成后自检 wl-skills-bd validate"约束

### Changed
- package.json/README/bin/index 版本 0.1.0 → 0.2.0
- convention-audit-be / code-fix-be status 🟡骨架 → 🟡落地

### Notes
- 验证：`npm run verify` 全绿；validate 对真实 mdm-service 跑出 195 项
- 防"意大利面条代码"三层保障：① codegen 读模板填空 ② validate 生成后自检 ③ Checkstyle+ArchUnit CI 卡控
- 待续 P2：MCP wrapper / PMD+SpotBugs / SKILL.md 补厚

---

## [0.1.0] - 2026-07-17 (架构完善 · 自检闭环 + Java 质量执行器)

### 重大改进：从"纯骨架"升级为"可自检、可机器卡控"

解决两个根本缺陷：① 发版靠人眼（脚本全 echo）② 审计非确定性（文字清单无执行器）。对标 `wl-skills-kit` v2.12.6 的成熟架构，适配 Java 后端工具生态。

### Added — L0 自检层（对标 kit/scripts）
- `scripts/verify-version.js`：版本 + standards 计数(18) + skills 计数(10) + npm files 数组交叉校验（对标 kit/verify-version.js）
- `scripts/lint-skills.js`：SKILL.md Pre-flight/standards 引用/路径存在/行数/规则覆盖矩阵校验（对标 kit/lint-skills.js）
- `tests/be-rules.test.js` + `tests/verify-version.test.js`：执行器回归测试（对标 kit/tests）
- `package.json` 补 `verify`/`release:check`/`prepublishOnly` —— 发版前强制全量自检，杜绝漂移

### Added — L1 执行器层（防胶水代码核心）
- `lib/be-rules.js`：后端确定性规则引擎 B1~B8（正则/行级），对标 kit/ast-rules.js。覆盖：Controller 缺 @PreAuthorize(B1)、缺 @ApiOperation(B2)、SELECT *(B3)、${}注入(B4)、缺 @Transactional(B5)、目录文件数(B6)、缺 COMPANY_ID(B7)、裸 RuntimeException(B8)

### Added — L2 Java 质量规则集（机器确定性卡控，Java 生态）
- `files/.github/java-quality/archunit/`：ArchUnit 分层规则测试模板（J1）—— 把 standards/02"禁止跨层"从文字变成 CI 硬卡控
- `files/.github/java-quality/checkstyle/`：Checkstyle 规则集 checkstyle.xml（J2）—— standards/03/15 物化
- `files/.github/java-quality/maven-snippets/`：5 工具一键接入 pom 片段
- `files/.github/java-quality/README.md`：工具映射 + 三场景分工（IDE/CI/AI）

### Added — 治理基线
- `kit-internal/architecture.md`：三层职责 ADR（对标 kit/architecture.md）
- `kit-internal/rule-coverage.md`：规则覆盖矩阵（对标 kit/rule-coverage.md）—— 治理规则：阻断约定必须有 J*/regex 执行器兜底，lint-skills 自动校验

### Changed
- `package.json`：0.0.5 → 0.1.0；补 scripts；files 数组加 `lib`；keywords 加 checkstyle/archunit
- `bin/wl-skills-bd.js` / `README.md` / `standards/index.md`：版本同步 0.1.0
- `standard-env-config-be/SKILL.md`：Pre-flight 补 standards/01 引用

### Notes
- 工具映射：Checkstyle(命名/风格) + PMD(静态分析,P2) + SpotBugs(字节码,P2) + ArchUnit(架构分层) + Spotless(格式,P3)。对标 kit 的 ESLint，但体现 Java 多元工具链
- 三场景分工：IDE(实时) / Maven CI(build failure) / AI 审计(be-rules 即时跑)
- P0(自检) + P1(ArchUnit/Checkstyle/be-rules) 已闭环；P2(PMD/SpotBugs) + P3(Spotless) + SKILL.md 补厚 留后续逐个细化
- 验证：`npm run verify` 全绿（version + lint + test 三关）

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

[0.5.1]: about:blank
[0.5.0]: about:blank
[0.4.2]: about:blank
[0.4.1]: about:blank
[0.4.0]: about:blank
[0.3.1]: about:blank
[0.3.0]: about:blank
[0.2.0]: about:blank
[0.1.0]: about:blank
[0.0.5]: about:blank
[0.0.4]: about:blank
[0.0.3]: about:blank
[0.0.2]: about:blank
[0.0.1]: about:blank
