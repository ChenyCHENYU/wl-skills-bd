# 后端代码生成闭环（权威文档）

> 本文档是 **生成后端代码的唯一权威流程**。AI 触发任何 codegen Skill 前必读，用户发起"生成一个菜单/接口"时按本流程闭环。
>
> 三个闭环：① 生成顺序闭环 ② 验证闭环 ③ 修复闭环。
>
> 关联：`skills/_pipeline.md`（产物契约）、`standards/index.md`（19 条规范）、`lib/be-rules.js`（B1~B11 执行器）。

---

## 闭环一：生成顺序（8 阶段，严格不跳级）

### 唯一权威输入

```
前端 wl-skills-kit 产出: src/views/{module}/api.md
                          ↓
后端落地:                docs/api/{module}.md   （api-design-be 评审后的团队契约）
```

**铁律**：没有 `api.md` 不生成任何代码。缺则先触发 ② api-design-be（或回退前端补契约）。防 AI 发明字段。

### 完整流水线

```
api.md
  ↓
②  api-design-be      评审契约 + 落权限码     → docs/api/{module}.md
  ↓
③  entity-codegen     Entity/DTO/VO (5文件)   读 templates 填空
  ↓
④  service-codegen    Controller+Service (2文件)
  ↓
⑤  mapper-xml-gen     Mapper.java+XML (2文件)
  ↓
⑥  db-migration       DDL+回滚 (3文件)        🔴 人工确认才执行
  ↓
⑦  unit-test-gen      ServiceTest+ControllerTest (2文件)
  ↓
⑧  convention-audit-be  全量审计             → AUDIT_BE_{ts}.md
  ↓
⑨  code-fix-be        修复 → ★强制复扫        → FIX_BE_{ts}.md
  ↓
✅ 可提交（按 18-git-commit）
```

### 一个菜单的完整文件清单（以"特征量分类 CRUD"为例，14 文件）

| 阶段 | 模块 | 文件 | 数量 |
|:---:|------|------|:---:|
| ③ | entity | `entity/feature/MdmFeatureCategory.java` | 1 |
| ③ | entity | `dto/feature/MdmFeatureCategoryDTO.java` | 1 |
| ③ | entity | `dto/feature/MdmFeatureCategoryPageDTO.java` | 1 |
| ③ | entity | `vo/feature/MdmFeatureCategoryVO.java` | 1 |
| ③ | entity | `vo/feature/MdmFeatureCategoryPageVO.java` | 1 |
| ④ | service | `controller/feature/MdmFeatureCategoryController.java` | 1 |
| ④ | service | `service/feature/MdmFeatureCategoryService.java`（extends JhServiceImpl）| 1 |
| ⑤ | service | `mapper/feature/MdmFeatureCategoryMapper.java` | 1 |
| ⑤ | service | `resources/mapper/feature/MdmFeatureCategoryMapper.xml` | 1 |
| ⑥ | db | `V{ts}__create_mdm_feature_category.sql` + 回滚 + DDL_PREVIEW | 3 |
| ⑦ | test | `MdmFeatureCategoryServiceTest.java` + `ControllerTest.java` | 2 |

> **团队基线**：Service 直继 `JhServiceImpl<Mapper, Entity>`，**无独立接口层**（省一层）。生成时别自作主张加 `{Entity}Service` 接口 + `impl/` 目录。

### 每阶段的"防胶水"机制

| 阶段 | 读模板 | self_check | 卡点 |
|:---:|:---:|:---:|------|
| ③ | `templates/Entity.java.tmpl` 等 | validate B9/B10 | 字段类型映射决策表 |
| ④ | `templates/Controller.java.tmpl` + `Service.java.tmpl` | validate B1/B2/B5/B8/B9/B10/B11 | 权限码命名、状态变更四段式 |
| ⑤ | `templates/Mapper.java.tmpl` + `Mapper.xml.tmpl` | validate B3/B4/B7 | 禁 SELECT *、禁 ${} 注入 |
| ⑥ | `templates/` 无（db-migration 消费 Entity 反向生成）| 人工 | 🔴 选库决策（三库归属）|
| ⑦ | （骨架阶段）| — | 覆盖红线 |

