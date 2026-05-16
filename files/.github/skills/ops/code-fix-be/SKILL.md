---
name: code-fix-be
description: |
  根据 convention-audit-be 输出的 AUDIT_BE_{ts}.md 修复违规。修复前展示 diff，逐项确认，
  DDL 类违规走 db-migration Skill，跨表跨服务变更必须列出影响面。
  典型触发：「修复规范问题」「按审计报告改」「修违规」「批量改」
status: 🟡 骨架
stage: ⑨ 修复
risk: 🟡 中风险（写代码，需 diff 预览）
---

# code-fix-be

## Pre-flight 声明（必填）

```
🚀 已触发技能 code-fix-be/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 E + H
✅ 已读取 reports/AUDIT_BE_{ts}.md       → 输入源
⚠️ 写代码操作：每个补丁先展示 diff，逐项确认
```

## 前置检查

- [ ] `reports/AUDIT_BE_{ts}.md` 存在
- [ ] 涉及 DDL 的违规：转交 `db-migration`，不在本 Skill 处理
- [ ] 跨服务 / 跨模块影响面已识别

## 修复策略

| 严重度 | 处理方式                                        |
| ------ | ----------------------------------------------- |
| 🔴     | 必修，逐项 diff 确认                            |
| 🟡     | 默认修，可批量但分类展示                        |
| 🟢     | 默认不修，列入 backlog，用户主动要求时再修      |

## 典型修复模式

- **缺 `@PreAuthorize`** → 按命名规则补权限码，提示同步到 `SYS_PERMISSION_INFO.md`
- **缺 `@Transactional`** → 在 Service 写方法补 `@Transactional(rollbackFor = Exception.class)`
- **`SELECT *`** → 用 Entity 字段列生成 `<sql id="BaseColumns">` 替换
- **`${x}` 拼接** → 改为 `#{x,jdbcType=VARCHAR}`
- **业务异常 `throw new RuntimeException`** → 替换为 `ServiceAssert` 或 `ServiceException`
- **缺 `IS_DELETE = 1`** → 给 select 补软删除条件
- **缺 `COMPANY_ID` 过滤** → 🔴 必修，跨租户风险

## 产物

- 源码补丁（直接修改文件）
- `reports/FIX_BE_{ts}.md`：修复清单 + 影响面 + 风险

## 约束

- **每个文件第一个补丁先展示 diff**，等待用户确认范式无误
- 同类批量修复确认范式后可批量执行
- 修复后**必须建议复扫**（再跑 `convention-audit-be`）
- DDL 类违规一律转交 `db-migration`

## 完成摘要

```
✅ code-fix-be 完成
   - 修复文件: N 个
   - 🔴 已修: A / A
   - 🟡 已修: B / C
   - 🟢 跳过: D（已列入 backlog）
   - 报告: reports/FIX_BE_{ts}.md
   - 下一步建议: ⑧ convention-audit-be 复扫
```
