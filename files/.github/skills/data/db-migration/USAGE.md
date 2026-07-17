# 使用指南：DDL 与数据迁移（db-migration）

> ⚠️ 当前 SKILL.md 仍为骨架，触发时按 **standards/12（含 §0.5 物理库归属）** 落地。MCP DB 工具待集成。

## 触发词

```
建表 / DDL / 表结构变更 / 字段新增 / 迁移脚本 / 回滚脚本
```

## 典型场景

### 场景 A：新表建表（最常见）

```
用户：给特征量分类建表 MDM_FEATURE_CATEGORY
AI：  → 读 standards/12（字段类型/审计字段/索引/注释）
      → ★ 选库决策（§0.5：产销库/非产销库/平台库/MDM Oracle 特例）
      → 产出 reports/DDL_PREVIEW_{ts}.md
      → 🔴 等用户人工确认后才生成 V{ts}__create_xxx.sql + 回滚脚本
```

### 场景 B：存量表加字段

```
用户：给 MDM_FEATURE_CATEGORY 加个 STATUS 字段
AI：  → 生成 ALTER TABLE + 回滚（DROP COLUMN）
      → 🔴 人工确认
```

### 场景 C：方言差异

| 维度 | Oracle | MySQL |
|------|--------|-------|
| 自增 | SEQUENCE + 触发器 | AUTO_INCREMENT |
| 注释 | `COMMENT ON COLUMN` 单独语句 | `COMMENT '...'` 行内 |
| VARCHAR | `VARCHAR2(N CHAR)` | `VARCHAR(N)` |

## 红线

- 🔴 **必须人工确认** DDL_PREVIEW 才执行（防误建表/选错库）
- 🔴 选库决策必填（三库归属表 + MDM Oracle 特例）
- 🔴 必含回滚脚本
- 🔴 含审计字段（COMPANY_ID/IS_DELETE/REVISION/create*/update*）
- 🔴 含索引 + 注释

## 预期产物

```
db/migration/V{ts}__create_{table}.sql
db/migration/V{ts}__rollback.sql
reports/DDL_PREVIEW_{ts}.md      ← 含选库决策，人工确认用
```

## FAQ

**Q：为什么必须人工确认？**
A：DDL 不可逆（DROP TABLE 数据没了），且选错库是生产事故。参考 kit 同款红线。

**Q：MCP DB 工具什么时候上？**
A：roadmap。当前手抄 DDL（读 Entity 反向生成）。
