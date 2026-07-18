# 使用指南：db-migration

> CREATE/ALTER/索引 已由契约 codegen 自动生成（v0.9）。包不连接数据库或执行 DDL。复杂回填和跨库数据迁移仍需人工设计。

## 新资源 CREATE

在 `wl-contract.json` 中明确数据库类型、dbCluster（cx/non_cx/pt）、迁移版本、验证 SQL、恢复策略和字段，再执行：

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json
wl-skills-bd db preview wl-contract.json          # 只读预览 DDL + Expand-Contract 阶段
```

计划会包含正向 `V...__create_*.sql` 和 `db/rollback-manual/*.md`。恢复文件是审批材料，不进入 Flyway V location，不保证数据无损逆转。

## ALTER TABLE（v0.9 已自动生成）

契约声明 `alter{}` 字段后，codegen 自动生成 ALTER 迁移 SQL（add/drop/modify）+ Rollback.md 含 Expand-Contract 阶段标注：

```json
{
  "alter": {
    "version": "20260719_100000",
    "rollbackStrategy": "...",
    "verificationSql": ["SELECT ..."],
    "operations": [
      { "type": "add", "field": { "name": "priority", "column": "PRIORITY", ... } },
      { "type": "modify", "column": "REMARK", "dbType": "VARCHAR2(500 CHAR)", ... }
    ]
  }
}
```

生成的 migration 文件名：`V{version}__alter_{table}_{add_modify}.sql`，不再生成 CREATE TABLE。

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
