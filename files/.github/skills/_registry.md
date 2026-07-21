# Backend Skills 注册表（v0.17.0）

> 单一数据源。AI 触发 Skill 的唯一依据。**禁止从 README / 个人记忆推断 Skill 路径。**
> 状态与各 SKILL.md 头部 frontmatter 严格一致，改一处必须同步另一处。

---

## 触发词 → SKILL 路径

| 触发词（示例）                                          | SKILL                                                                    | 阶段 | 状态     | MCP 依赖   |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---- | -------- | ---------- |
| 设计接口 / 评审 api.md / 接口契约审查                  | [`core/api-design-be`](core/api-design-be/SKILL.md)                      | ②   | ✅ 落地  | contract   |
| 生成实体 / Entity / DTO / VO                          | [`core/entity-codegen`](core/entity-codegen/SKILL.md)                    | ③   | ✅ 落地  | —          |
| 生成 Service / 全套 CRUD / 业务命令 / 状态机           | [`core/service-codegen`](core/service-codegen/SKILL.md)                  | ④   | ✅ 落地  | —          |
| 生成 Mapper / XML / SQL                                 | [`core/mapper-xml-gen`](core/mapper-xml-gen/SKILL.md)                    | ⑤   | ✅ 落地  | —          |
| 后端规范审计 / 代码体检 / 全量扫描                      | [`core/convention-audit-be`](core/convention-audit-be/SKILL.md)          | ⑧   | ✅ 落地  | validate   |
| 模块上下文 / 查关联服务 / 生成前去重 / 避免全仓扫描             | [`core/project-context-governance`](core/project-context-governance/SKILL.md) | ⓪ | ✅ 落地 | catalog/context |
| 抽取业务文档 / 阅读旧代码生成业务说明                  | [`core/business-doc-extract-be`](core/business-doc-extract-be/SKILL.md)  | ②预  | 🟡 骨架  | —          |
| 建表 / DDL / ALTER TABLE / 字段新增 / 索引            | [`data/db-migration`](data/db-migration/SKILL.md)                        | ⑥   | 🟡 部分  | db_preview |
| 生成单元测试 / Mock 测试 / Controller 测试            | [`test/unit-test-gen`](test/unit-test-gen/SKILL.md)                      | ⑦   | 🟡 骨架  | —          |
| 修复规范违规 / 按审计报告改代码                        | [`ops/code-fix-be`](ops/code-fix-be/SKILL.md)                            | ⑨   | ✅ 落地  | validate   |
| Redis / 缓存 / 分布式锁 / 批量删除 / 物理删 / 熔断 / 限流 / Feign 超时 / 生产只读 / 二次确认 | [`ops/data-safety`](ops/data-safety/SKILL.md) | ops 横切 | ✅ 落地 | validate   |
| 后端环境标准化 / 切华新 / 本地启动配不起来 / K8s 部署清单对齐 | [`ops/standard-env-config-be`](ops/standard-env-config-be/SKILL.md) | ops  | ✅ 落地 | config/troubleshoot |

**落地度**：12 个 Skill 中 **10 已落地**（project-context / api-design / entity / service / mapper / audit / safe-fix / data-safety / env-config / unit-test）/ **1 部分落地**（db-migration：CREATE/ALTER/索引已自动生成，复杂数据迁移/回填仍骨架）/ **1 骨架**（business-doc：从旧代码抽取业务文档属 NLP 能力，不在代码生成包边界）。

## v0.17 生产安全与行为契约测试

| 任务 | 工具 | 生成内容 |
|---|---|---|
| 生成单测 | `test gen <contract>` / `wls_be_test` | 从 customOperations 生成可执行场景测试；直接断言状态/结果，batch 验证整批成功与整批拒绝，不生成 TODO/空测试 |
| 列出场景 | `test scenarios <contract>` | 列出所有操作 + 测试场景清单 |
| 生产证据 | `codegen validate/plan/apply --require-complete` | `assurance.level=production` 时校验 SLO/RTO/RPO、安全、数据治理、一致性、韧性与六类证据文件 |

原则：测"行为契约"不测"代码镜像"——不 verify setter/方法调用次数，只断言结果（状态值/计数/异常）。避免冗余。

