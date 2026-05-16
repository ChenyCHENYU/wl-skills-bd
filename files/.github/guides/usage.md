# wl-skills-bd 使用指南（v0.0.1 骨架）

## 安装到业务工程（骨架阶段：手动）

```powershell
# 在业务工程根目录
xcopy /E /Y D:\office-project\wl\wl-skills-bd\files\.github  .github\
```

> 0.1.x 后通过 `wl-skills-bd init` CLI 安装。

## 触发 Skill

任何 AI 编辑器（Copilot / Cursor / Claude Code / Cline / Windsurf / Trae / Qoder）打开业务工程后：

1. 输入触发词（参见 `.github/skills/_registry.md`）
2. AI 会先输出 Pre-flight 声明
3. AI 按 standards 生成产物
4. AI 输出 `next_suggest` 引导下一步

## 典型场景

- **从零做模块**：场景 1（参见 `.github/skills/_best-practices.md`）
- **加字段**：场景 2
- **代码体检**：场景 3
- **接口同步**：场景 4
- **接手陌生模块**：场景 5
- **咨询模式**：场景 6（只看不写）

## 与前端 wl-skills-kit 协作

| 协作点         | 前端产出                              | 后端消费                        |
| -------------- | ------------------------------------- | ------------------------------- |
| 接口契约       | `src/views/{module}/api.md`           | `api-design-be` 读取并 diff     |
| 业务理解       | `docs/business/{module}.md`           | `service-codegen` 业务背景       |
| 权限码         | `SYS_PERMISSION_INFO.md`              | `convention-audit-be` 双向对账   |

## 常见问题

**Q: AI 跳过了 Pre-flight 声明？**
A: 在用户消息里加："请先输出 Pre-flight 声明，然后再生成代码"

**Q: 不同 AI 工具表现不一致？**
A: 多入口文件（`CLAUDE.md` / `AGENTS.md` 等）会在 0.2.x 由 CLI 自动派生。当前手动同步主 `copilot-instructions.md`。

**Q: SKILL 内容太薄？**
A: 0.0.1 骨架阶段。AI 触发时会按 `mdm-service` 真实代码风格倒推。如发现明显偏差请反馈到 `kit-internal/` issue。
