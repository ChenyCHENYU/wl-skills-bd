# @agile-team/wl-skills-bd

> **企业级后端 AI Skills 模板包** — 让 Spring Boot + MyBatis(-Plus) + jh4j-cloud 体系的后端业务工程获得一致的分层规范、可被 AI 精确识别和生成的代码骨架，以及可演进的 Agent Pipeline。

[![Status](https://img.shields.io/badge/status-skeleton%20v0.3.1-orange.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)]()
[![JDK](https://img.shields.io/badge/JDK-8%2B-blue.svg)]()

---

## TL;DR

```bash
# 当前为骨架阶段，未发布 npm。先以本仓库源码方式接入。
# 计划发布后：
npx @agile-team/wl-skills-bd init           # 在后端业务工程根目录运行
# 在 AI 对话中：
"基于前端 api.md 生成 Controller + Service + Mapper 三件套"
"扫描 hx_test 分支的 mdm-service 模块给出后端规范审计报告"
"为现有接口生成单测和 IT 测试套件"
"把项目从 172 切到华新，标准化后端环境配置"
```

> **桥接关系**：本包专注后端；与前端 `@agile-team/wl-skills-kit` / `@agile-team/wl-skills-ui` 是 **三包独立、契约对齐** 的关系。三包共同消费 `api.md`，前后端协同写菜单/字典/权限。

---

## 这是什么？

一套面向 **集团 Spring Boot 后端体系** 的 "**规范 + Skill + MCP + CLI + Pipeline**" 全栈式 AI 工作流模板包，与前端 `wl-skills-kit` 镜像对称。

它要解决的问题：

> 我们已经有了前端 Pipeline（`prototype-scan → api-contract → page-codegen → audit → sync`），但后端是流程里"看不见的下半段"：接口契约出来后，谁来按规范生成 Controller/Service/Mapper？谁来管 DDL 与回滚？谁来扫历史模块的分层违规？  
> 后端如果没有同等程度的规范化 + Skill 化，整个全栈 AI 工作流就只有"半边"。  
> 本包就是补齐这半边。

### 与 wl-skills-kit / wl-skills-ui 的职责切分

| 包                  | 职责                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `wl-skills-kit`     | 前端规范 + Skills（页面生成 / 审计 / 菜单字典权限同步），消费 `api.md`                        |
| `wl-skills-ui`      | 前端视觉一致性 / 设计令牌 / 化妆层 / Runtime 渲染                                             |
| **`wl-skills-bd`**  | **后端规范 + Skills（接口设计 / 服务代码生成 / DDL / 单测 / 后端审计），消费同一份 `api.md`** |

---

## 架构总览

### 五层模型（与前端镜像对齐）

```
┌─────────────────────────────────────────────────────────────────┐
│  L0  契约层 (api.md)              前端 wl-skills-kit 已产出       │
│      → 前后端共同消费的"宪法"                                       │
├─────────────────────────────────────────────────────────────────┤
│  L1  接口设计层 (api-design-be)   RESTful 路径 / DTO 字段映射     │
│      → 接口确认单 + 字段映射表                                      │
├─────────────────────────────────────────────────────────────────┤
│  L2  代码骨架层 (codegen-be)      Controller / Service / Mapper   │
│      → 一接口一组件、一组件一 SKILL                                  │
├─────────────────────────────────────────────────────────────────┤
│  L3  数据层 (db-migration)        Entity / DDL / 回滚脚本          │
│      → 含 TENANT_ID / 序列 / 触发器（Oracle）的建表规范             │
├─────────────────────────────────────────────────────────────────┤
│  L4  质量层 (test + audit + fix)  单测 / 集成测试 / 审计 / 修复     │
│      → 让"提交前可观测"                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 后端工作流（与 `AI工作流演进与多智能体协作交流文档.md` §5 对齐）

```text
① 前端 api.md（接口契约，wl-skills-kit 产出） / 产品 input-spec
         ↓
② api-design-be       接口设计审查（RESTful 命名、字段映射、错误码）
         ↓
③ entity-codegen      Entity / DTO / VO / Query 类生成
         ↓
④ service-codegen     Controller + Service + ServiceImpl + Mapper 接口
         ↓
⑤ mapper-xml-gen      XML 映射（动态条件 / 分页 / 批量 / 多表 join）
         ↓
⑥ db-migration        DDL + 回滚脚本（**写库前强制人工确认**）
         ↓
⑦ unit-test-gen       单元测试 + 集成测试（基于 api.md 契约 + 边界用例）
         ↓
⑧ convention-audit-be 后端规范审计（分层 / 命名 / 异常 / 事务 / 日志）
         ↓
⑨ code-fix-be         可选自动修复 → 复扫确认
         ↓
⑩ 输出：可部署服务 + 测试套件 + DDL 脚本 + 审计报告
```

每个 Skill 都可独立触发也可链式串联，详见 [`files/.github/skills/_pipeline.md`](files/.github/skills/_pipeline.md)。

---

## 目录结构

```
wl-skills-bd/
├── README.md                                ← 你正在看
├── CHANGELOG.md
├── package.json                             name: @agile-team/wl-skills-bd
│
├── bin/
│   └── wl-skills-bd.js                      CLI 入口（init / update / check / validate / doctor / export）
│
├── files/                                   ★★★ 真正会被打包并复制到业务项目的内容 ★★★
│   └── .github/
│       ├── copilot-instructions.md          AI 主入口（多编辑器适配的"源版本"）
│       ├── standards/                       17 条后端规范 + 任务门控 index.md
│       │   ├── index.md
│       │   ├── 01-toolchain.md              工具链 / Maven / JDK / Lombok 检查
│       │   ├── 02-project-structure.md      包结构 + 分层职责 + 禁止跨层
│       │   ├── 03-naming.md                 类 / 方法 / 字段 / 包 / 常量 / 路径
│       │   ├── 04-controller.md             Controller 模板 + 权限注解 + 返回值
│       │   ├── 05-service.md                Service 接口 + 实现 + 状态变更模板
│       │   ├── 06-mapper-xml.md             禁止 SELECT * + 动态条件 + 分页 + foreach
│       │   ├── 07-entity-dto-vo.md          Entity 审计字段 + DTO 校验 + Query
│       │   ├── 08-exception.md              全局异常 + Assert + 业务码
│       │   ├── 09-logging.md                SLF4J 占位符 + 级别 + 敏感信息
│       │   ├── 10-transaction.md            @Transactional 粒度 + 禁止事项
│       │   ├── 11-security-permission.md    权限注解 + 租户隔离
│       │   ├── 12-database-ddl.md           建表规范 + 索引 + 序列 + 字段命名
│       │   ├── 13-api-doc-swagger.md        @Api / @ApiOperation / @ApiModelProperty
│       │   └── 14-test-coverage.md          单测覆盖红线 + Mock 规范
│       ├── skills/                          10 个核心 Skill
│       │   ├── _registry.md                 ★ 触发词 → SKILL 路径单一数据源
│       │   ├── _pipeline.md                 Skill I/O 契约 + next_suggest
│       │   ├── _best-practices.md           场景索引（弱化关键词命中）
│       │   ├── core/                        核心代码生成与设计
│       │   │   ├── api-design-be/
│       │   │   ├── entity-codegen/
│       │   │   ├── service-codegen/
│       │   │   ├── mapper-xml-gen/
│       │   │   ├── convention-audit-be/
│       │   │   └── business-doc-extract-be/
│       │   ├── data/                        数据库相关（写库高风险）
│       │   │   └── db-migration/
│       │   ├── test/                        测试生成
│       │   │   └── unit-test-gen/
│       │   └── ops/                         运维 / 修复 / 环境标准化
│       │       ├── code-fix-be/
│       │       └── standard-env-config-be/  后端环境标准化（切华新/172/客户）
│       ├── guides/                          人读指南
│       │   ├── usage.md
│       │   └── architecture.md
│       └── reports/                         AI 生成报告（追加不覆盖）
│           ├── API_DESIGN_*.md
│           ├── AUDIT_BE_*.md
│           ├── DDL_PREVIEW_*.md
│           └── SERVICE_CODEGEN_*.md
│
├── kit-internal/                            ★★ 仅仓库可见，不会安装到业务项目 ★★
│   ├── README.md                            维护者首页
│   ├── architecture.md                      ADR / 决策记录
│   └── CONTRIBUTING.md
│
└── docs/
    ├── analysis-report.md                   本次对 ui / kit / mdm-service 的扫描分析报告
    ├── env-standard-analysis.md             后端环境标准化能力需求基线（切华新/172 通用化）
    └── roadmap.md                           演进路线图
```

---

## 技术栈基线（与团队对齐）

| 类别       | 团队基线（来自 mdm-service hx_test）                       | 备注                            |
| ---------- | ---------------------------------------------------------- | ------------------------------- |
| JDK        | 1.8                                                        | 含 `maven.compiler.source = 8`  |
| 框架       | Spring Boot + **jh4j-cloud 3.x**                           | 集团自研脚手架（含 starter 集） |
| ORM        | **MyBatis-Plus**（继承 `JhBaseMapper<T>`）+ 原生 XML       | 不是原生 MyBatis                |
| 数据库     | **主流业务项目 → MySQL**；**mdm-service 等主数据项目 → Oracle**（默认 `${DATASOURCE:oracle}`）；AI 须先确认目标数据库类型 | 业务表必带 `IS_DELETE` 逻辑删除 |
| 分页       | `JhPage`（jh4j-cloud 提供）                                | 不是 PageRequest                |
| 返回包装   | `ApiResult.success(msg, data)`                             | 不是 Results.success            |
| 权限       | Spring Security + `@PreAuthorize("@pms.hasPermission(x)")` | 不是 Choerodon @Permission      |
| 校验       | hibernate-validator 6.0 + `@Validated`                     |                                 |
| 工具库     | Hutool 5.x、Apache Commons、FastJSON 2.0、Lombok           |                                 |
| 日志       | SLF4J + Logback                                            |                                 |
| API 文档   | Springfox Swagger                                          |                                 |
| 服务发现   | 通过 jh4j-cloud-starter（Nacos/Eureka 视项目）             |                                 |
| 单测       | JUnit 5 + Mockito（计划补 testcontainers）                 | 14-test-coverage 待落地         |

> **共性参考**：`CLAUDE规范文档/后端`（HZERO + 原生 MyBatis + Oracle）。我们只抽其 **共性最佳实践**（分层 / 注释 / 异常 / 日志 / Mapper XML 规则），框架细节按团队基线落地。详见 [`docs/analysis-report.md`](docs/analysis-report.md)。

---

## 10 个核心 Skill 路由速查

| Skill                   | 状态     | 路径                                                | 触发词                                                                                            |
| ----------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `api-design-be`         | 🟡 骨架  | `skills/core/api-design-be/SKILL.md`                | 接口设计 / 接口审查 / RESTful 校验 / 字段映射 / 错误码                                            |
| `entity-codegen`        | 🟡 骨架  | `skills/core/entity-codegen/SKILL.md`               | 生成实体 / Entity / DTO / VO / Query / 数据模型                                                   |
| `service-codegen`       | 🟡 骨架  | `skills/core/service-codegen/SKILL.md`              | 生成服务 / Controller / Service / 写后端 / 后端代码生成 / 按 api.md 生成                          |
| `mapper-xml-gen`        | 🟡 骨架  | `skills/core/mapper-xml-gen/SKILL.md`               | Mapper XML / SQL / 动态查询 / 分页 SQL / 批量 SQL                                                 |
| `convention-audit-be`   | 🟡 骨架  | `skills/core/convention-audit-be/SKILL.md`          | 后端审计 / 后端规范检查 / 分层违规 / 后端体检 / 接手后端项目                                      |
| `business-doc-extract-be` | 🟡 骨架  | `skills/core/business-doc-extract-be/SKILL.md`      | 后端业务沉淀（与前端 business-doc-extract 互补，重点为接口语义与领域模型）                        |
| `db-migration`          | 🟡 骨架  | `skills/data/db-migration/SKILL.md`                 | DDL / 建表 / 改表 / 加字段 / 迁移脚本 / 回滚脚本                                                  |
| `unit-test-gen`         | 🟡 骨架  | `skills/test/unit-test-gen/SKILL.md`                | 单元测试 / 集成测试 / 接口测试 / 单测生成                                                         |
| `code-fix-be`           | 🟡 骨架  | `skills/ops/code-fix-be/SKILL.md`                   | 修复后端偏差 / 后端 code fix / 按审计报告整改                                                     |
| `standard-env-config-be` | 🟡 骨架  | `skills/ops/standard-env-config-be/SKILL.md`        | 后端环境标准化 / 切华新 / 172 切华新 / 本地启动配不起来 / K8s 部署清单 / 补 pre 环境               |

> **🟡 骨架**：当前 SKILL.md 仅包含 frontmatter + 流程纲要 + Pre-flight 占位，需在后续版本逐步补齐执行细节、Pre-flight 强约束、模板代码。

---

## 与前端 wl-skills-kit 的衔接点

| 衔接点                | 说明                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `api.md`              | **前后端共消费的核心契约**。前端在 `src/views/**/api.md` 产出，后端在此基础上做契约审查与代码生成。 |
| `docs/business/`      | 前端 `business-doc-extract` 产出的业务理解文档，后端 `api-design-be` 复用为业务背景。 |
| 审计报告              | 前后端各自产出 `AUDIT_*.md`，统一由（未来的）测试 Agent 消费。                        |
| `SYS_MENU_INFO.md`    | 前端写菜单基线 → 后端 `menu-sync`（在 kit）/ 后端权限码同步触发整合。                 |
| `SYS_PERMISSION_INFO` | 后端权限码 / Action 列表是这个文件的真实数据来源。                                    |

> **写后端高风险动作**（DDL / 写菜单 / 写字典 / 写权限）一律 **要求人工确认 diff 后才执行**，与 kit 一致。

---

## L1 → L7 路线图（与 kit 对齐镜像）

| 等级 | 能力               | 当前状态           |
| ---- | ------------------ | ------------------ |
| L1   | 提示词工程         | 🟡 占位（待写满）  |
| L2   | Skills             | 🟡 10 个骨架       |
| L3   | MCP Tools          | 🔭 未启动          |
| L4   | CLI                | 🟡 仅占位          |
| L5   | Agent Pipeline     | 🔭 待 L2 落地后启动 |
| L6   | Multi-Agent + 工作台 | 🔭 与 kit 共享上层调度 |
| L7   | 自演化             | 🔭                |

> **当前目标**：先把 L1 + L2 撑起来；**先打通 mdm-service 1 个完整业务模块** 的 ② → ⑨ 全链路（无返工 + AI 不二次补救），作为 L5 启动门槛。

> **环境标准化横切能力**：`standard-env-config-be` 已纳入 ops 类，独立于主线 ②-⑨，与前端 `wl-skills-kit/standard-env-config` 对称。需求基线见 [`docs/env-standard-analysis.md`](docs/env-standard-analysis.md)。

---

## 当前接入方式（骨架阶段）

未发布 npm 时，建议把 `files/.github/` 内容 **手工 / 软链接** 拷贝到目标后端工程根目录：

```bash
# Windows PowerShell（在 wl-skills-bd/ 根目录运行）
xcopy /E /I files\.github <目标工程>\.github
```

然后在 AI 编辑器中按 `_registry.md` 的触发词唤起对应 Skill。

发布 npm 后将提供 `npx @agile-team/wl-skills-bd init` 一键安装。

---

## 共建说明

- 维护者：CHENY（工号 409322，与 kit / ui 一致）
- 当前阶段：**骨架共建**，欢迎团队按 `kit-internal/CONTRIBUTING.md` 提交 Skill 模板、standards 章节、领域案例
- 内部参考：[`docs/analysis-report.md`](docs/analysis-report.md) — 三仓库对比扫描分析报告 + 后端 Skill 工作流详尽建议
- 内部参考：[`docs/env-standard-analysis.md`](docs/env-standard-analysis.md) — 后端环境标准化能力需求基线（切华新/172 通用化分析）
- 外部参考（不集成）：`CLAUDE规范文档/后端`、官方 Spring Boot / MyBatis-Plus 文档

---

## 链接

- 前端伴生包：[`wl-skills-kit`](../wl-skills-kit/README.md)
- 前端 UI 风格包：[`wl-skills-ui`](../wl-skills-ui/README.md)
- 后端基线项目：[`mdm-service`](../mdm-service/README.md)
- 演进文档：[`wl-skills-kit/AI工作流演进与多智能体协作交流文档.md`](../wl-skills-kit/AI工作流演进与多智能体协作交流文档.md)