## v0.13 任务驱动精准路由

| 任务类型 | 模式 | 触发词 | 规则子集 | 工具 |
|---|---|---|---|---|
| new-service | full | 新开发/全套CRUD | B1-B25 子集 + J | codegen |
| add-api | 路由 | 加接口/加方法 | B1/B2/B5/B8/B12/B20/B24/B25 | codegen 增量 |
| add-field | 路由 | 加字段/落库 | B3/B4/B7/B18/B25 | codegen + db |
| add-business-cmd | 路由 | 状态机/审批 | B5/B8/B17/B20/B24/B25 | codegen 增量 |
| fix-bug | 路由 | 改bug/修复 | B3/B5/B7/B8/B17/B18/B24/B25 | safe-fix + troubleshoot |
| refactor | 路由 | 重构/优化 | B5-B12/B23/B24/B25 | validate |
| audit | readonly | 审计/体检 | B1-B25 | doctor + validate |
| config-op | config | 配置/连不上 | config-doctor L0~L8 | config + troubleshoot |

`task` 是只读指挥层：识别意图→给 Skill/规则/步骤，不直接写代码；写操作统一走 codegen plan/apply（planHash+确认）或 safe-fix/config。

## v0.12 配置分层矩阵

| 检查/工具 | 作用 | 写入 |
|---|---|:---:|
| config init | 生成骨架（bootstrap+app+logback+env×5+matrix） | 条件 |
| config migrate | 客户迁移（.env+K8s×15+报告） | 条件 |
| config doctor | L0~L8 配置体检（骨架/明文密码/占位符/矩阵/K8s/端口/一致性/生产护栏） | 否 |
| config doctor --probe | DB/Redis/Nacos TCP 连通性探测 | 否 |
| config fix | 明文密码→${VAR} 占位符 + 复扫 | 条件 |
| troubleshoot | 10 类故障诊断树（DB/Redis/Nacos/K8s/端口/Bean/Profile/Flyway/Feign/MQ）| 否 |

## v0.11 稳定性与多环境矩阵

| B 规则 | 标准 | 检测 | severity | data-safety 兜底 |
|---|---|---|---|---|
| B14（扩展）| 20 | setIfAbsent 长 TTL（>10min）缺 watchdog | error | ✅ |
| B20 | 10 + 22 | @Transactional 内调 MQ/HTTP | error | ✅ |
| B21 | 22 | HttpUtil/RestTemplate 裸调用无超时 | warn | ✅ |
| B22 | 13 | Swagger 2/OpenAPI 3 混用（混用 error/纯 Swagger 2 warn）| warn | ✅ |
| B23 | 02 + 19 | Service 注入依赖 > 10（巨型类信号）| warn | ✅ |
| B24 | 11 + 28 | 使用 `@PreAuthorize` 但未启用方法安全 | error | ✅ |
| B25 | 09 + 11 + 28 | 敏感字段进入 Lombok `toString` | error | ✅ |

## v0.10 数据安全矩阵

| B 规则 | 标准 | 检测 | severity | data-safety 兜底 |
|---|---|---|---|---|
| B13 | 20 | Redis set 缺 TTL | error | ✅ |
| B14 | 20 | setnx 自实现锁 | error | ✅ |
| B15 | 20 | KEYS \*/FLUSHDB/FLUSHALL | error | ✅ |
| B16 | 20 | JdkSerializationRedisSerializer | warn | ✅ |
| B17 | 21 | deleteBatchIds/TRUNCATE/DROP | error | ✅ |
| B18 | 21 | Mapper XML update/delete 缺 WHERE | error | ✅ |
| B19 | 21 | saveBatch > 1000 | warn | ✅ |

---

## 状态标记

- ✅ 落地：含完整模板、产物示例、回归用例
- 🟡 骨架：仅 frontmatter + 流程纲要，AI 触发时按 **官方/社区最佳实践 + standards 规范** 落地（**不**对齐某个存量项目）
- 🔴 阻断：检测到必要前提缺失时暂停

---

## 12 个 Skill 的 Pipeline 联动（详见 `_pipeline.md`）

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
- 不存在的 Skill 应明确说明未提供执行器，并给出当前可用的手工流程；不得声称已自动登记 roadmap。
