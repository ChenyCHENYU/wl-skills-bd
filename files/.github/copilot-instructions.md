# Copilot Instructions — wl-skills-bd (后端 AI 主入口)

> 本文件是 GitHub Copilot / Cursor / Windsurf / Claude Code / Cline / Kiro / Trae / Qoder / 通用 Agents 在 **后端业务工程** 中的统一主入口（多编辑器适配器会从这里派生具体的 frontmatter）。
> 维护者：CHENY（工号 409322）
> 包：`@agile-team/wl-skills-bd` v0.4.2（18 条规范全落地 + 依据官方/社区最佳实践 + codegen SKILL + USAGE + MCP + Java 工具链）

---

## 0. AI 必须先读的三件套（懒加载入口）

每次会话首轮、或用户意图明显切换时，AI 必须按需读取以下文件中的相关章节：

1. `.github/skills/_best-practices.md` — 场景索引（语义级路由，不依赖关键词命中）
2. `.github/skills/_registry.md` — 触发词 → SKILL 路径单一数据源
3. `.github/standards/index.md` — 规范门控（任务类型 → 必读 standards 映射）

> **禁止** 一次性 `read_file` 全部 18 条 standards 与全部 10 个 SKILL.md。按需加载。

---

## 1. 项目定位（团队基线）

- 技术栈：**Spring Boot + jh4j-cloud 3.x + MyBatis-Plus**，JDK 8
- 数据库：**主流业务项目 → MySQL**；**mdm-service 等主数据项目 → Oracle**（`${DATASOURCE:oracle}`）
  > ⚠️ 触发 `db-migration` / `mapper-xml-gen` / `entity-codegen` 等涉及 SQL 方言的 Skill 前，**必须先确认目标工程的数据库类型**。可通过检查 `pom.xml` 引入的 starter 或 `bootstrap.yml` 中 `DATASOURCE` 变量来判断。
- 包结构样板：参见 [`mdm-service`](../../mdm-service/) 的 `com.jhict.mdm.{controller,service,mapper,...}`
- 返回包装：`ApiResult.success(message, data)`
- 分页：`JhPage<T>`
- 权限：`@PreAuthorize("@pms.hasPermission('xxx_yyy_zzz')")`
- 写库前置：**所有 DDL / 数据回填动作必须人工确认 diff**

---

## 2. 后端 Pipeline（建议性串联，不强制）

```
api.md(前端产出) ──► api-design-be ──► entity-codegen ──► service-codegen
                                                                │
                                                                ▼
                                                      mapper-xml-gen
                                                                │
                                                                ▼
                                                      db-migration (人工确认)
                                                                │
                                                                ▼
                                                      unit-test-gen
                                                                │
                                                                ▼
                                                      convention-audit-be
                                                                │
                                                                ▼
                                                      code-fix-be (可选) ─► 复扫
```

详见 `.github/skills/_pipeline.md`。

---

## 3. 强制约定式输出（Pre-flight 声明）

任何 SKILL 被触发后，**必须先输出**：

```
🚀 已触发技能 {skill-name}/SKILL.md           → {一句话定位}
✅ 已读取 standards/index.md                  → 匹配任务类型 {A|B|C|...}
✅ 已读取 standards/{需要的条目}              → {条目说明}
✅ 工具链检测：JDK {x} ✓ Maven {x} ✓ Lombok {x} [全部就绪 | 待修复]
```

工具链失败时必须显式暂停，引导用户修复。

---

## 4. 高风险动作明细（必须人工确认）

| 动作                          | 风险等级 | 必经流程                                |
| ----------------------------- | -------- | --------------------------------------- |
| DDL 变更（CREATE/ALTER/DROP） | 🔴 红    | 先生成 + 回滚脚本，diff 后人工确认      |
| 删除数据 / 批量 UPDATE        | 🔴 红    | 必须显示 WHERE 条件 + 受影响行数估算    |
| 写菜单 / 字典 / 权限 / 角色   | 🟡 黄    | 走 `wl-skills-kit` 的 sync Skill + 确认 |
| 修改 application.yml 生产配置 | 🟡 黄    | diff + 影响面说明                       |
| 删除 / 重命名 Controller 路径 | 🟡 黄    | 影响前端 api.md，必须同步通知前端       |

