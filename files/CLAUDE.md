# Claude Code Instructions — 后端 AI 工作流

> 本文件供 **Claude Code** 在后端业务工程中读取。完整主入口见 `.github/copilot-instructions.md`。

---

## 技术栈（必读）

- **语言 / 框架**：Java 8 · Spring Boot · jh4j-cloud 3.x · MyBatis-Plus
- **数据库**：MySQL（主流业务）/ Oracle（主数据类，如 mdm-service）
- **返回包装**：`ApiResult.success(message, data)`
- **分页**：`JhPage<T>`
- **权限注解**：`@PreAuthorize("@pms.hasPermission('xxx_yyy_zzz')")`

---

## Pipeline（9 步，从 api.md 到单测）

```
① business-doc-extract-be  ②  api-design-be  ③  entity-codegen  ④  service-codegen
                                                                              ↓
                                                                    ⑤ mapper-xml-gen
                                                                              ↓
                                                               ⑥ db-migration（人工确认）
                                                                              ↓
                                                               ⑦ unit-test-gen
                                                                              ↓
                                                               ⑧ convention-audit-be → ⑨ code-fix-be
```

详见 `.github/skills/_registry.md` 和 `.github/skills/_pipeline.md`。

---

## 高风险动作（必须人工确认后才能执行）

| 动作 | 要求 |
|------|------|
| DDL 变更（CREATE / ALTER / DROP） | 先生成 + 回滚脚本，展示 diff |
| 删除数据 / 批量 UPDATE | 显示 WHERE 条件 + 估算受影响行数 |
| 修改 application.yml 生产配置 | diff + 影响面说明 |
| 删除 / 重命名 Controller 路径 | 同步通知前端更新 api.md |

---

## 规范门控

任何 Skill 触发前必须读取 `.github/standards/index.md`，按任务类型加载对应规范。  
**禁止一次性加载全部 17 条规范。**

---

## 完整指令

见 `.github/copilot-instructions.md`（包含 Pre-flight 格式、跨前后端协作契约、多编辑器适配说明）。
