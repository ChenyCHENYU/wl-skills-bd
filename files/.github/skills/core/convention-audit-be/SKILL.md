---
name: convention-audit-be
description: |
  后端规范全量审计。按 standards 18 条 + lib/be-rules.js(B1~B8) 检查工程，输出 reports/AUDIT_BE_{ts}.md，
  按严重度分级（🔴 阻断 / 🟡 警告 / 🟢 建议），定位到文件 + 行号 + 违规条款。
  支持 --quick 复扫模式（仅查上次报告偏差，闭环验证用）。
  典型触发：「规范审计」「代码体检」「全量扫描」「检查代码」「代码质量」「复扫验证」
status: 🟡 落地
stage: ⑧ 审计
---

# convention-audit-be

对标 wl-skills-kit/convention-audit，适配 Java 后端。以 standards/ 18 条 + `lib/be-rules.js`(B1~B8) 为唯一基线，扫描工程输出偏差报告。**只发现不修复**（修复由 code-fix-be 完成）。

## Pre-flight 声明（必填）

```
🚀 已触发技能 convention-audit-be/SKILL.md → 后端规范审计
✅ 已读取 standards/index.md          → 规范门控，任务类型 E
✅ 已读取 standards/01 ~ 18           → 完整规范基线（审计需全量加载）
✅ 已读取 reports/AUDIT_BE_*.md       → 上次报告（用于 --quick 复扫）
✅ 审计范围：{用户指定目录或单文件}
✅ 工具链委托：Checkstyle {状态} / ArchUnit {状态} / be-rules {可用}
```

## 两种模式

| | 全量审计 | --quick 复扫 |
|---|---|---|
| 触发 | 首次审计 / 定期体检 | code-fix 后验证 / 确认修复效果 |
| 规范覆盖 | 18 条 + B1~B8 全跑 | 仅上次报告中的 🔴🟡 项 |
| 扫描范围 | 指定目录或全项目 | 仅偏差涉及的文件 |
| 执行方式 | AI 读 standards 逐条 + 调 `wl-skills-bd validate` | 仅对偏差文件复检 |
| token 消耗 | 高 | 低（约全量 10%）|
| 输出 | 完整报告 | 复扫对比矩阵 |

### --quick 复扫执行逻辑

1. 读取 `reports/AUDIT_BE_{ts}.md` 最新章节的 🔴🟡 偏差清单
2. 提取偏差涉及的文件集合
3. 对这些文件重新执行 `wl-skills-bd validate` + standards 检查
4. 对比上次数据，输出变化矩阵
5. 追加复扫结果到报告

## 审计方式分层

| 方式 | 说明 | 可信度 |
|---|---|---|
| **确定性执行器** | `wl-skills-bd validate`（B1~B8）+ Checkstyle(J2) + ArchUnit(J1) | ✅ 高（机器） |
| **静态扫描** | 文件存在性、正则匹配（补充项） | ✅ 高 |
| **AI 场景判断** | 业务语义、豁免判定 | ⚠️ 中（需人工确认）|

> **原则**：能用执行器（validate/Checkstyle/ArchUnit）确定的，不浪费 AI 算力。AI 只做执行器覆盖不到的场景判断。

## 检查项矩阵

| 编号 | 检查项 | 执行器 | 严重度 |
|------|--------|--------|--------|
| 02 | 跨层调用（Controller→Mapper）| **J1 ArchUnit** | 🔴 |
| 02 | 单目录文件 ≤20 | **B6** | 🟡 |
| 03 | 类命名/后缀 | **J2 Checkstyle** | 🔴 |
| 04 | Controller 缺 @PreAuthorize | **B1** | 🔴 |
| 04 | Controller 缺 @ApiOperation | **B2** | 🟡 |
| 05 | 写操作缺 @Transactional | **B5** | 🟡 |
| 06 | XML SELECT 星号 | **B3** | 🔴 |
| 06 | XML 美元花括号注入 | **B4** | 🔴 |
| 08 | 裸 RuntimeException | **B8** | 🟡 |
| 11 | SELECT 缺 COMPANY_ID | **B7** | 🟡 |
| 12 | DDL 缺审计字段/索引/注释 | AI + 静态 | 🟡 |
| 15-17 | 代码质量/性能/漏洞 | **J3 PMD / J4 SpotBugs**（P2）| 🟡/🔴 |
| 18 | Git 提交规范 | AI 查最近 commit | 🟡 |

