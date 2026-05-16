# Backend Skills Pipeline（产物契约 v0.0.1）

> 用于多步骤任务的输入 / 输出 / 下一步建议。AI 完成一个 Skill 必须输出 `next_suggest` 给用户选择。

---

## 阶段总览

```
② api-design-be          ──► docs/api/{module}.md（团队 API 契约 + 权限码清单）
③ entity-codegen         ──► xxx-entity/api/{entity,dto,vo,query}/*.java
④ service-codegen        ──► xxx-service/controller + service + impl
⑤ mapper-xml-gen         ──► xxx-service/mapper/*.java + resources/mapper/*.xml
⑥ db-migration           ──► db/migration/V{ts}__xxx.sql + V{ts}__rollback.sql
⑦ unit-test-gen          ──► xxx-service/src/test/java/.../*Test.java
⑧ convention-audit-be    ──► reports/AUDIT_BE_{ts}.md
⑨ code-fix-be            ──► 补丁直接修改源码 + 复扫报告
```

预阶段：

- `business-doc-extract-be` ──► `docs/business/{module}.md`（业务背景 / 字段语义 / 状态机）

---

## 产物契约（输入 / 输出 / 下一步）

### ② api-design-be

```yaml
input_from:
  - 前端 wl-skills-kit 产出: src/views/{module}/api.md
  - 业务文档: docs/business/{module}.md（可选）
output_file: docs/api/{module}.md
output_contains:
  - HTTP 方法 + 路径
  - 入参 DTO + 出参 VO 字段
  - 权限码 mdm_xxx_yyy_zzz
  - 同前端 api.md 的 diff 摘要
next_suggest: ③ entity-codegen
```

### ③ entity-codegen

```yaml
input_from: docs/api/{module}.md
output_files:
  - xxx-entity/.../entity/{Entity}.java
  - xxx-entity/.../dto/{Entity}DTO.java + {Entity}PageDTO.java
  - xxx-entity/.../vo/{Entity}VO.java + {Entity}PageVO.java
next_suggest: ④ service-codegen
```

### ④ service-codegen

```yaml
input_from:
  - docs/api/{module}.md
  - xxx-entity/.../{entity,dto,vo}/*.java
output_files:
  - xxx-service/.../controller/{Entity}Controller.java
  - xxx-service/.../service/{Entity}Service.java
  - xxx-service/.../service/impl/{Entity}ServiceImpl.java
next_suggest: ⑤ mapper-xml-gen
```

### ⑤ mapper-xml-gen

```yaml
input_from: xxx-entity/.../entity/{Entity}.java
output_files:
  - xxx-service/.../mapper/{Entity}Mapper.java
  - xxx-service/src/main/resources/mapper/{Entity}Mapper.xml
next_suggest: ⑥ db-migration（如果是新表/新字段）
```

### ⑥ db-migration

```yaml
input_from: xxx-entity/.../entity/{Entity}.java
output_files:
  - db/migration/V{ts}__create_{table}.sql
  - db/migration/V{ts}__rollback.sql
  - reports/DDL_PREVIEW_{ts}.md
gate: 🔴 必须人工确认 reports/DDL_PREVIEW_{ts}.md 后才允许执行
next_suggest: ⑦ unit-test-gen
```

### ⑦ unit-test-gen

```yaml
input_from: xxx-service/.../service/impl/{Entity}ServiceImpl.java
output_files:
  - xxx-service/src/test/java/.../{Entity}ServiceImplTest.java
  - xxx-service/src/test/java/.../{Entity}ControllerTest.java
next_suggest: ⑧ convention-audit-be
```

### ⑧ convention-audit-be

```yaml
input_from: 整个工程或指定 module
output_file: reports/AUDIT_BE_{ts}.md
output_contains:
  - 违规清单（按 standards/ 14 条分类）
  - 严重度（🔴 阻断 / 🟡 警告 / 🟢 建议）
  - 修复建议
next_suggest: ⑨ code-fix-be（如有 🔴 项）
```

### ⑨ code-fix-be

```yaml
input_from: reports/AUDIT_BE_{ts}.md
output: 直接补丁 + reports/FIX_BE_{ts}.md
gate: 🟡 修改前展示 diff，等待确认；DDL 类违规走 ⑥
next_suggest: 复扫 ⑧
```

---

## 编排约束

- 不允许跳级（如直接 ⑤ 跳过 ③/④），除非用户明确说"只生成 Mapper"
- 跨 Skill 必须**显式输出 `next_suggest`**
- 每一步都必须 Pre-flight 声明已加载的 standards
