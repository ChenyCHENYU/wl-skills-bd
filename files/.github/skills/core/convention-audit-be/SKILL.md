---
name: convention-audit-be
description: |
  后端工程只读审计：统一 Git 变更、B1~B31、Java 质量门、平台适配、项目断言、供应链、覆盖率和生产 assurance。
  支持 review/full/quick/staged/规则子集，明确新增/基线/豁免、覆盖缺口、执行证据和修复分流。
  典型触发：「规范审计」「代码体检」「全量扫描」「检查代码」「代码质量」「复扫验证」
metadata:
  status: "✅ 已落地"
  stage: "⑧ 审计"
---

# convention-audit-be

本 Skill 只发现和解释问题，不修改源码。确定性结果来自实际执行器；AI 仅补充业务语义、DDL 风险和架构判断。

## Pre-flight

```text
🚀 已触发 convention-audit-be
✅ 已读取 standards/index.md 与本次相关规范
✅ 已确定扫描范围和 compatible profile
✅ 已读取 .be-rules-ignore / rules.local.json
✅ 已检查 JDK/Maven 与质量门接入状态
✅ 已读取 standards/30 和项目 quality-gate/adapter/assertion/supply-chain 策略（存在时）
```

## 执行

```bash
# 变更级总控：新增/基线/豁免 + 平台适配 + 供应链 + 覆盖率
wl-skills-bd review run --base origin/main --module <module> --json

# 全量 B1~B31
wl-skills-bd validate <范围> --strict

# 跳过 B9~B12 设计级慢规则，适合快速反馈
wl-skills-bd validate <范围> --quick

# 单点任务只发现、读取并执行指定规则需要的文件；最终交付仍补 full
wl-skills-bd validate <范围> --rules B3,B4,B7,B18

# CI/代码平台
wl-skills-bd validate . --format sarif --output reports/backend.sarif

# 完整 Java 门禁
mvn verify
```

报告支持 text/json/markdown/SARIF。每个问题包含规则、严重度、文件、行列、标准来源和稳定 fingerprint；被 `.be-rules-ignore` 或带理由的单行抑制命中时进入 suppressed，不从记录中消失。JSON/MCP 还必须保留 `coverage` 与 `execution`，证明实际执行规则组、读取文件/字节、缓存命中和跳过原因。

MCP 默认使用统一 `response.mode=summary`。只有定位时提高 `maxItems/maxBytes` 或选择 compact/full；超预算正文用返回的 cursor 续取，不重复扫描。

## 执行器矩阵

| 层 | 执行器 | 重点 |
|---|---|---|
| 变更总控 | review | B1~B31、平台适配、项目断言、供应链、JaCoCo 全量/变更行、基线和豁免 |
| 快速规则 | B1~B31 | 权限/OpenAPI/SQL/事务/租户/异常/规模/复杂度/Javadoc/Redis/敏感写/稳定性/方法安全/敏感日志/Mapper 绑定/数据库事实源一致性 |
| 架构 | ArchUnit J1 | Controller→Mapper、层依赖、循环依赖 |
| 规范 | Checkstyle J2 | 命名、import、Javadoc、文件结构 |
| 代码问题 | PMD7 J3 | Java 规则主门禁 |
| 缺陷 | SpotBugs J4 | 字节码缺陷 |
| 格式 | Spotless J5 | Java 8 兼容格式门 |
| 遗留参考 | P3C J6 | 独立 PMD6 legacy profile，非阻断 |

DDL 执行授权、数据回填、权限分配、API 破坏性变更和业务状态机不由静态工具决定，必须明确标成“人工”。

## 修复分流

- 先执行 `fix advise`；B3/B5 且满足严格前置条件，或项目断言声明单次精确替换时，才可交受控 apply；
- B1/B2/B4/B7/B8/B12：提供证据与人工方案，不生成猜测式修复；
- B26：核对扫描前缀、泛型 Mapper 注册和 XML namespace，再跑真实 Maven package/启动查询；
- B31：复用 Source Index 对账契约/迁移显式根；缺表/缺列/无源变更转 db-drift 离线快照确认，不扫描整个工程猜表；
- B6/B9/B10/B11：进入结构重构设计；
- DDL：转 `db-migration`，只生成 diff/恢复说明；
- 修复后必须复跑原范围和 Maven 门禁。
- MQ/HTTP 等平台封装缺口转 `integration-adapter-be`；不得把环境配置当作已接线证据。

## 完成摘要

```text
✅ convention-audit-be 完成
  - 范围/文件数
  - B 规则 error/warn/info/suppressed
  - J1~J5 各门状态
  - 自动修复候选 / 人工项
  - 报告路径
  - 下一步：fix plan 或人工评审
```

## 变更记录

- 2026-08-24 v0.21.0：规则前置短路、共享扫描上下文、显式执行指标、统一 MCP 预算与质量评测门禁。
- 2026-08-31 v0.24.0：加入 review 总控、项目质量基线、平台适配、供应链、变更行覆盖率和分级修复。
- 2026-07-28 v0.17.8：纳入 B26 Mapper 可发现性与运行绑定闭环。
- 2026-07-18 v1：同步 B1~B12、多格式报告、J1~J6 隔离和安全修复分流。
