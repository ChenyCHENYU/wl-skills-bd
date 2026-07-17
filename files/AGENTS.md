# Agent Instructions — 后端 AI 工作流

> 本文件供通用 Agents（Amp / SWE-bench / 其他支持 AGENTS.md 的工具）在后端业务工程中读取。  
> 完整主入口见 `.github/copilot-instructions.md`。

---

## 关键约束（任何 Agent 必须遵守）

1. **DDL / 数据写操作**必须在人工确认 diff 后执行，禁止自动推进
2. **禁止**跨层直接调用（Controller → Mapper，跳过 Service）
3. **禁止**一次性读取全部 `.github/standards/`，按 `.github/standards/index.md` 任务类型映射按需加载
4. **权限码**任何新增必须与前端 `SYS_PERMISSION_INFO.md` 保持同步

---

## Skill 触发入口

读取 `.github/skills/_registry.md` 获取触发词 → Skill 路径映射。  
读取 `.github/skills/_best-practices.md` 做场景语义路由。

---

## 技术栈速查

- Java 8 · Spring Boot · jh4j-cloud 3.x · MyBatis-Plus
- 返回：`ApiResult.success(message, data)` | 分页：`JhPage<T>`
- 权限：`@PreAuthorize("@pms.hasPermission('xxx_yyy_zzz')")`
- 数据库：检测方式见 `.github/standards/01-toolchain.md`
- 代码生成：读 `.github/templates/` 填空（非自由发挥）
- 自检：`wl-skills-bd validate`（B1~B8）或 MCP `wls_be_validate`
- Java 检查工具：Checkstyle / PMD / SpotBugs / ArchUnit / Spotless（见 `.github/java-quality/`）

---

## 完整指令

见 `.github/copilot-instructions.md`。
