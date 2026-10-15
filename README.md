<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ChenyCHENYU/wl-skills-bd/main/assets/wl-bd-logo-dark.svg">
    <img alt="WL · World Leading · skills-bd" src="https://raw.githubusercontent.com/ChenyCHENYU/wl-skills-bd/main/assets/wl-bd-logo.svg" width="100%">
  </picture>
</p>

<p align="center"><strong>把 Java 后端的工程规范、业务契约、代码生成和质量检查接成一条可验证的交付流程。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agile-team/wl-skills-bd"><img src="https://img.shields.io/npm/v/@agile-team/wl-skills-bd?color=886331" alt="npm" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%E2%89%A522-526A81.svg" alt="Node" /></a>
  <a href="https://github.com/ChenyCHENYU/wl-skills-bd/blob/main/files/.github/java-quality/README.md"><img src="https://img.shields.io/badge/Java-8-886331.svg" alt="Java" /></a>
</p>

## 解决什么问题

| 场景 | 提供的能力 | 你能看到的结果 |
| --- | --- | --- |
| 开发靠口头约定 | 后端规范、任务路由、项目 Profile | 当前任务要读什么、检查什么、还缺什么 |
| 接口、数据库与实现不一致 | 契约校验、代码生成、字段影响和前后端对账 | 差异定位、生成计划、待确认的业务疑点 |
| 问题等到构建或上线才出现 | B 规则、Git 变更审查、Java 质量门模板 | 文件、行号、严重度、修复建议及真实检查范围 |
| 修复依赖 AI 反复改代码 | 确定性修复、计划确认、备份、回滚与复扫 | 可审阅的前后差异，失败可恢复 |

适用于**已接入的 Java 8 / Spring Boot 2 后端工程**。当前已验证的生成 Profile 是 `jh4j3-openapi3`：jh4j-cloud 3.1、MyBatis-Plus、OpenAPI 3。其他技术栈需先核对兼容矩阵，不根据项目名称套用。

## 后端怎么安装

**这是 Node.js 工具包，不是 Maven 业务依赖。** Node.js 22+ 运行安装器、扫描器和 MCP；Java 8 / Maven 编译和验证业务代码。纯 Java 仓库可以直接用 `npx`，无需为了接入创建前端工程。

以下操作都在**实际后端仓库根目录**执行，聚合工作区不作为业务项目安装。

### 1. 预览接入计划

```bash
npx @agile-team/wl-skills-bd init --json
```

查看待写入的规范、Skill、编辑器入口、MCP 和质量规则文件，取得 `planHash`。这一步不修改项目。

### 2. 确认并安装

```bash
npx @agile-team/wl-skills-bd init --plan-hash <planHash> --confirm
npx @agile-team/wl-skills-bd check --json
```

只写本包受管资产，保留项目已有内容；`check` 检查安装完整性与漂移。纯 Java 仓库的 MCP 调用固定到安装版本。安装器不自动修改业务源码或 POM。

### 3. 看第一份结果

```bash
npx @agile-team/wl-skills-bd doctor --json
npx @agile-team/wl-skills-bd validate . --json
```

`doctor` 暴露 JDK、质量门、配置与契约缺项；`validate` 执行后端规则，返回问题位置、建议和覆盖情况。出现 `partial` 时先补齐缺项，不能把未检查范围算作通过。

## 一个场景：提交前发现 SQL 问题

以订单模块为例，Mapper 中出现 `SELECT *`，字段增加后容易产生多余传输和映射风险。

| 步骤 | 工具做什么 | 验收点 |
| --- | --- | --- |
| 识别任务 | `task` 确认目标、规范和规则，返回 `runId` | 编辑前能看到实际 `notice` 和待检查项 |
| 定位问题 | `validate` 的 B3 定位 SQL 行 | 报告指出文件、行号及修复建议 |
| 预览修复 | `fix plan <Mapper路径> --rules B3 --json` | 有安全、显式且别名匹配的 `BaseColumns` 才提供确定性替换 |
| 确认执行 | 同目标 `fix apply` 携带 `--plan-hash <hash> --confirm` | 脚本写入、备份并复扫；不满足前置条件则留人工处理 |
| 复验交付 | 同 `runId` 再 `validate` 并查询 `status` | 问题前后可对比，范围明确；继续完成 Maven 与业务验收 |

