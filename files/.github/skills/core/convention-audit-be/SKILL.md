---
name: convention-audit-be
description: |
  后端规范全量审计。按 14 条 standards 检查工程，输出 reports/AUDIT_BE_{ts}.md，
  按严重度分级（🔴 阻断 / 🟡 警告 / 🟢 建议），定位到文件 + 行号 + 违规条款。
  典型触发：「规范审计」「代码体检」「全量扫描」「检查代码」「代码质量」
status: 🟡 骨架
stage: ⑧ 审计
---

# convention-audit-be

## Pre-flight 声明（必填）

```
🚀 已触发技能 convention-audit-be/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 E
✅ 已读取 standards/02 ~ standards/14    → 审计依据
```

## 前置检查

- [ ] 目标工程根目录可达
- [ ] 工程结构符合 jh4j-cloud 体系（否则降级为通用审计）

## 检查项矩阵（按 standards 编号）

| 编号 | 检查项                                          | 严重度 |
| ---- | ----------------------------------------------- | ------ |
| 02   | 包结构 / 分层 / 跨层调用                        | 🔴     |
| 03   | 类名 / 方法名 / 字段命名                        | 🟡     |
| 04   | Controller 缺 `@PreAuthorize` / `@ApiOperation` | 🔴/🟡  |
| 05   | Service 写操作缺 `@Transactional`               | 🔴     |
| 05   | 业务异常 `throw new RuntimeException`            | 🟡     |
| 06   | XML 出现 `SELECT *`                             | 🔴     |
| 06   | XML 使用 `${}` 拼接                             | 🔴     |
| 06   | XML 缺 `jdbcType`                               | 🟢     |
| 07   | DTO/VO/Entity 互相 extends                      | 🟡     |
| 08   | 缺全局异常处理器                                | 🟡     |
| 09   | 日志字符串拼接                                  | 🟢     |
| 10   | 事务方法调用外部 Feign                          | 🟡     |
| 11   | SELECT 缺 `COMPANY_ID` 条件                     | 🔴     |
| 12   | DDL 缺审计字段 / 索引 / 注释                    | 🟡     |
| 13   | Controller / DTO 缺 Swagger 注解                | 🟢     |
| 14   | Service 单测覆盖率 < 70%                        | 🟢     |

## 产物

`reports/AUDIT_BE_{yyyymmdd_HHmm}.md`，含：

1. **总览**：扫描文件数 / 违规总数 / 🔴/🟡/🟢 分布
2. **按文件**：违规清单（行号 + 条款编号 + 一句话建议）
3. **按规范条款**：聚合视图
4. **修复建议**：是否走 `code-fix-be` Skill

## 约束

- **只读**，不写代码
- 不要建议跳过任何 🔴 项
- 输出报告本身用 Markdown 表格，避免长篇散文

## 完成摘要

```
✅ convention-audit-be 完成
   - 扫描文件: N
   - 🔴 阻断: A 项
   - 🟡 警告: B 项
   - 🟢 建议: C 项
   - 报告: reports/AUDIT_BE_{ts}.md
   - 下一步建议: ⑨ code-fix-be（如有 🔴 项）
```