## 新增 vs 存量区分

| 类型 | 策略 |
|---|---|
| 新增代码（AI 生成 / 本次新增）| 必须全规约，🔴 阻断项严格执行 |
| 本次修改文件 | 不新增违规，触碰范围内尽量修 |
| 存量未触碰 | 报告记录，后续治理，不阻断 |

## 执行流程

### 步骤 1：确定范围 + 加载基线

- 用户输入：目录 / 单文件 / "整个项目"
- 加载 standards 全量 + 检测工具链（Checkstyle/ArchUnit/validate 可用性）
- 读 `.be-rules-ignore` 豁免配置（如有）

### 步骤 2：跑确定性执行器（核心）

```bash
wl-skills-bd validate {范围}
```

收集 B1~B8 结果（这是高可信度的主体）。再视工程接入情况委托：
- 有 ArchUnit：跑 `mvn test -Dtest=LayerRulesTest` 取 J1 结果
- 有 Checkstyle：跑 `mvn checkstyle:check` 取 J2 结果

### 步骤 3：AI 场景补充

执行器覆盖不到的（如 DDL 缺注释、commit 规范、业务语义偏差），AI 逐条判断，标记为 ⚠️ 待确认。

### 步骤 4：追加报告

`reports/AUDIT_BE_{yyyymmdd_HHmm}.md`（追加，最新在顶）：

```markdown
## 🕐 {时间} | 范围：{范围} | 触发：{user / code-fix后复扫}

### 1. 扫描数据
| 指标 | 值 |
|---|---|
| 扫描文件数 | {N} |
| Controller / Service / Mapper 数 | {N}/{N}/{N} |

### 2. 工具链状态
| 执行器 | 状态 |
|---|---|
| be-rules (B1~B8) | ✅ {N} 项 |
| ArchUnit (J1) | ✅/未接入 |
| Checkstyle (J2) | ✅/未接入 |

### 3. 偏差清单（按严重度）
| 严重度 | 文件:行 | 规则 | 说明 | 建议修复 |
|---|---|---|---|---|
| 🔴 | XxxController.java:42 | B1 | 缺@PreAuthorize | 补权限码 |
```

### --quick 复扫报告格式

```markdown
## 🔄 复扫 {时间} | 触发：code-fix 后自动复扫

| 指标 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---|
| 🔴 阻断 | {N} | {N} | {-N} ✅ |
| 🟡 警告 | {N} | {N} | {-N} ✅ |
| 未解决 | - | {N} | 待处理 |

### 结论
- ✔ 闭环完成，可安全提交
- 或：✖ 仍有 {N} 个未解决项，建议继续 code-fix-be
```

## 约束

- **只读**，不写代码（修复交给 code-fix-be）
- 不建议跳过任何 🔴 项
- 报告用 Markdown 表格，避免散文
- 每条偏差标注「可否自动修复」（rule-based / ai-based / 人工）

## 完成摘要

```
✅ convention-audit-be {全量/--quick} 完成
   - 扫描文件: N
   - 🔴 阻断: A 项
   - 🟡 警告: B 项
   - 🟢 建议: C 项
   - 执行器覆盖: be-rules N + ArchUnit N + Checkstyle N
   - 报告: reports/AUDIT_BE_{ts}.md
   - 下一步建议: ⑨ code-fix-be（如有 🔴 项）
```

## 变更记录
- 2026-07-17 v0.2 落地 --quick 复扫 + 接 wl-skills-bd validate + 前后对比矩阵（对标 kit）
- 2026-05-14 v0.0.1 骨架
