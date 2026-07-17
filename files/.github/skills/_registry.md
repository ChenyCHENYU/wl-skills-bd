# Backend Skills 注册表（v0.0.3 骨架）

> 单一数据源。AI 触发 Skill 的唯一依据。**禁止从 README / 个人记忆推断 Skill 路径。**

---

## 触发词 → SKILL 路径

| 触发词（示例）                                          | SKILL                                                                    | 阶段 | 状态     | MCP 依赖   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---- | -------- | ---------- |
| 设计接口 / 评审 api.md / 接口契约审查                  | [`core/api-design-be`](core/api-design-be/SKILL.md)                      | ②   | 🟡 骨架  | —          |
| 生成实体 / Entity / DTO / VO                          | [`core/entity-codegen`](core/entity-codegen/SKILL.md)                    | ③   | 🟡 骨架  | —          |
| 生成 Service / 全套 CRUD / 实现业务方法                | [`core/service-codegen`](core/service-codegen/SKILL.md)                  | ④   | 🟡 骨架  | —          |
| 生成 Mapper / XML / SQL                                 | [`core/mapper-xml-gen`](core/mapper-xml-gen/SKILL.md)                    | ⑤   | 🟡 骨架  | —          |
| 后端规范审计 / 代码体检 / 全量扫描                      | [`core/convention-audit-be`](core/convention-audit-be/SKILL.md)          | ⑧   | 🟡 骨架  | —          |
| 抽取业务文档 / 阅读旧代码生成业务说明                  | [`core/business-doc-extract-be`](core/business-doc-extract-be/SKILL.md)  | ②预  | 🟡 骨架  | —          |
| 建表 / DDL / 表结构变更 / 字段新增                    | [`data/db-migration`](data/db-migration/SKILL.md)                        | ⑥   | 🟡 骨架  | DB（待）   |
| 生成单元测试 / Mock 测试 / Controller 测试            | [`test/unit-test-gen`](test/unit-test-gen/SKILL.md)                      | ⑦   | 🟡 骨架  | —          |
| 修复规范违规 / 按审计报告改代码                        | [`ops/code-fix-be`](ops/code-fix-be/SKILL.md)                            | ⑨   | 🟡 骨架  | —          |
| 后端环境标准化 / 切华新 / 本地启动配不起来 / K8s 部署清单对齐 | [`ops/standard-env-config-be`](ops/standard-env-config-be/SKILL.md) | ops  | 🟡 骨架  | —          |

---

## 状态标记

- ✅ 落地：含完整模板、产物示例、回归用例
- 🟡 骨架：仅 frontmatter + 流程纲要，AI 触发时按 **官方/社区最佳实践 + standards 规范** 落地（**不**对齐某个存量项目）
- 🔴 阻断：检测到必要前提缺失时暂停

---

## 10 个 Skill 的 Pipeline 联动（详见 `_pipeline.md`）

```
business-doc-extract-be → api-design-be → entity-codegen → service-codegen
                                                                │
                                                                ▼
                                                       mapper-xml-gen
                                                                │
                                                                ▼
                                                       db-migration（人工确认）
                                                                │
                                                                ▼
                                                       unit-test-gen
                                                                │
                                                                ▼
                                                       convention-audit-be
                                                                │
                                                                ▼
                                                       code-fix-be（可选）
```

---

## 变更管理

- 新增 Skill：编辑本文件 + 创建 `skills/{category}/{name}/SKILL.md + USAGE.md`
- 不存在的 Skill 一律返回："该能力暂未上线，已记录到 roadmap.md"