---

## 闭环二：验证（三层兜底，绝不靠 AI 自觉）

### 层 1：生成后即时自检（be-rules B1~B11）

每个 codegen Skill 完成后，**必须**跑：

```bash
wl-skills-bd validate src/main/java/.../feature     # 按生成范围
# 或 MCP: wls_be_validate
```

| 规则 | 查什么 | 级别 |
|:---:|------|:---:|
| B1 | Controller 接口缺 @PreAuthorize | error |
| B2 | Controller 缺 @ApiOperation | warn |
| B3 | Mapper XML SELECT 星号 | error |
| B4 | Mapper XML 美元符注入 | error |
| B5 | 写操作缺 @Transactional | warn |
| B6 | 单目录文件 >20 | warn/error |
| B7 | SELECT 缺 COMPANY_ID | warn |
| B8 | 裸 RuntimeException | warn |
| **B9** | **类长度 >500（上帝类）** | **error** |
| **B10** | **方法长度 >80（长方法）** | warn/error |
| **B11** | **圈复杂度 >10** | warn/error |

有 **error 非 0** → 进闭环三（修复）。warn 可暂存，但建议本批清。

### 层 2：全量审计（convention-audit-be ⑧）

触发词"后端审计/代码体检"，跑完整 19 条 + be-rules + 委托 Java 工具：

```bash
wl-skills-bd validate                  # be-rules 全量
mvn checkstyle:check                   # J2 命名/风格/Javadoc
mvn pmd:check                          # J3 + J6 阿里 P3C 54 条
mvn spotbugs:check                     # J4 字节码
mvn test -Dtest=LayerRulesTest         # J1 架构分层
mvn spotless:check                     # J5 格式
```

输出 `reports/AUDIT_BE_{ts}.md`，按 🔴/🟡/🟢 分级。

### 层 3：CI 硬卡（最后一道）

`mvn clean verify` 自动跑 Checkstyle + PMD/P3C + SpotBugs + ArchUnit + Spotless + 测试，任一违规 build failure。

### 验证覆盖矩阵（19 条规范 × 执行器）

| 规范 | be-rules | Checkstyle J2 | PMD J3 | P3C J6 | SpotBugs J4 | ArchUnit J1 | Spotless J5 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 02 分层 | B6 | | | | | **J1** | |
| 04 Controller | **B1/B2** | | | | | | |
| 06 Mapper | **B3/B4/B7** | | | | | | |
| 08 异常 | **B8** | | P3C | | | | |
| 10 事务 | **B5** | | | | | | |
| 11 安全 | **B1/B7** | | | | | | |
| 15 质量 | | **Javadoc** | | **P3C** | | | **J5** |
| 17 漏洞 | | | | **P3C** | **J4** | | |
| **19 设计** | **B9/B10/B11** | | | **GodClass/复杂度** | | | |

---

## 闭环三：修复（强制复扫，不可跳过）

### 修复流程

```
AUDIT_BE_{ts}.md（违规清单）
   ↓
[1] code-fix-be 按严重度选：
    ├ 🔴 必修（逐项 diff 确认）
    ├ 🟡 默认修（可批量）
    └ 🟢 列 backlog（默认不修）
   ↓
[2] 修复策略：
    ├ rule-based（缺注解/SELECT*/长方法）→ 读 templates + 规则生成 patch
    └ ai-based（语义偏差）→ AI 生成 patch
   ↓
[3] 展示 diff，等待用户确认
   ↓
[4] 用户 yes → 写入 + 报告标 ✅
   ↓
[5] ★ 强制复扫（不可跳过）
    └ wl-skills-bd validate {涉及文件}
       ├ error=0 → ✔ 闭环完成，可提交
       └ 仍有 error → 输出残余，建议继续 code-fix-be
```

### 复扫报告格式

