# Copilot Instructions — wl-skills-bd (后端 AI 主入口)

> 本文件是 GitHub Copilot / Cursor / Windsurf / Claude Code / Cline / Kiro / Trae / Qoder / 通用 Agents 在 **后端业务工程** 中的统一主入口（多编辑器适配器会从这里派生具体的 frontmatter）。
> 维护者：CHENY（工号 409322）
> 包：`@agile-team/wl-skills-bd` v0.0.1（骨架阶段）

---

## 0. AI 必须先读的三件套（懒加载入口）

每次会话首轮、或用户意图明显切换时，AI 必须按需读取以下文件中的相关章节：

1. `.github/skills/_best-practices.md` — 场景索引（语义级路由，不依赖关键词命中）
2. `.github/skills/_registry.md` — 触发词 → SKILL 路径单一数据源
3. `.github/standards/index.md` — 规范门控（任务类型 → 必读 standards 映射）

> **禁止** 一次性 `read_file` 全部 17 条 standards 与全部 10 个 SKILL.md。按需加载。

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

## 6. 多 AI 编辑器适配（与 kit 同步策略）

业务工程根目录还可能存在以下平行入口（由各编辑器自动消费，AI 解析时取**任一**即可，不要重复推断）：

- `CLAUDE.md`（Claude Code）
- `AGENTS.md`（通用 Agents）
- `.cursorrules` / `.cursor/rules/conventions.mdc`（Cursor）
- `.windsurf/rules/conventions.md`（Windsurf）
- `.clinerules`（Cline）
- `.kiro/.../instructions.md`（Kiro）
- `.trae/.../instructions.md`（Trae）

它们的内容由本文件派生，**不要单独编辑**，统一回到本仓库 `files/.github/copilot-instructions.md` 修改。

---

## 7. 当前阶段说明（v0.0.2）

- 9 个代码生成主线 SKILL（②-⑨ + business-doc-extract）+ 1 个横切 ops SKILL（`standard-env-config-be`），共 10 个 SKILL.md 仅含 frontmatter + 流程纲要 + Pre-flight 占位，**模板细节待 0.1.x → 0.2.x 补齐**
- **17 条 standards**：03 / 07 / 15 / 16 / 17 本次新增落地；02 / 04 / 05 / 06 / 12 已落地；01 / 08 / 09 / 10 / 11 / 13 / 14 仍为骨架
- MCP / CLI / 单元测试体系尚未启动

> 触发 Skill 时若发现 SKILL.md 内容不足以指导落地，AI 应：**优先按 `mdm-service` 的真实代码风格倒推**，并把"建议补全的规则"作为下一步建议输出。
