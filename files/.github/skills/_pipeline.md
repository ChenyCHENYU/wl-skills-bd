# Backend Skills Pipeline（产物契约 v0.1）

> 用于多步骤任务的输入 / 输出 / 下一步建议。AI 完成一个 Skill 必须输出 `next_suggest` 给用户选择。
> 完整生成闭环与验证/修复机制详见 `../guides/codegen-workflow.md`。

---

## 阶段总览

```
api.md（前端 wl-skills-kit 契约）── 唯一权威输入
  │
  ▼
② api-design-be          ──► docs/api/{module}.md（团队 API 契约 + 权限码清单）
  │
  ▼
③ entity-codegen         ──► xxx-entity/api/{entity,dto,vo}/*.java（5 文件）
  │
  ▼
④ service-codegen        ──► xxx-service/controller + service（团队基线无独立接口，直继 JhServiceImpl）
  │
  ▼
⑤ mapper-xml-gen         ──► xxx-service/mapper/*.java + resources/mapper/*.xml
  │
  ▼
⑥ db-migration           ──► db/migration/V{ts}__xxx.sql + V{ts}__rollback.sql（🔴 人工确认）
  │
  ▼
⑦ unit-test-gen          ──► xxx-service/src/test/java/.../*Test.java
  │
  ▼
⑧ convention-audit-be    ──► reports/AUDIT_BE_{ts}.md（按 standards 19 条 + be-rules B1~B11）
  │
  ▼
⑨ code-fix-be            ──► 补丁直接修改源码 + ★ 强制复扫报告
```

预阶段：

- `business-doc-extract-be` ──► `docs/business/{module}.md`（业务背景 / 字段语义 / 状态机）

---

## 横切 ops Skill（独立于主线 ②-⑨，可随时触发）

- `standard-env-config-be` ──► 本地启动模板 + K8s 四环境清单标准化 + 冲突/漂移检测（写配置，dry-run + 备份 + 幂等闭环）
  - 不消费/不产出上述任何主线产物；与前端 `wl-skills-kit/standard-env-config` 职责对称、对象不同（后端管 bootstrap.yml + K8s yaml）

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
  - 权限码 {module}_{resource}_{action}
  - 同前端 api.md 的 diff 摘要
gate: 🔴 缺 api.md 时 codegen 拒绝执行（防发明字段）
next_suggest: ③ entity-codegen
```

### ③ entity-codegen

```yaml
input_from: docs/api/{module}.md
output_files:
  - xxx-entity/.../entity/{module}/{Entity}.java
  - xxx-entity/.../dto/{module}/{Entity}DTO.java + {Entity}PageDTO.java
  - xxx-entity/.../vo/{module}/{Entity}VO.java + {Entity}PageVO.java
mechanism: 读 templates/Entity.java.tmpl 等填空（非自由发挥）
self_check: wl-skills-bd validate（B9 类长度 / B10 方法长度）
next_suggest: ④ service-codegen
```

### ④ service-codegen

```yaml
input_from:
  - docs/api/{module}.md
  - xxx-entity/.../{entity,dto,vo}/*.java
output_files:
  - xxx-service/.../controller/{module}/{Entity}Controller.java
  - xxx-service/.../service/{module}/{Entity}Service.java   ← extends JhServiceImpl<Mapper, Entity>（团队基线无独立接口）
mechanism: 读 templates/Controller.java.tmpl + Service.java.tmpl 填空
self_check: wl-skills-bd validate（B1 缺@PreAuthorize / B2 缺@ApiOperation / B5 缺@Transactional / B8 裸异常 / B9/B10/B11 设计级）
next_suggest: ⑤ mapper-xml-gen
```

### ⑤ mapper-xml-gen

```yaml
input_from: xxx-entity/.../entity/{Entity}.java
output_files:
  - xxx-service/.../mapper/{module}/{Entity}Mapper.java
  - xxx-service/src/main/resources/mapper/{module}/{Entity}Mapper.xml
mechanism: 读 templates/Mapper.java.tmpl + Mapper.xml.tmpl 填空
self_check: wl-skills-bd validate（B3 SELECT星号 / B4 美元符注入 / B7 缺COMPANY_ID）
next_suggest: ⑥ db-migration（如果是新表/新字段）
```

### ⑥ db-migration

```yaml
input_from: xxx-entity/.../entity/{Entity}.java
output_files:
  - db/migration/V{ts}__create_{table}.sql
  - db/migration/V{ts}__rollback.sql
  - reports/DDL_PREVIEW_{ts}.md
gate: 🔴 必须人工确认 reports/DDL_PREVIEW_{ts}.md（含选库决策：三库归属 + MDM Oracle 特例）后才允许执行
next_suggest: ⑦ unit-test-gen
```

### ⑦ unit-test-gen

```yaml
input_from: xxx-service/.../service/{module}/{Entity}Service.java
output_files:
  - xxx-service/src/test/java/.../{Entity}ServiceTest.java
  - xxx-service/src/test/java/.../{Entity}ControllerTest.java
next_suggest: ⑧ convention-audit-be
```

### ⑧ convention-audit-be

```yaml
input_from: 整个工程或指定 module
output_file: reports/AUDIT_BE_{ts}.md
output_contains:
  - 违规清单（按 standards/ 19 条 + be-rules B1~B11 分类）
  - 严重度（🔴 阻断 / 🟡 警告 / 🟢 建议）
  - 执行器覆盖：be-rules + ArchUnit(J1) + Checkstyle(J2) + PMD/P3C(J3/J6) + SpotBugs(J4) + Spotless(J5)
  - 修复建议（标 rule-based / ai-based / 人工）
mode: 全量 或 --quick 复扫（仅查上次偏差）
next_suggest: ⑨ code-fix-be（如有 🔴 项）
```

### ⑨ code-fix-be

```yaml
input_from: reports/AUDIT_BE_{ts}.md
output: 直接补丁 + reports/FIX_BE_{ts}.md
gate: 🟡 修改前展示 diff，等待确认；DDL 类违规走 ⑥
closure: ★ 强制复扫（不可跳过）：修复后跑 validate，输出 error:0/变化矩阵
next_suggest: error=0 → 可提交（按 18-git-commit）；仍有 error → 继续 code-fix-be
```

---

## 编排约束

- 不允许跳级（如直接 ⑤ 跳过 ③/④），除非用户明确说"只生成 Mapper"
- 跨 Skill 必须**显式输出 `next_suggest`**
- 每一步都必须 Pre-flight 声明已加载的 standards（19 条按任务类型懒加载）
- 每一步生成后**必须跑 self_check**（wl-skills-bd validate 对应规则）

## 变更记录
- 2026-07-17 v0.1 计数同步 19 条；③④⑤ 加 templates/self_check；⑧⑨ 执行器清单补全；impl 拆分按团队基线澄清
- 2026-05-14 v0.0.1 初始
