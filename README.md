# @agile-team/wl-skills-bd

> **企业级后端 AI Skills 模板包** — 让 Spring Boot + MyBatis(-Plus) + jh4j-cloud 体系的后端业务工程获得一致的分层规范、可被 AI 精确识别和生成的代码骨架，以及确定性检查闭环（CLI + MCP + Java 工具链 J1~J7）。

[![Status](https://img.shields.io/badge/status-v0.7.1-blue.svg)]()
[![npm](https://img.shields.io/badge/npm-0.7.1-red.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)]()
[![JDK](https://img.shields.io/badge/JDK-8%2B-blue.svg)]()
[![Standards](https://img.shields.io/badge/standards-19-orange.svg)]()

---

## TL;DR

```bash
# 已发布 npm，一键接入后端工程
npx @agile-team/wl-skills-bd init           # 释放规范+Skills+Java工具规则集+模板+Knife4j配置
npx @agile-team/wl-skills-bd validate       # ★ 确定性校验现有 Java 代码（B1~B12）
npx @agile-team/wl-skills-bd doctor         # 工具链接入体检

# 在 AI 对话中：
"基于前端 api.md 生成 Controller + Service + Mapper 三件套"
"扫描模块给出后端规范审计报告，修复后复扫验证"
"启动本地 /doc.html 按模块查看在线接口文档"
```

> **桥接关系**：本包专注后端；与前端 `@agile-team/wl-skills-kit` / `@agile-team/wl-skills-ui` 是 **三包独立、契约对齐** 的关系。三包共同消费 `api.md`，前后端协同写菜单/字典/权限。

---

## 这是什么？

一套面向 **集团 Spring Boot 后端体系** 的 "**规范 + Skill + Java 检查工具 + 模板 + MCP + CLI + Pipeline**" 全栈式 AI 工作流模板包，与前端 `wl-skills-kit` 镜像对称。

它要解决的问题：

> 后端是 AI 工作流里"看不见的下半段"：接口契约出来后，谁来按规范生成 Controller/Service/Mapper？谁来管 DDL 与回滚？谁来扫历史模块的分层违规？谁来保证生成的代码不跑偏成"意大利面条"？
>
> 本包就是补齐这半边——**让 AI 生成的 Java 代码既符合团队规范 + 社区最佳实践，又可被机器检查兜底**。

### 与 wl-skills-kit / wl-skills-ui 的职责切分

| 包                  | 职责                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `wl-skills-kit`     | 前端规范 + Skills（页面生成 / 审计 / 菜单字典权限同步），产出 `api.md`                        |
| `wl-skills-ui`      | 前端视觉一致性 / 设计令牌 / 化妆层 / Runtime 渲染                                             |
| **`wl-skills-bd`**  | **后端规范 + Skills（接口设计 / 代码生成 / DDL / 单测 / 审计）+ Java 检查工具链 J1~J7 + MCP + CLI，消费同一份 `api.md`** |

---

## v0.7.0 能力总览（已落地，非骨架）

| 能力域 | 落地物 | 状态 |
|--------|--------|:---:|
| **规范文本** | **19 条 standards**（01~19，含设计规约 19）+ 团队规范 + 社区最佳实践（阿里黄山版）| ✅ |
| **Java 检查工具 J1~J7** | ArchUnit(J1 分层) + Checkstyle(J2 命名/Javadoc) + PMD(J3) + P3C 阿里黄山版(J6 54条) + SpotBugs(J4) + Spotless(J5) + **Knife4j/OpenAPI3(J7 在线文档)** | ✅ |
| **确定性执行器 be-rules** | `lib/be-rules.js`（**B1~B12**：缺@PreAuthorize/SELECT星号/注入/缺@Transactional/目录密度/裸异常/**上帝类/长方法/高复杂度/缺Javadoc**）| ✅ |
| **代码模板** | 8 个标准骨架（Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml）— **OpenAPI 3 注解** + 完整 Javadoc | ✅ |
| **在线接口文档** | Knife4j 4.4.0 + OpenAPI 3，启动 `/doc.html` **按模块分组**中文界面 | ✅ |
| **CLI** | `init` / `validate`（接 be-rules）/ `doctor`（工具链体检）| ✅ |
| **MCP 工具** | 3 个（wls_be_validate / wls_be_standards / wls_be_templates）— AI 对话内确定性调用 | ✅ |
| **Skills** | **10 个（6 落地 + 4 骨架）**，全配 USAGE.md | ✅/🟡 |
| **codegen 闭环** | api.md → ②~⑦（8阶段不跳级）→ validate → 审计 → 修复强制复扫（详见 `guides/codegen-workflow.md`）| ✅ |
| **提交规范** | 18-git-commit + commitlint + commit-msg hook | ✅ |
| **多编辑器** | Copilot / Cursor / VS Code / Kiro / Claude Code / Agents 六端 MCP 配置 | ✅ |
| **自检闭环** | verify-version + lint-skills + 13 测试 + prepublishOnly | ✅ |

---

## 架构总览

### 三层职责分离

```
L0 自检层 scripts/   → 校验 bd 自己（版本/计数/Skill完整性/规则覆盖矩阵/编辑器配置）
L1 执行器层 lib/     → be-rules.js（B1~B12 确定性规则，供 CLI/MCP 调用）
L2 产出层 files/     → 复制进目标 Java 工程，含：
    ├── standards/       19 条人读规范（源，含设计规约 19）
    ├── java-quality/    J1~J7 机器规则集（ArchUnit/Checkstyle/PMD/P3C/SpotBugs/Spotless/Knife4j）
    ├── templates/       8 个 Java 代码模板（codegen 标准答案，OpenAPI 3 + Javadoc）
    ├── skills/          10 个 AI Skill（全配 USAGE.md）
    └── git-hooks/       commit-msg hook（强制提交规范）
```

### 防"意大利面条代码"四层保障

```
① 生成阶段：codegen 读 templates 填空（标准答案，非自由发挥）
   ↓
② 生成后即时自检：wl-skills-bd validate（B1~B12，含上帝类/长方法/复杂度/Javadoc）
   ↓
③ CI 门禁：J1~J7（Checkstyle + PMD + P3C + SpotBugs + ArchUnit + Spotless + Knife4j）build failure
   ↓
④ 修复闭环：code-fix-be 强制复扫（改完必须验证，不可跳过）
   ↓
✅ 提交：commit-msg hook 强制 18-git-commit 格式
```

每一环都有机器兜底。团队规范 + 阿里黄山版 + Spring/Effective Java/OWASP 官方最佳实践。

### 后端工作流（Pipeline，详见 `guides/codegen-workflow.md`）

```text
api.md（前端 wl-skills-kit 契约，唯一权威输入）
   ↓
② api-design-be       接口设计审查 + 落权限码
   ↓
③ entity-codegen      Entity / DTO / VO（5 文件，读模板填空）
   ↓
④ service-codegen     Controller + Service（CRUD + 状态变更四段式）
   ↓
⑤ mapper-xml-gen      Mapper.java + XML（动态条件/分页/批量）
   ↓
⑥ db-migration        DDL + 回滚（🔴 人工确认才执行）
   ↓
⑦ unit-test-gen       单测 + 集成测试
   ↓
⑧ convention-audit-be 全量审计（19 条 + B1~B12 + J1~J7）
   ↓
⑨ code-fix-be         修复 → ★强制复扫
   ↓
✅ 可提交
```

> **一个标准菜单 = 14 文件**（5 entity + 2 service + 2 mapper + 3 db + 2 test）。无 api.md 不生成。

---

## 目录结构

```
wl-skills-bd/
├── README.md                                ← 你正在看
├── CHANGELOG.md                             版本变更
├── package.json                             name: @agile-team/wl-skills-bd
├── commitlint.config.js                     提交规范强制
├── .mcp.json                                MCP 接入配置
│
├── bin/                                     CLI 入口
│   └── wl-skills-bd.js                      init / validate / doctor
│
├── lib/                                     ★ L1 执行器层
│   └── be-rules.js                          B1~B12 确定性规则引擎
│
├── mcp/                                     ★ MCP 工具层（AI 对话内调用）
│   ├── server.js                            JSON-RPC over stdio
│   ├── registry.js                          3 工具注册中心
│   └── tools/beRulesTools.js
│
├── scripts/                                 L0 自检层
│   ├── verify-version.js                    版本 + 计数 + 编辑器配置一致性
│   └── lint-skills.js                       SKILL/USAGE 完整性 + 规则覆盖矩阵
│
├── tests/                                   回归测试（13 用例）
│
├── files/                                   ★★★ 打包并复制到业务项目 ★★★
│   ├── .github/
│   │   ├── copilot-instructions.md          AI 主入口
│   │   ├── standards/                       19 条后端规范 + index.md
│   │   ├── java-quality/                    ★ J1~J7 工具规则集
│   │   │   ├── archunit/                    J1 架构分层
│   │   │   ├── checkstyle/                  J2 命名/Javadoc
│   │   │   ├── pmd/                         J3 + J6 阿里 P3C（54条）
│   │   │   ├── spotbugs/                    J4 字节码
│   │   │   ├── spotless/                    J5 格式
│   │   │   ├── knife4j/                     ★ J7 在线文档（按模块分组 yml）
│   │   │   └── maven-snippets/              一键接入 pom 片段
│   │   ├── templates/                       8 个 Java 模板（OpenAPI 3 + Javadoc）
│   │   ├── skills/                          10 个 Skill（全配 USAGE.md）
│   │   ├── git-hooks/                       commit-msg hook
│   │   ├── guides/                          人读指南（codegen-workflow 权威闭环）
│   │   └── reports/                         AI 生成报告
│   ├── .cursor/.vscode/.kiro/               三编辑器 MCP 配置
│   ├── CLAUDE.md / AGENTS.md                Claude Code / Agents 入口
│
└── kit-internal/                            ★★ 仅仓库可见，不发布 ★★
    ├── architecture.md                      ADR 架构决策
    └── rule-coverage.md                     规则覆盖矩阵（阻断项必须有执行器）
```

---

## 技术栈基线（与团队对齐）

| 类别       | 团队基线                              | 备注                            |
| ---------- | ------------------------------------ | ------------------------------- |
| JDK        | 1.8                                  | 含 `maven.compiler.source = 8`  |
| 框架       | Spring Boot + **jh4j-cloud 3.x**     | 集团自研脚手架（含 starter 集） |
| ORM        | **MyBatis-Plus**（`JhBaseMapper<T>`）+ 原生 XML | 不是原生 MyBatis        |
| 数据库     | **主流业务 → MySQL**；**主数据类 → Oracle** | AI 须先确认目标数据库类型        |
| 分页       | `JhPage`                             | 不是 PageRequest                |
| 返回包装   | `ApiResult.success(msg, data)`       | 不是 Results.success            |
| 权限       | `@PreAuthorize("@pms.hasPermission(x)")` | Spring Security              |
| **接口文档** | **Knife4j 4.4.0 + OpenAPI 3**      | **取代 Springfox 2（已停更）** |
| Java 检查  | **J1~J7**（ArchUnit/Checkstyle/PMD/**P3C 黄山版**/SpotBugs/Spotless/Knife4j）| 社区最佳实践兜底 |
| 单测       | JUnit 5 + Mockito + AssertJ          | 计划补 testcontainers           |

---

## 10 个 Skill 路由速查（全配 USAGE.md）

| Skill                   | 状态     | 路径                                                | 触发词                                                                                            |
| ----------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `entity-codegen`        | ✅ 落地  | `skills/core/entity-codegen/`                       | 生成实体 / Entity / DTO / VO / 数据模型                                                           |
| `service-codegen`       | ✅ 落地  | `skills/core/service-codegen/`                      | 生成服务 / Controller / Service / 写后端                                                          |
| `mapper-xml-gen`        | ✅ 落地  | `skills/core/mapper-xml-gen/`                       | Mapper XML / SQL / 动态查询 / 分页 SQL                                                            |
| `convention-audit-be`   | ✅ 落地  | `skills/core/convention-audit-be/`                  | 后端审计 / 代码体检 / 复扫验证                                                                    |
| `code-fix-be`           | ✅ 落地  | `skills/ops/code-fix-be/`                           | 修复后端偏差 / 按审计报告整改                                                                     |
| `standard-env-config-be` | ✅ 落地  | `skills/ops/standard-env-config-be/`                | 后端环境标准化 / 切华新 / K8s 部署清单                                                            |
| `api-design-be`         | 🟡 骨架  | `skills/core/api-design-be/`                        | 接口设计 / 评审 api.md / RESTful 校验                                                             |
| `business-doc-extract-be` | 🟡 骨架 | `skills/core/business-doc-extract-be/`             | 后端业务沉淀 / 阅读旧代码生成业务说明                                                             |
| `db-migration`          | 🟡 骨架  | `skills/data/db-migration/`                         | DDL / 建表 / 改表 / 迁移脚本 / 回滚脚本                                                           |
| `unit-test-gen`         | 🟡 骨架  | `skills/test/unit-test-gen/`                        | 单元测试 / 集成测试 / 接口测试                                                                    |

> **✅ 落地**：含完整执行步骤、边界用例、USAGE.md、生成后自检。**🟡 骨架**：含 USAGE.md（典型场景+FAQ），触发时按官方/社区最佳实践 + standards 落地。

---

## Java 检查工具链 J1~J7（对标前端 ESLint）

前端只有 ESLint；Java 后端用 7 个官方/社区工具各司其职：

| 工具 | 编号 | 对应 standards | 接入 |
|------|:---:|----------------|------|
| **ArchUnit** | J1 | 02 跨层禁止 | `mvn test` |
| **Checkstyle** | J2 | 03 命名 / 15 Javadoc | `mvn checkstyle:check` |
| **PMD** | J3 | 16 性能 / 17 防护 | `mvn pmd:check` |
| **P3C 阿里黄山版** | J6 | 19 设计 + 03/15/16/17 全量 | `mvn pmd:check`（p3c-pmd:2.1.1）|
| **SpotBugs** | J4 | 17 防护 | `mvn spotbugs:check` |
| **Spotless** | J5 | 15 格式 | `mvn spotless:check` |
| **Knife4j** | J7 | 13 接口文档 | 启动访问 `/doc.html` |

一键接入见 `files/.github/java-quality/maven-snippets/pom-plugins.xml`。

---

## MCP 工具（3 个，AI 对话内调用）

| 工具 | 作用 |
|------|------|
| `wls_be_validate` | 扫描 Java 工程输出 B1~B12 偏差（error/warn） |
| `wls_be_standards` | 查询 19 条规范清单或指定条款全文 |
| `wls_be_templates` | 查 8 个 Java 代码模板（codegen 对齐用） |

---

## 接入方式

```bash
cd my-spring-boot-service
npx @agile-team/wl-skills-bd init --dry-run        # 先预览安装内容
npx @agile-team/wl-skills-bd init                  # 实际安装
npx @agile-team/wl-skills-bd validate              # ★ 校验现有代码（B1~B12）
npx @agile-team/wl-skills-bd doctor                # 体检工具链接入
```

接入后：
1. `git add .github .cursor .vscode .kiro CLAUDE.md AGENTS.md`（纳入版本控制）
2. 按 `.github/java-quality/maven-snippets/README.md` 接入 Maven 插件 J1~J7
3. 在 AI 编辑器确认 MCP 已发现（`.cursor/mcp.json` 等）
4. `mvn clean verify` 验证 Checkstyle + ArchUnit + PMD/P3C + SpotBugs 全过
5. 启动后访问 `/doc.html`（按模块分组的在线接口文档）

---

## 多编辑器适配（六端）

init 后自动释放各编辑器配置，自动发现 MCP server：

| 编辑器 | 配置文件 |
|--------|---------|
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cursor | `.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` |
| Kiro | `.kiro/settings/mcp.json` |
| Claude Code | `CLAUDE.md` |
| 通用 Agents | `AGENTS.md` |

---

## 方法论原则（重要）

> 规范遵循优先级：**官方/社区最佳实践 > 团队 standards > 存量代码**。
>
> - 官方/社区：Spring/MyBatis-Plus 官方 + 阿里黄山版 + Effective Java + Clean Code + OWASP
> - **不**对齐任何存量项目代码；存量偏离（如硬编码租户、SQL 注入、上帝类）作为待整改项而非基准

---

## 共建说明

- 维护者：CHENY（工号 409322，与 kit / ui 一致）
- 内部参考：[`kit-internal/architecture.md`](kit-internal/architecture.md) — 三层架构 ADR
- 内部参考：[`kit-internal/rule-coverage.md`](kit-internal/rule-coverage.md) — 规则覆盖矩阵
- 闭环文档：[`files/.github/guides/codegen-workflow.md`](files/.github/guides/codegen-workflow.md) — 生成/验证/修复三闭环

---

## 链接

- 前端伴生包：[`wl-skills-kit`](../wl-skills-kit/README.md)
- 前端 UI 风格包：[`wl-skills-ui`](../wl-skills-ui/README.md)
- npm：https://www.npmjs.com/package/@agile-team/wl-skills-bd
