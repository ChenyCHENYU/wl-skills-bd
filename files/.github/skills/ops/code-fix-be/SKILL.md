---
name: code-fix-be
description: |
  根据 B1~B25 审计结果建立安全修复计划。只有满足确定性前置条件的 B3/B5 可自动修改；
  其余规则输出人工方案。所有自动写入必须 planHash + 显式确认 + 备份 + 强制复扫。
  典型触发：「修复规范问题」「按审计报告改」「修违规」「批量整改」
status: ✅ 已落地
stage: ⑨ 修复
risk: 🟡 中风险（受控写代码）
---

# code-fix-be

## Pre-flight

```text
🚀 已触发 code-fix-be
✅ 已读取 standards/index.md 与偏差报告
✅ 自动修复白名单：B3/B5
⚠️ 其他规则不自动猜权限、字段、租户、异常或业务结构
⚠️ apply 必须使用刚刚预览的 planHash 并显式确认
```

## 可执行流程

```bash
# 预览，零写入
wl-skills-bd fix plan src/main --rules B3,B5 --json

# 评审 actions/manual 后应用
wl-skills-bd fix apply src/main --rules B3,B5 \
  --plan-hash <hash> --confirm
```

MCP 对应工具为 `wls_be_safe_fix`：默认预览；正式写入传 `confirmApply: true` 和相同 `planHash`。

## 自动修复白名单

| 规则 | 只有满足以下条件才自动修复 | 修改 |
|---|---|---|
| B3 SELECT 星号 | 同 Mapper XML 存在非空、无星号、无 `${}` 的 `BaseColumns`，且列别名与查询别名一致 | 用 `<include refid="BaseColumns"/>` 替换星号 |
| B5 缺事务 | 定位到 public 写方法，且没有 `javax/jakarta.transaction.Transactional` 冲突 | 加 Spring `@Transactional(rollbackFor = Exception.class)` 和精确 import |

不满足前置条件时进入 `manual`，不会做部分猜测。

## 明确禁止自动修复

| 规则 | 原因 |
|---|---|
| B1 | 权限码和公开接口豁免属于安全/产品决策，不能从方法名猜 |
| B2 | `@Operation` 文案是公开 API 语义，机械 TODO 会污染文档 |
| B4 | `${}` 可能代表列名、表名或排序，直接换 `#{}` 会改变 SQL 语义 |
| B7 | 租户谓词涉及别名、JOIN、拦截器和参数来源，必须评审 |
| B8 | 业务异常码和消息不能由工具臆造 |
| B6/B9/B10/B11 | 分域、拆类、拆方法和复杂度治理是结构重构 |
| B12 | Javadoc 必须描述真实业务契约，禁止生成空话 |
| DDL/权限分配/API 破坏性变更 | 必须走 DBA、权限中心或契约评审流程 |

## 写入与复扫保证

1. plan 输出每个文件的 before/after hash 和逐项 edit；
2. apply 缺确认或 hash 不符时零写入；
3. 写前重新扫描，任何漂移使 plan 失效；
4. 所有目标先备份到 `.wl-skills-bd/.state/fix-backups/`；
5. 多文件写入失败时从备份回滚；
6. 写后强制执行同范围 B1~B25 复扫；
7. 生成确定性的 `reports/FIX_BE_<planHash前12位>.md`；
8. 报告给出 before/after/fixed/remaining/regressions。`remaining` 或 `regressions` 非零时不得宣称闭环完成。

## 完成摘要

```text
✅/✖ code-fix-be
  - 自动修改文件：N
  - 人工项：M
  - fixed / remaining / regressions：A / B / C
  - 项目 error：before → after
  - 备份：backupId
  - 报告：reports/FIX_BE_<hash>.md
```

## 变更记录

- 2026-07-18 v1：实现 B3/B5 严格白名单、planHash、确认门、备份回滚、漂移阻断和强制复扫；移除不安全的“万能自动修复”承诺。