```markdown
## 🔄 复扫 {时间} | 触发：code-fix 后自动复扫

| 指标 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---|
| 🔴 阻断 | {N} | {N} | {-N} ✅ |
| 🟡 警告 | {N} | {N} | {-N} ✅ |

### 结论
- ✔ 闭环完成，可安全提交
- 或：✖ 仍有 {N} 个未解决项
```

### 修复对照表（常见违规 → 修复方式）

| 违规 | 规则 | 修复 | 依据 |
|------|:---:|------|------|
| 缺 @PreAuthorize | B1 | 补 `@PreAuthorize("@pms.hasPermission('xxx')")` | Controller.java.tmpl |
| 缺 @ApiOperation | B2 | 补 Swagger 注解 | Controller.java.tmpl |
| SELECT 星号 | B3 | 改 `<include refid="BaseColumns"/>` | Mapper.xml.tmpl |
| 美元符注入 | B4 | 改 `#{x}` + jdbcType | standards/06 |
| 缺 @Transactional | B5 | 加 `@Transactional(rollbackFor=Exception.class)` | Service.java.tmpl |
| 缺 COMPANY_ID | B7 | 补租户条件 | standards/11 §4 |
| 裸 RuntimeException | B8 | 改 ServiceAssert / ServiceException | standards/08 |
| **上帝类** | **B9** | **按职责拆分（拆 Service 类）** | standards/19 §6 |
| **长方法** | **B10** | **提取 private 辅助方法** | standards/19 §3 |
| **高圈复杂度** | **B11** | **卫语句 / 多态替代 switch** | standards/19 §3 |

### 修复禁区

- **不修业务逻辑**（只修偏差，功能补全是 codegen 职责）
- **不批量盲改**（每文件首个补丁先 diff 确认范式）
- **DDL 违规转 ⑥ db-migration**（表结构变更不在 code-fix）
- **try-catch 吞异常后必须重新抛出**（否则事务不回滚）

---

## 与前端的握手闭环

```
前端 wl-skills-kit 产出 api.md（契约）
        ↓ 后端消费
② api-design-be → docs/api/{module}.md（含权限码）
        ↓ ③④⑤ 生成代码
后端代码产出
        ↓ 反向同步（强制）
前端 SYS_PERMISSION_INFO.md（权限码同步）
前端 api.md（字段变更回灌）
```

> **权限码 `{module}_{resource}_{action}` 是前后端唯一握手凭证**。后端生成完必须提示"以下权限码需同步前端：xxx"。

---

## AI 生成代码的标准开场（每次触发 codegen 必说）

```
🚀 已触发 {Skill}/SKILL.md
✅ 已读取 standards/index.md → 任务类型 {A/B/C}
✅ 已读取 standards/0X-*.md（本阶段相关规范）
✅ 已读取 templates/Xxx.java.tmpl（标准骨架）
✅ 已确认 api.md 存在（契约依据）
✅ 已确认工程根包 com.jhict.{prod}（包名映射）
✅ 数据库类型 {Oracle|MySQL}（方言确定）
⚠️ 即将生成 {N} 个文件，生成后跑 validate 自检
```

---

## 常见误区纠正

| 误区 | 正解 |
|------|------|
| "AI 直接按描述生成代码" | ❌ 必须先有 api.md 契约 |
| "生成完就提交" | ❌ 必须跑 validate + 审计 + 复扫 |
| "Service 加接口+Impl 两层" | ❌ 团队基线直继 JhServiceImpl，无独立接口 |
| "COMPANY_ID 手动填" | ❌ 用 EntityUtil 填充器动态取，禁硬编码 |
| "长方法无所谓" | ❌ B10 卡控 >80 行，必须拆 |
| "上帝类能跑就行" | ❌ B9 卡控 >500 行，按职责拆 |
| "修完不用复扫" | ❌ code-fix-be 强制复扫闭环 |

## 变更记录
- 2026-07-17 v0.1 初始（三闭环权威文档，整合 _pipeline + _registry + 19 规范 + B1~B11）
