# wl-skills-bd 架构概要

## 分层

```text
L0  上游事实       已评审需求 / 可选 design-model 或前端契约 / 数据模型 / 现网约束
      │
L1  机器契约       contract schema + shared delivery profile
      │
L2  确定性生成     14 模板产物 + wl-api-contract JSON/Markdown
      │
L3  静态保证       B1~B23 + ArchUnit/Checkstyle/PMD/SpotBugs/Spotless/JaCoCo
      │
L4  受控变更       install/codegen/safe-fix 的 planHash、确认、备份、复扫
      │
L5  人工卡口       DDL 执行、数据回填、权限发布、破坏性 API 与业务重构
```

单向依赖原则：上游事实先被收敛成机器契约，代码和协作文档再从契约生成。检查器不偷偷修代码；修复器不猜权限、SQL、租户或业务语义；MCP 只是复用同一 lib 能力，不建立第二套逻辑。

## 包内模块

| 模块 | 职责 |
|---|---|
| `files/.wl-skills-bd/` | profile、兼容矩阵、规则目录、JSON Schema |
| `files/.github/standards/` | 24 条团队规范 |
| `files/.github/skills/` | 场景编排与人工判断边界 |
| `files/.github/templates/` | 14 个严格模板与示例契约 |
| `lib/contract.js` | 契约语义校验与模板上下文 |
| `lib/codegen.js` | 16 产物计划、状态、冲突和应用 |
| `lib/collaboration.js` | 前端 manifest/api.md、OpenAPI/权限差异 |
| `lib/be-rules.js` / `reporters.js` | B1~B23 与多格式报告 |
| `lib/safe-fix.js` | B3/B5 白名单计划、备份回滚和复扫 |
| `lib/installer.js` / `doctor.js` | 资产生命周期与环境诊断 |
| `mcp/` | 9 个工具的 schema、registry 和 stdio 协议适配 |

## 与 wl-skills-kit 的协作

`wl-skills-kit` 负责页面、菜单/字典/权限同步与前端校验；`wl-skills-bd` 负责 Controller/Service/Mapper/DDL/测试与后端质量门。两者都内置同一 delivery profile，可各自从需求独立工作，再在 API_CONFIG、HTTP 方法/路径、字段、响应、权限和 completion 处握手。

后端不直接修改前端工程：它生成机器类型为 `wl-api-contract` 的 JSON 与 `api.md`，再用 `contract diff --strict` 对比 kit 契约、运行时 OpenAPI、权限清单和双方完成度。design-model 的稳定 ID 是可选增强，不存在时不阻断独立闭环。

## 设计约束

- Java 8 / Spring Boot 2 / jh4j-cloud 3.1 / OpenAPI 3 是当前唯一 codegen Profile；
- Controller 不依赖 Mapper，直接 Service 是团队默认；
- 租户值来自 AuthUtil，SQL 显式 COMPANY_ID，软删 1=有效/0=删除；
- UpdateDTO 强制 id/revision，详情 VO 返回 revision；
- DDL 只生成正向 Flyway 与人工恢复说明，不执行数据库写入；
- 所有本地状态与备份位于 `.wl-skills-bd/.state/`，扫描器主动排除它以避免污染结果。

## 详细流程

- 生成：`codegen-workflow.md`
- 前后端：`frontend-backend-contract.md`
- MCP：`mcp-workflow.md`
- 使用：`usage.md`
