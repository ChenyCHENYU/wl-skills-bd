# @agile-team/wl-skills-bd

> **企业级后端 AI Skills 模板包** — 让 Spring Boot + MyBatis(-Plus) + jh4j-cloud 体系的后端业务工程获得一致的分层规范、可被 AI 精确识别和生成的代码骨架，以及确定性检查闭环（CLI + MCP + Java 工具链）。

[![Status](https://img.shields.io/badge/status-v0.5.1-blue.svg)]()
[![npm](https://img.shields.io/badge/npm-0.4.0-red.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)]()
[![JDK](https://img.shields.io/badge/JDK-8%2B-blue.svg)]()

---

## TL;DR

```bash
# 已发布 npm，一键接入后端工程
npx @agile-team/wl-skills-bd init           # 释放规范+Skills+Java工具规则集+模板
npx @agile-team/wl-skills-bd validate       # ★ 确定性校验现有 Java 代码（B1~B8）
npx @agile-team/wl-skills-bd doctor         # 工具链接入体检

# 在 AI 对话中：
"基于前端 api.md 生成 Controller + Service + Mapper 三件套"
"扫描 mdm-service 模块给出后端规范审计报告"
"为现有接口生成单测和 IT 测试套件"
"把项目从 172 切到华新，标准化后端环境配置"
```

> **桥接关系**：本包专注后端；与前端 `@agile-team/wl-skills-kit` / `@agile-team/wl-skills-ui` 是 **三包独立、契约对齐** 的关系。三包共同消费 `api.md`，前后端协同写菜单/字典/权限。

---

## 这是什么？

一套面向 **集团 Spring Boot 后端体系** 的 "**规范 + Skill + Java 检查工具 + 模板 + MCP + CLI + Pipeline**" 全栈式 AI 工作流模板包，与前端 `wl-skills-kit` 镜像对称。

它要解决的问题：

> 后端是 AI 工作流里"看不见的下半段"：接口契约出来后，谁来按规范生成 Controller/Service/Mapper？谁来管 DDL 与回滚？谁来扫历史模块的分层违规？谁来保证生成的代码不跑偏成"意大利面条"？
>
> 后端如果没有同等程度的规范化 + 确定性检查 + 代码模板物化，整个全栈 AI 工作流就只有"半边"，且生成的代码无法保证符合团队规范。
>
> 本包就是补齐这半边——**让 AI 生成的 Java 代码既符合团队规范，又可被机器检查兜底**。

### 与 wl-skills-kit / wl-skills-ui 的职责切分

| 包                  | 职责                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `wl-skills-kit`     | 前端规范 + Skills（页面生成 / 审计 / 菜单字典权限同步），消费 `api.md`                        |
| `wl-skills-ui`      | 前端视觉一致性 / 设计令牌 / 化妆层 / Runtime 渲染                                             |
| **`wl-skills-bd`**  | **后端规范 + Skills（接口设计 / 代码生成 / DDL / 单测 / 后端审计）+ Java 检查工具链（Checkstyle/PMD/SpotBugs/ArchUnit/Spotless）+ MCP + CLI，消费同一份 `api.md`** |

---

## v0.5.0 能力总览（已落地，非骨架）

| 能力域 | 落地物 | 状态 |
|--------|--------|:---:|
| **规范文本** | 18 条 standards（01~18，全覆盖分层/命名/Controller/Service/Mapper/Entity/异常/日志/事务/安全/DDL/Swagger/测试/质量/性能/漏洞/提交） | ✅ |
| **Java 检查工具** | ArchUnit(J1 架构分层) + Checkstyle(J2 命名风格) + PMD(J3 静态分析) + SpotBugs(J4 字节码) + Spotless(J5 格式) | ✅ |
| **确定性执行器** | `lib/be-rules.js`（B1~B8 正则规则：缺@PreAuthorize/SELECT星号/美元符注入/缺@Transactional/目录密度/裸异常等） | ✅ |
| **代码模板** | 8 个标准骨架（Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml）— codegen 读模板填空 | ✅ |
| **CLI** | `init` / `validate`（接 be-rules）/ `doctor`（工具链体检） | ✅ |
| **MCP 工具** | 3 个（wls_be_validate / wls_be_standards / wls_be_templates）— AI 对话内确定性调用 | ✅ |
| **Skills** | 10 个（3 个 codegen 已落地 + USAGE.md，audit/fix 含复扫闭环） | ✅/🟡 |
| **复扫闭环** | convention-audit-be `--quick` + code-fix-be 强制复扫 | ✅ |
| **提交规范** | 18-git-commit 标准 + commitlint + commit-msg hook | ✅ |
| **多编辑器** | Copilot / Cursor / VS Code / Kiro / Claude Code / Agents 六端 MCP 配置 | ✅ |
| **自检闭环** | verify-version + lint-skills + tests + prepublishOnly | ✅ |

---

## 架构总览

### 三层职责分离

```
L0 自检层 scripts/   → 校验 bd 自己（版本/计数/Skill完整性/规则覆盖矩阵/编辑器配置）
L1 执行器层 lib/     → be-rules.js（B1~B8 确定性规则，供 CLI/MCP 调用）
L2 产出层 files/     → 复制进目标 Java 工程，含：
    ├── standards/       18 条人读规范（源）
    ├── java-quality/    Checkstyle/PMD/SpotBugs/ArchUnit/Spotless 机器规则集（物化 standards）
    ├── templates/       8 个 Java 代码模板（codegen 标准答案）
    ├── skills/          10 个 AI Skill（消费 standards + 指引工具接入）
    └── git-hooks/       commit-msg hook（强制提交规范）
```

### 防"意大利面条代码"三层保障

```
生成阶段：codegen 读 templates 填空（标准答案，非自由发挥）
   ↓
生成后：wl-skills-bd validate / wls_be_validate（B1~B8 确定性检查）
   ↓
CI 门禁：Checkstyle + PMD + SpotBugs + ArchUnit（J1~J5 build failure）
   ↓
修复闭环：code-fix-be 强制复扫（改完必须验证）
   ↓
提交：commit-msg hook 强制 18-git-commit 格式
```

每一环都有机器兜底，团队规范没有的遵循官方/社区最佳实践。

### 后端工作流（Pipeline）

```text
① 前端 api.md（接口契约，wl-skills-kit 产出）
          ↓
② api-design-be       接口设计审查（RESTful 命名、字段映射、错误码）
          ↓
③ entity-codegen      Entity / DTO / VO / PageDTO / PageVO（读模板填空）
          ↓
④ service-codegen     Controller + Service（CRUD + 状态变更四段式）
          ↓
⑤ mapper-xml-gen      Mapper 接口 + XML（动态条件 / 分页 / 批量）
          ↓
⑥ db-migration        DDL + 回滚脚本（写库前强制人工确认）
          ↓
⑦ unit-test-gen       单元测试 + 集成测试
          ↓
⑧ convention-audit-be 后端规范审计（分层 / 命名 / 异常 / 事务 / 日志）
          ↓
⑨ code-fix-be         可选自动修复 → ★ 强制复扫确认
          ↓
⑩ 输出：可部署服务 + 测试套件 + DDL 脚本 + 审计报告
```

每个 Skill 都可独立触发也可链式串联，详见 [`files/.github/skills/_pipeline.md`](files/.github/skills/_pipeline.md)。

---

## 目录结构

```
wl-skills-bd/
├── README.md                                ← 你正在看
├── CHANGELOG.md                             版本变更
├── package.json                             name: @agile-team/wl-skills-bd
│
├── bin/
│   └── wl-skills-bd.js                      CLI 入口（init / validate / doctor / help / version）
│
├── lib/                                     ★ L1 执行器层
│   └── be-rules.js                          B1~B8 确定性规则引擎（validate/MCP 调用）
│
├── mcp/                                     ★ MCP 工具层（AI 对话内调用）
│   ├── server.js                            JSON-RPC over stdio
│   ├── registry.js                          工具注册中心（3 工具）
│   ├── schema-validator.js                  入参校验
│   └── tools/beRulesTools.js                包装 be-rules
│
├── scripts/                                 ★ L0 自检层
│   ├── verify-version.js                    版本 + 计数 + 编辑器配置一致性
│   └── lint-skills.js                       SKILL/USAGE 完整性 + 规则覆盖矩阵
│
├── tests/                                   回归测试
│   ├── be-rules.test.js
│   ├── verify-version.test.js
│   └── mcp-registry.test.js
│
├── commitlint.config.js                     提交规范强制
│
├── .mcp.json                                MCP 接入配置
│
├── files/                                   ★★★ 真正会被打包并复制到业务项目的内容 ★★★
│   ├── .github/
│   │   ├── copilot-instructions.md          AI 主入口（多编辑器适配源）
│   │   ├── standards/                       18 条后端规范 + 任务门控 index.md
│   │   │   ├── index.md
│   │   │   ├── 01~17-*.md                   工具链/结构/命名/Controller/Service/Mapper/Entity/异常/日志/事务/安全/DDL/Swagger/测试/质量/性能/漏洞
│   │   │   └── 18-git-commit.md             Git 提交规范
│   │   ├── java-quality/                    ★ Java 检查工具规则集（物化 standards）
│   │   │   ├── archunit/                    J1 架构分层（LayerRulesTest.java + README）
│   │   │   ├── checkstyle/                  J2 命名风格（checkstyle.xml + README）
│   │   │   ├── pmd/                         J3 静态分析（pmd-ruleset.xml + README）
│   │   │   ├── spotbugs/                    J4 字节码（spotbugs-exclude.xml + README）
│   │   │   ├── spotless/                    J5 格式统一（README）
│   │   │   └── maven-snippets/              一键接入 pom 片段
│   │   ├── templates/                       ★ 8 个 Java 代码模板（codegen 标准答案）
│   │   │   ├── Entity/DTO/PageDTO/VO.java.tmpl
│   │   │   ├── Controller/Service.java.tmpl
│   │   │   └── Mapper.java/Mapper.xml.tmpl
│   │   ├── skills/                          10 个 Skill
│   │   │   ├── _registry.md                 触发词 → SKILL 路径单一数据源
│   │   │   ├── _pipeline.md                 Skill I/O 契约 + next_suggest
│   │   │   ├── _best-practices.md           场景索引
│   │   │   ├── core/                        entity-codegen ✅ + service-codegen ✅ + mapper-xml-gen ✅ + USAGE.md
│   │   │   ├── data/                        db-migration
│   │   │   ├── test/                        unit-test-gen
│   │   │   └── ops/                         code-fix-be ✅ + standard-env-config-be ✅
│   │   ├── git-hooks/                       commit-msg hook（强制提交规范）
│   │   ├── guides/                          人读指南
│   │   └── reports/                         AI 生成报告
│   ├── .cursor/mcp.json                     Cursor 编辑器 MCP 配置
│   ├── .vscode/mcp.json                     VS Code 编辑器 MCP 配置
│   ├── .kiro/settings/mcp.json              Kiro 编辑器 MCP 配置
│   ├── CLAUDE.md                            Claude Code 入口
│   └── AGENTS.md                            通用 Agents 入口
│
└── kit-internal/                            ★★ 仅仓库可见，不安装到业务项目 ★★
    ├── architecture.md                      ADR 架构决策记录
    ├── rule-coverage.md                     规则覆盖矩阵（阻断项必须有执行器兜底）
    └── CONTRIBUTING.md
```

---

## 技术栈基线（与团队对齐）

| 类别       | 团队基线（来自 mdm-service）                              | 备注                            |
| ---------- | -------------------------------------------------------- | ------------------------------- |
| JDK        | 1.8                                                      | 含 `maven.compiler.source = 8`  |
| 框架       | Spring Boot + **jh4j-cloud 3.x**                         | 集团自研脚手架（含 starter 集） |
| ORM        | **MyBatis-Plus**（继承 `JhBaseMapper<T>`）+ 原生 XML     | 不是原生 MyBatis                |
| 数据库     | **主流业务 → MySQL**；**主数据类 → Oracle**              | AI 须先确认目标数据库类型        |
| 分页       | `JhPage`（jh4j-cloud 提供）                              | 不是 PageRequest                |
| 返回包装   | `ApiResult.success(msg, data)`                           | 不是 Results.success            |
| 权限       | Spring Security + `@PreAuthorize("@pms.hasPermission(x)")` | 不是 Choerodon @Permission      |
| 校验       | hibernate-validator 6.0 + `@Validated`                   |                                 |
| 工具库     | Hutool 5.x、Apache Commons、FastJSON 2.0、Lombok         |                                 |
| 日志       | SLF4J + Log4j2                                           |                                 |
| API 文档   | Springfox Swagger                                        |                                 |
| Java 检查  | **Checkstyle + PMD + SpotBugs + ArchUnit + Spotless**    | J1~J5 全覆盖                    |
| 单测       | JUnit 5 + Mockito（计划补 testcontainers）               |                                 |

---

## 10 个 Skill 路由速查

| Skill                   | 状态     | 路径                                                | 触发词                                                                                            |
| ----------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `entity-codegen`        | ✅ 落地  | `skills/core/entity-codegen/SKILL.md`               | 生成实体 / Entity / DTO / VO / 数据模型                                                           |
| `service-codegen`       | ✅ 落地  | `skills/core/service-codegen/SKILL.md`              | 生成服务 / Controller / Service / 写后端 / 后端代码生成                                           |
| `mapper-xml-gen`        | ✅ 落地  | `skills/core/mapper-xml-gen/SKILL.md`               | Mapper XML / SQL / 动态查询 / 分页 SQL                                                            |
| `convention-audit-be`   | ✅ 落地  | `skills/core/convention-audit-be/SKILL.md`          | 后端审计 / 后端规范检查 / 分层违规 / 后端体检 / 复扫验证                                          |
| `code-fix-be`           | ✅ 落地  | `skills/ops/code-fix-be/SKILL.md`                   | 修复后端偏差 / 后端 code fix / 按审计报告整改                                                     |
| `standard-env-config-be` | ✅ 落地  | `skills/ops/standard-env-config-be/SKILL.md`        | 后端环境标准化 / 切华新 / K8s 部署清单对齐                                                        |
| `api-design-be`         | 🟡 骨架  | `skills/core/api-design-be/SKILL.md`                | 接口设计 / 接口审查 / RESTful 校验                                                                |
| `business-doc-extract-be` | 🟡 骨架 | `skills/core/business-doc-extract-be/SKILL.md`     | 后端业务沉淀 / 阅读旧代码生成业务说明                                                             |
| `db-migration`          | 🟡 骨架  | `skills/data/db-migration/SKILL.md`                 | DDL / 建表 / 改表 / 迁移脚本 / 回滚脚本                                                           |
| `unit-test-gen`         | 🟡 骨架  | `skills/test/unit-test-gen/SKILL.md`                | 单元测试 / 集成测试 / 接口测试                                                                    |

> **✅ 落地**：含完整执行步骤、边界用例、正反例、USAGE.md、生成后自检。**🟡 骨架**：frontmatter + 流程纲要，触发时按 SKILL.md 指引 + templates 倒推。

---

## Java 检查工具链（J1~J5，对标前端 ESLint）

前端只有 ESLint 一个标准；Java 后端有 5 个官方/社区工具各司其职：

| 工具 | 编号 | 对应 standards | 接入 |
|------|:---:|----------------|------|
| **ArchUnit** | J1 | 02 跨层禁止 | 架构分层测试，CI `mvn test` 卡控 |
| **Checkstyle** | J2 | 03 命名 / 15 质量 | `mvn checkstyle:check` |
| **PMD** | J3 | 16 性能 / 17 防护 | `mvn pmd:check` |
| **SpotBugs** | J4 | 17 防护 | `mvn spotbugs:check` |
| **Spotless** | J5 | 15 格式 | `mvn spotless:check` |

一键接入见 `files/.github/java-quality/maven-snippets/pom-plugins.xml`。

---

## MCP 工具（3 个，AI 对话内调用）

接入 `.mcp.json` 后，AI 可直接调用：

| 工具 | 作用 |
|------|------|
| `wls_be_validate` | 扫描 Java 工程输出 B1~B8 偏差（error/warn） |
| `wls_be_standards` | 查询 18 条规范清单或指定条款全文 |
| `wls_be_templates` | 查 8 个 Java 代码模板（codegen 对齐用） |

---

## 接入方式

```bash
cd my-spring-boot-service
npx @agile-team/wl-skills-bd init --dry-run        # 先预览安装内容
npx @agile-team/wl-skills-bd init                  # 实际安装
npx @agile-team/wl-skills-bd validate              # ★ 校验现有代码（B1~B8）
npx @agile-team/wl-skills-bd doctor                # 体检工具链接入
```

接入后：
1. `git add .github .cursor .vscode .kiro CLAUDE.md AGENTS.md`（纳入版本控制）
2. 按 `.github/java-quality/maven-snippets/README.md` 接入 Maven 插件
3. 在 AI 编辑器中确认 MCP 已发现（`.cursor/mcp.json` 等）
4. `mvn clean verify` 验证 Checkstyle + ArchUnit 全过

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

## 与前端 wl-skills-kit 的衔接点

| 衔接点                | 说明                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `api.md`              | **前后端共消费的核心契约**。前端产出，后端做契约审查与代码生成。 |
| `docs/business/`      | 前端的业务理解文档，后端 `api-design-be` 复用为业务背景。 |
| 审计报告              | 前后端各自产出 `AUDIT_*.md`，统一由测试 Agent 消费。 |
| `SYS_PERMISSION_INFO` | 后端权限码是这个文件的真实数据来源。 |

> **写后端高风险动作**（DDL / 写菜单 / 写字典 / 写权限）一律 **要求人工确认 diff 后才执行**，与 kit 一致。

---

## 路线图（L1 → L7，与 kit 对齐镜像）

| 等级 | 能力               | 当前状态           |
| ---- | ------------------ | ------------------ |
| L1   | 提示词工程         | ✅ 18 standards 落地 |
| L2   | Skills             | ✅ 6 落地 / 🟡 4 骨架 |
| L3   | MCP Tools          | ✅ 3 工具           |
| L4   | CLI                | ✅ init/validate/doctor |
| L5   | Agent Pipeline     | 🟡 Pipeline 契约已定，链式串联待实战验证 |
| L6   | Multi-Agent + 工作台 | 🔭 与 kit 共享上层调度 |
| L7   | 自演化             | 🔭                |

> **当前目标**：6 个落地 Skill 已覆盖 codegen + audit + fix + env 核心链路；剩余 4 个骨架（api-design/business-doc/db-migration/unit-test）逐个补厚。

---

## 共建说明

- 维护者：CHENY（工号 409322，与 kit / ui 一致）
- 当前阶段：核心链路已落地，欢迎团队按 `kit-internal/CONTRIBUTING.md` 提交领域案例、补厚骨架 Skill
- 内部参考：[`kit-internal/architecture.md`](kit-internal/architecture.md) — 三层架构 ADR + 规则覆盖矩阵
- 内部参考：[`kit-internal/rule-coverage.md`](kit-internal/rule-coverage.md) — 每条阻断约定的执行器兜底矩阵
- 外部参考（不集成）：Checkstyle/PMD/SpotBugs/ArchUnit/Spotless 官方文档

---

## 链接

- 前端伴生包：[`wl-skills-kit`](../wl-skills-kit/README.md)
- 前端 UI 风格包：[`wl-skills-ui`](../wl-skills-ui/README.md)
- 后端基线项目：[`mdm-service`](../mdm-service/README.md)
- 演进文档：[`wl-skills-kit/AI工作流演进与多智能体协作交流文档.md`](../wl-skills-kit/AI工作流演进与多智能体协作交流文档.md)
- npm：https://www.npmjs.com/package/@agile-team/wl-skills-bd
