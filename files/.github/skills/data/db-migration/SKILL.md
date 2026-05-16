---
name: db-migration
description: |
  数据库 DDL 与数据迁移生成。CREATE TABLE / ALTER TABLE / 数据回填脚本 + 配套 ROLLBACK。
  生成后输出 reports/DDL_PREVIEW_{ts}.md 等待人工确认，AI 不直接执行。
  典型触发：「建表」「DDL」「ALTER TABLE」「加字段」「索引」「数据迁移」
status: 🟡 骨架
stage: ⑥ 数据库
risk: 🔴 高风险（必经人工确认）
---

# db-migration

## Pre-flight 声明（必填）

```
🚀 已触发技能 db-migration/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 D
✅ 已读取 standards/12-database-ddl.md   → 建表规则
✅ 已读取 standards/11-security-permission.md → 租户字段强制
⚠️ 高风险操作：将生成预览文件，等待人工确认
```

## 前置检查

- [ ] Entity 已存在（建表场景）或字段映射已明确（ALTER 场景）
- [ ] 业务唯一键已确认（用于建唯一索引）

## 产物

```
db/migration/V{yyyymmdd_HHmm}__{action}_{table}.sql      ← 正向 DDL
db/migration/V{yyyymmdd_HHmm}__rollback.sql               ← 回滚
reports/DDL_PREVIEW_{yyyymmdd_HHmm}.md                    ← 人工确认材料
```

## 产物模板

**CREATE TABLE 必含**：

- 业务字段
- 审计 7 件套：`COMPANY_ID / IS_DELETE / REVISION / CREATE_USER_NO / CREATE_DATE_TIME / UPDATE_USER_NO / UPDATE_DATE_TIME`
- 主键约束
- 索引：`IDX_{T}_COMPANY` / `IDX_{T}_DELETE` / 业务唯一索引（含 IS_DELETE）
- 每列 `COMMENT ON COLUMN`
- 表 `COMMENT ON TABLE`

**ALTER TABLE 注意**：

- 新增字段：是否必填？若必填且有存量数据，需要回填脚本
- 删除字段：必须先备份 → DROP；ROLLBACK 要能 ADD 回来（含数据回填）
- 修改字段类型：先评估存量数据兼容性

**ROLLBACK 必须能**：

- DROP TABLE（CREATE 的反向）
- ALTER TABLE DROP COLUMN（ADD 的反向）+ 数据恢复
- ALTER TABLE MODIFY 回原类型

## 🔴 强制人工确认

```
⛔ DDL 生成完毕，已写入：
   - db/migration/V{ts}__create_xxx.sql
   - db/migration/V{ts}__rollback.sql
   - reports/DDL_PREVIEW_{ts}.md

请人工执行以下步骤：
1. 评审 reports/DDL_PREVIEW_{ts}.md
2. 在测试环境执行正向脚本
3. 验证业务无回归后由 DBA / CD 流水线执行生产环境
4. 失败时执行 rollback.sql 回滚

AI 不会直接执行任何 DDL。
```

## 约束

- 一切 DDL 必有 ROLLBACK 配对
- VARCHAR2 必用 `CHAR` 语义
- 索引名 `IDX_{T}_xxx` / `UK_{T}_xxx`，不允许默认名
- 触发器 / 序列 / 外键由 DBA 评审后决定（团队基线**不推荐**外键约束）
- 涉及生产数据迁移的脚本必须分批 `WHERE ROWNUM <= 1000` + COMMIT，避免锁表

## 完成摘要

```
✅ db-migration 完成（已生成，未执行）
   - 正向脚本: db/migration/V{ts}__xxx.sql
   - 回滚脚本: db/migration/V{ts}__rollback.sql
   - 预览报告: reports/DDL_PREVIEW_{ts}.md
   - 下一步: 🔴 人工评审后由 DBA / CD 执行
```
