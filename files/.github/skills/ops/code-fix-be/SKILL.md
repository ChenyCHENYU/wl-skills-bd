---
name: code-fix-be
description: |
  根据 convention-audit-be 输出的 AUDIT_BE_{ts}.md 修复违规。修复前展示 diff 逐项确认，
  DDL 类违规走 db-migration。修复完成后★强制复扫验证（不可跳过），输出前后对比。
  典型触发：「修复规范问题」「按审计报告改」「修违规」「批量改」「整改」
status: 🟡 落地
stage: ⑨ 修复
risk: 🟡 中风险（写代码，需 diff 预览）
---

# code-fix-be

读取 `reports/AUDIT_BE_{ts}.md` 偏差条目，用户确认 diff 后执行修复。**修复后必须强制复扫**（对标 wl-skills-kit/code-fix 的"不可跳过"闭环保障）。

## Pre-flight 声明（必填）

```
🚀 已触发技能 code-fix-be/SKILL.md → 受控自动修复
✅ 已读取 standards/index.md              → 任务类型 E + H
✅ 已读取 reports/AUDIT_BE_{ts}.md        → 输入源，{N} 条偏差
✅ 已读取 .github/templates/              → 修复时对齐标准骨架（非自由发挥）
⚠️ 写代码操作：每个补丁先展示 diff，逐项确认
```

## 工作流

```
reports/AUDIT_BE_{ts}.md（convention-audit-be 输出）
        │
        ▼
[1] 用户挑选 issueId / issueGroup / "列出可修复项"
        │
        ▼
[2] 解析 issue → 定位文件+行号+违规类型 → 读 templates 对应骨架
        │
        ▼
[3] 选修复策略：
    ├─ rule-based（缺注解/SELECT星号/美元符注入等）→ 按 templates + 规则生成 patch
    └─ ai-based（语义性偏差）→ AI 生成 patch
        │
        ▼
[4] Pre-flight 输出 diff 预览（必须等待确认）
        │
        ▼
[5] 用户 yes → 写入文件 + 报告标记 ✅ 已修复
    用户 no  → 跳过该 issue
        │
        ▼
[6] ★ 强制复扫验证（闭环关键，不可跳过）
    ├─ 本轮修复完成后，自动跑 wl-skills-bd validate
    ├─ 仍有 error → 提示未完全修复，建议继续
    └─ 全部通过 → 输出 ✔ 闭环完成，可安全提交
```

## 强制复扫验证（v0.2+ 闭环保障）

> **闭环原则**：code-fix-be 修复后必须验证效果，不允许"改完就走"。

AI 完成**本轮全部修复**后（单条或批量），**必须自动执行**：

1. 调 `wl-skills-bd validate {涉及文件}`
2. 0 error → 输出 "✔ 复扫通过，闭环完成"
3. 仍有 error → 输出残余清单，建议继续 code-fix-be 或标记人工
4. 完成摘要记录复扫结果

**不可跳过**：即使用户说"不用验证了"，AI 也必须执行复扫。这是闭环完整性的硬性约束（对标 kit/code-fix 同款规则）。

## 修复策略表

| 严重度 | 处理方式 |
|---|---|
| 🔴 | 必修，逐项 diff 确认，复扫必须清零 |
| 🟡 | 默认修，可批量分类展示，复扫建议清零 |
| 🟢 | 默认不修，列入 backlog，用户主动要求才修 |

## 典型修复模式（对齐 templates）

| 偏差 | 来源 | 策略 | 修复依据 |
|---|---|---|---|
| 缺 @PreAuthorize | B1 | rule-based | Controller.java.tmpl 的权限码模板 |
| 缺 @ApiOperation | B2 | rule-based | Controller.java.tmpl |
| SELECT 星号 | B3 | rule-based | Mapper.xml.tmpl 的 BaseColumns |
| 美元花括号注入 | B4 | rule-based | 改 #{} + jdbcType |
| 缺 @Transactional | B5 | rule-based | Service.java.tmpl |
| 裸 RuntimeException | B8 | rule-based | 改 ServiceAssert / ServiceException |
| 缺 COMPANY_ID | B7 | 🔴 必修 | Mapper.xml.tmpl 软删+租户 |
| 业务语义偏差 | 综合 | **不修复，标记人工** | — |

> 修复时**读 templates 对应骨架**对齐结构，而非凭记忆改（防止修出新的不规范）。

## 受控原则（严格执行）

| 原则 | 说明 |
|---|---|
| 不修 🔴 之外的业务逻辑 | 严重偏差按模板修，业务逻辑偏差标人工 |
| 不破坏功能 | 只改报告点名的行，不顺手重构周边 |
| 不批量盲改 | 每文件首个补丁先 diff 预览，确认范式后才批量 |
| 不生成新逻辑 | 只修偏差，功能补全是 service-codegen 的职责 |
| DDL 违规转交 db-migration | 表结构变更不在本 Skill |

## 产物

- 源码补丁（直接改文件）
- `reports/FIX_BE_{ts}.md`：修复清单 + 影响面 + **复扫结果**

## 完成摘要

```
✅ code-fix-be 完成
   - 修复文件: N 个
   - 🔴 已修: A / A
   - 🟡 已修: B / C
   - 🟢 跳过: D（backlog）
   - 报告: reports/FIX_BE_{ts}.md

## 复扫验证（不可跳过）
   - 执行: wl-skills-bd validate {涉及文件}
   - error: 0 / warn: {N}
   - 结论: ✔ 闭环完成，可安全提交 / ✖ 残余 N 项待处理

## 下一步建议
   - 复扫通过 → git add + git commit（按 18-git-commit 规范）
   - 复扫未过 → 继续 code-fix-be 或人工
```

## 变更记录
- 2026-07-17 v0.2 落地强制复扫闭环 + 接 templates + validate（对标 kit/code-fix）
- 2026-05-14 v0.0.1 骨架
