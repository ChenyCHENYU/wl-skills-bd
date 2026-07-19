# 使用指南：db-migration

> CREATE、受限 ALTER 和索引由契约 codegen 自动生成。包只写工程内 migration/评审材料，不连接数据库或执行 DDL；复杂回填和跨库数据迁移仍需人工设计。

## 新资源 CREATE

在 `wl-contract.json` 中明确数据库类型、dbCluster（cx/non_cx/pt）、迁移版本、验证 SQL、恢复策略和字段，再执行：

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json
wl-skills-bd db preview wl-contract.json          # 只读预览 DDL + Expand-Contract 阶段
```

计划会包含正向 `V...__create_*.sql` 和 `db/rollback-manual/*.md`。恢复文件是审批材料，不进入 Flyway V location，不保证数据无损逆转。

## ALTER TABLE（v0.14 分阶段门禁）

expand 版本只做兼容扩展：

```json
{
  "alter": {
    "version": "20260719_100000",
    "phase": "expand",
    "rollbackStrategy": "...",
    "verificationSql": ["SELECT ..."],
    "operations": [
      { "type": "add", "field": { "name": "priority", "column": "PRIORITY", "javaType": "Integer", "dbType": "NUMBER(10)", "comment": "优先级" } },
      { "type": "modify", "column": "REMARK", "fromDbType": "VARCHAR2(200 CHAR)", "dbType": "VARCHAR2(500 CHAR)", "compatibility": "widening", "comment": "备注" }
    ],
    "indexes": [{ "name": "IDX_ORDER_PRIORITY", "columns": ["COMPANY_ID", "PRIORITY"] }]
  }
}
```

删除旧列必须放在后续独立 contract 版本，且提供审批号：

```json
{
  "alter": {
    "version": "20260726_100000",
    "phase": "contract",
    "approvalRef": "DBA_CHANGE_20260726",
    "rollbackStrategy": "已完成快照并保留旧应用版本，失败按审批单恢复列与数据",
    "verificationSql": ["SELECT COUNT(*) FROM SALE_ORDER WHERE LEGACY_FIELD IS NOT NULL"],
    "operations": [{ "type": "drop", "column": "LEGACY_FIELD" }]
  }
}
```

生成的 migration 文件名为 `V{version}__alter_{table}_*.sql`，并同步生成 Rollback.md 与 DDL_PREVIEW。`verificationSql` 只允许无副作用 SELECT。

## 复杂回填/跨库迁移（仍需人工）

至少评审：锁表窗口、存量数据量、默认值与 NULL 策略、兼容发布顺序、索引代价、分批/幂等条件、验证 SQL、失败后的 roll-forward 或数据恢复。推荐 expand → 双读/双写或回填 → 验证 → contract 的分阶段迁移，不自动生成 DROP 型回滚。

## 方言边界

| 维度 | Oracle | MySQL |
|---|---|---|
| 字符串 | `VARCHAR2(N CHAR)` | `VARCHAR(N)` |
| 自增 | 团队序列/主键策略 | 团队主键策略或 AUTO_INCREMENT |
| 注释 | 独立 `COMMENT ON` | 列/表定义内 COMMENT |
| 布尔 | 数字/字符约定 | TINYINT/数字约定 |

以契约 Profile 与 standards/12 为准，禁止把一种方言的 SQL 直接复制到另一种数据库。

## 验收

1. 人工评审目标库、SQL、索引和恢复策略；
2. 在受控测试环境执行正向脚本；
3. 执行契约中的 verification SQL 和业务回归；
4. 由 DBA/CD 审批生产执行；
5. 失败时按已审批方案处置并留审计记录。

任何步骤都不得因“AI 已生成”而跳过。

## 变更记录

- 2026-07-18 v0.14：补充 expand/contract 契约示例、approvalRef、widening 和 ALTER 索引边界。
