---
name: db-migration
description: |
  数据库 DDL 与数据迁移生成。CREATE TABLE / ALTER TABLE（v0.9 自动生成）/ expand-contract / 有界数据回填 + 人工回退方案。
  生成后输出 reports/DDL_PREVIEW_{ts}.md 等待人工确认，AI 不直接执行。
  典型触发：「建表」「DDL」「ALTER TABLE」「加字段」「索引」「数据迁移」
status: 🟡 部分（CREATE/ALTER/索引已自动生成；复杂数据迁移/回填仍骨架）
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
db/migration/V{yyyymmdd_HHmm}__{action}_{table}.sql      ← 正向 Flyway migration
db/rollback-manual/{yyyymmdd_HHmm}__{action}_{table}.md   ← 审批后的人工处置说明，不进入 Flyway V location
reports/DDL_PREVIEW_{yyyymmdd_HHmm}.md                    ← 人工确认材料
```

## 产物模板

**CREATE TABLE 必含**：

- 业务字段
- ID 加七个治理字段：`COMPANY_ID / IS_DELETE / REVISION / CREATE_USER_NO / CREATE_DATE_TIME / UPDATE_USER_NO / UPDATE_DATE_TIME`
- 主键约束
- 索引：按真实查询谓词设计联合索引；软删唯一性必须使用 Profile 声明的 delete-token/部分索引/恢复策略
- 每列 `COMMENT ON COLUMN`
- 表 `COMMENT ON TABLE`

**ALTER TABLE 注意**：

- 新增字段：是否必填？若必填且有存量数据，需要回填脚本
- 删除字段：必须先备份 → DROP；ROLLBACK 要能 ADD 回来（含数据回填）
- 修改字段类型：先评估存量数据兼容性

**人工回退方案必须说明**：

- DROP TABLE（CREATE 的反向）
- ALTER TABLE DROP COLUMN（ADD 的反向）+ 数据恢复
- ALTER TABLE MODIFY 回原类型

## 🔴 强制人工确认

```
⛔ DDL 生成完毕，已写入：
   - db/migration/V{ts}__create_xxx.sql
   - db/rollback-manual/{ts}__rollback.md
   - reports/DDL_PREVIEW_{ts}.md

请人工执行以下步骤：
1. 评审 reports/DDL_PREVIEW_{ts}.md
2. 在测试环境执行正向脚本
3. 验证业务无回归后由 DBA / CD 流水线执行生产环境
4. 失败时按已审批的恢复/roll-forward/人工回退方案处置

AI 不会直接执行任何 DDL。
```

## 约束

- 一切 DDL 必有恢复方案；禁止把反向 SQL 命名为 Flyway `V...__rollback.sql`
- VARCHAR2 必用 `CHAR` 语义
- 索引名 `IDX_{T}_xxx` / `UK_{T}_xxx`，不允许默认名
- 触发器 / 序列 / 外键由 DBA 评审后决定（团队基线**不推荐**外键约束）
- 生产数据迁移必须使用稳定游标/主键范围循环、批次进度、幂等和总量校验；禁止单次 `ROWNUM <= 1000` 后误报完成

## 完成摘要

```
✅ db-migration 完成（已生成，未执行）
   - 正向脚本: db/migration/V{ts}__xxx.sql
   - 回退方案: db/rollback-manual/{ts}__rollback.md
   - 预览报告: reports/DDL_PREVIEW_{ts}.md
   - 下一步: 🔴 人工评审后由 DBA / CD 执行
```