---

## 5. 与前端 wl-skills-kit 的协作契约

- **共消费 `api.md`**：前端 `api-contract` Skill 产出 `src/views/**/api.md`，后端 `api-design-be` 读它做契约审查
- **共消费 `docs/business/`**：前端的业务理解文档，后端 `api-design-be` / `service-codegen` 可作业务背景
- **权限码同步**：后端代码里使用 `@pms.hasPermission('xxx')` 的字符串必须出现在前端 `SYS_PERMISSION_INFO.md` 中

---

## 6. 多 AI 编辑器适配（已物化）

业务工程 `init` 后，以下编辑器配置文件会被释放到工程根目录，各编辑器自动消费：

| 编辑器 | 配置文件 | MCP 格式 | 内容 |
|--------|---------|----------|------|
| GitHub Copilot | `.github/copilot-instructions.md` | — | 本文件（指令主体） |
| Cursor | `.cursor/mcp.json` | `mcpServers` | MCP server 接入 |
| VS Code | `.vscode/mcp.json` | `servers`(type:stdio) | MCP server 接入 |
| Kiro | `.kiro/settings/mcp.json` | `mcpServers` | MCP server 接入 |
| Claude Code | `CLAUDE.md` | — | 派生入口 |
| 通用 Agents | `AGENTS.md` | — | 派生入口 |

> 其他编辑器（Windsurf `.windsurf/rules/` / Cline `.clinerules` / Trae `.trae/`）可从本文件 symlink 或复制。
>
> 它们的内容由本文件派生，**不要单独编辑**，统一回到本仓库 `files/.github/copilot-instructions.md` 修改。

### MCP 工具（已落地 3 个）

接入 MCP 后，AI 在对话内可直接调用：

| 工具 | 作用 |
|------|------|
| `wls_be_validate` | 扫描 Java 工程输出 B1~B8 偏差（error/warn） |
| `wls_be_standards` | 查询 18 条规范清单或指定条款全文 |
| `wls_be_templates` | 查 8 个 Java 代码模板（codegen 对齐用） |

---

## 7. 当前阶段说明（v0.4.2）

- **10 个 SKILL**：entity-codegen / service-codegen / mapper-xml-gen / convention-audit-be / code-fix-be / standard-env-config-be 已落地（含 USAGE.md）；api-design-be / business-doc-extract-be / db-migration / unit-test-gen 仍骨架
- **18 条 standards**：全部已落地（01~18）
- **Java 检查工具链 J1~J5**：ArchUnit(J1) + Checkstyle(J2) + PMD(J3) + SpotBugs(J4) + Spotless(J5)，见 `.github/java-quality/`
- **确定性执行器 be-rules B1~B8**：`lib/be-rules.js`，CLI `wl-skills-bd validate` / MCP `wls_be_validate` 可调用
- **代码模板 8 个**：`.github/templates/`（Entity/DTO/PageDTO/VO/Controller/Service/Mapper.java/Mapper.xml）
- **MCP 工具 3 个**：validate / standards / templates
- **复扫闭环**：convention-audit-be `--quick` + code-fix-be 强制复扫
- **提交规范**：18-git-commit + commitlint + commit-msg hook

> 触发 Skill 时优先读 `.github/templates/` 对应模板填空生成，生成后跑 `wl-skills-bd validate` 自检。
>
> **方法论原则**：规范遵循 **官方/社区最佳实践（Spring/MyBatis-Plus/Effective Java/OWASP）+ 团队 standards**。**不**对齐任何存量项目代码；存量项目若有偏离（如硬编码租户、SQL 注入、上帝类），应作为待整改项而非基准。