```bash
# 路径替换为项目实际文件；runId 使用 task 返回值
npx @agile-team/wl-skills-bd task --input "修复订单 Mapper SQL 问题并复查" --target-file src/main/resources/mapper/OrderMapper.xml --json
npx @agile-team/wl-skills-bd validate src/main/resources/mapper/OrderMapper.xml --rules B3 --run-id <runId> --json
npx @agile-team/wl-skills-bd status --run-id <runId> --json
```

脚本负责可证明安全的机械修改，AI 解释差异与业务语义；权限、租户、SQL 语义和业务算法仍需审阅。单条规则通过只证明这次检查范围，未执行的规则、Java 构建和运行验证会保留未验证状态。

新建接口、加字段或增加业务命令走另一条同样明确的链：**更新契约 → 校验 → 预览生成 → 确认写入 → 前后端对账 → 编译测试 → 运行验收**。详见 [代码生成流程](files/.github/guides/codegen-workflow.md) 与 [业务交付闭环](files/.github/guides/business-closure-playbook.md)。

## 项目与流水线怎么配合

| 层面 | 接入方式 | 成功标志 |
| --- | --- | --- |
| 开发与 AI | `init` 安装入口；任务开始判定，结束复扫并读 `status` | 有真实工具记录和检查文件，缺项明确显示 |
| Git 变更审查 | `review run --base <基线分支> --json`；按项目配置接入钩子或 Gate | 区分新增问题、历史基线和有效豁免 |
| Java 静态分析 | 审查后将包内 Maven Profile 接入父 POM，使用 `wl-quality-audit` | 各适用模块产出真实 Checkstyle / PMD / SpotBugs 报告 |
| 单元与架构测试 | 独立使用 `wl-quality-unit`；已批准严格规范可使用 `wl-quality` | 编译、必测用例和覆盖率有独立结果 |
| 统一门禁与通知 | 按需由 Gate 调用本包并汇总原生报告 | 钩子、CI、报告与群通知按接线实际触发 |

BD 提供后端规则与执行器；**Gate 负责跨包编排和质量闭环**。两者都可独立使用。Java Profile 需先审查 POM 差异、模块范围和测试集合，再在隔离 Runner 验收；不要把静态报告成功当作构建、测试和业务已通过。接入命令见 [Java 质量门](files/.github/java-quality/README.md)。

安装入口不等于所有宿主已自动执行。首次接入用一条可定位问题验证“触发 → 报告 → 修复 → 复扫”；日常执行交给已配置的 AI 宿主、钩子和流水线。

## 按需深入

| 需要 | 入口 |
| --- | --- |
| 全部任务、规则与日常操作 | [使用指南](files/.github/guides/usage.md) · [任务目录](files/.github/standards/26-task-driven.md) · [规范清单](files/.github/standards/index.md) |
| 契约、数据库与前后端联调 | [生成流程](files/.github/guides/codegen-workflow.md) · [协作契约](files/.github/guides/frontend-backend-contract.md) |
| Java 工具与 Maven 配置 | [Java 质量门](files/.github/java-quality/README.md) · [Maven 模板](files/.github/java-quality/maven-snippets/README.md) |
| AI / MCP、协议与维护 | [MCP 工作流](files/.github/guides/mcp-workflow.md) · [公开 API](docs/public-api.md) · [维护契约](docs/maintenance-contract.md) |
| 接入边界、范围配置与版本更新 | [项目范围](docs/project-scope.md) · `wl-skills-bd update / diff / doctor-host` |

## WL 系列

**WL · World Leading**。各包按职责独立接入，已接且适用的包可共享任务 `runId`。

| 包 | 职责 |
| --- | --- |
| [skills-gate](https://github.com/ChenyCHENYU/wl-skills-gate) | 项目接入、钩子与 CI 门禁、报告闭环 |
| [skills-kit](https://github.com/ChenyCHENYU/wl-skills-kit) | PC 前端工程与代码规范 |
| [skills-ui](https://github.com/ChenyCHENYU/wl-skills-ui) | UI 一致性、扫描与确定性修复 |
| **skills-bd** | Java 后端契约、生成与质量检查 |
| [skills-test](https://github.com/ChenyCHENYU/wl-skills-test) | 测试规划、执行与验收证据 |
| [skills-design](https://github.com/ChenyCHENYU/wl-skills-design) | 需求、设计与交付文档 |
