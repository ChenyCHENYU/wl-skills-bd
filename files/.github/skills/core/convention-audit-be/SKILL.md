---
name: convention-audit-be
description: |
  后端工程只读审计：B1~B25、多格式报告、ArchUnit/Checkstyle/PMD7/SpotBugs/Spotless、生产 assurance 与人工语义检查。
  支持全量和 quick 模式，输出可追踪指纹、豁免理由和后续处理分流。
  典型触发：「规范审计」「代码体检」「全量扫描」「检查代码」「代码质量」「复扫验证」
status: ✅ 已落地
stage: ⑧ 审计
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
```

## 执行

```bash
# 全量 B1~B25
wl-skills-bd validate <范围> --strict

# 跳过 B9~B12 设计级慢规则，适合快速反馈
wl-skills-bd validate <范围> --quick

# CI/代码平台
wl-skills-bd validate . --format sarif --output reports/backend.sarif

# 完整 Java 门禁
mvn verify
```

报告支持 text/json/markdown/SARIF。每个问题包含规则、严重度、文件、行列、标准来源和稳定 fingerprint；被 `.be-rules-ignore` 或带理由的单行抑制命中时进入 suppressed，不从记录中消失。

## 执行器矩阵

| 层 | 执行器 | 重点 |
|---|---|---|
| 快速规则 | B1~B25 | 权限/OpenAPI/SQL/事务/租户/异常/规模/复杂度/Javadoc/Redis/敏感写/稳定性/方法安全/敏感日志 |
| 架构 | ArchUnit J1 | Controller→Mapper、层依赖、循环依赖 |
| 规范 | Checkstyle J2 | 命名、import、Javadoc、文件结构 |
| 代码问题 | PMD7 J3 | Java 规则主门禁 |
| 缺陷 | SpotBugs J4 | 字节码缺陷 |
| 格式 | Spotless J5 | Java 8 兼容格式门 |
| 遗留参考 | P3C J6 | 独立 PMD6 legacy profile，非阻断 |

DDL 执行授权、数据回填、权限分配、API 破坏性变更和业务状态机不由静态工具决定，必须明确标成“人工”。

## 修复分流

- B3/B5 且满足严格前置条件：可交 `code-fix-be`/`fix plan`；
- B1/B2/B4/B7/B8/B12：提供证据与人工方案，不生成猜测式修复；
- B6/B9/B10/B11：进入结构重构设计；
- DDL：转 `db-migration`，只生成 diff/恢复说明；
- 修复后必须复跑原范围和 Maven 门禁。

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

- 2026-07-18 v1：同步 B1~B12、多格式报告、J1~J6 隔离和安全修复分流。
