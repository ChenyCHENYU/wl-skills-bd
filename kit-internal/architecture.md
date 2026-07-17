# Architecture Decision Record — wl-skills-bd v0.1 架构完善

> **状态**：proposed → 本轮落地
> **日期**：2026-07-17
> **作者**：CHENY（工号 409322）
> **对标参考**：`wl-skills-kit` v2.12.6（前端伴生包，已验证的成熟架构）

---

## 0. 要解决的问题

`wl-skills-bd` 当前（v0.0.5）存在两个根本性缺陷：

1. **不能自检**：`version:verify` / `lint:skills` / `test` 三个 npm script 全是 `echo "TODO"`，无 `prepublishOnly`。发版靠人眼，已发生过计数漂移（`convention-audit-be` 写"14 条"实际已 18 条）。
2. **审计非确定性**：`convention-audit-be` 是给人看的"检查清单"，没有执行器。AI 审计 = 凭印象扫一遍，漏检无感知 → **胶水代码风险**。

对标 kit：kit 有 ESLint + Husky + vitest + 20 测试 + `ast-rules.js`(809行) + 规则覆盖矩阵，做到"每条阻断约定都有确定性执行器兜底"。

---

## 1. 核心架构决策：三层职责分离

```
wl-skills-bd/
├── scripts/          L0 自检层 ── 校验 bd 自己（npm 包）的一致性
├── lib/              L1 执行器层 ── 确定性规则引擎，供 CLI/MCP 调用
├── files/.github/    L2 产出层 ── 复制进目标 Java 工程，含三类产物：
│   ├── standards/        人读规范（源，18 条）
│   ├── java-quality/     ★Java 检查工具规则集（机器执行，物化 standards）
│   └── skills/           AI Skill（消费 standards + 指引工具接入）
└── tests/            L1 的回归测试
```

**三层关系（单向依赖，禁止反向）**：

```
L0 scripts  ──校验──►  L2 files（一致性）+ L1 lib（可调用）
L1 lib      ──解析──►  L2 files/.github/java-quality（规则源）
L2 skills   ──引用──►  L2 standards + L2 java-quality
```

### 为什么这样分

| 层 | 对标 kit | bd 特色 |
|----|---------|---------|
| L0 自检 | `scripts/verify-version.js` + `lint-skills.js` | 同形（md 一致性，语言无关） |
| L1 执行器 | `lib/ast-rules.js`（809行，Vue AST） | `lib/be-rules.js`（正则+行级，Java 无需 AST） |
| L2 standards | 14 条 | 18 条 |
| L2 java-quality | —（kit 用 ESLint 内置） | **★ bd 独有**：Checkstyle/PMD/SpotBugs/ArchUnit/Spotless |

---

## 2. Java 检查工具生态映射（关键决策）

kit 是 Vue 工程，天然用 ESLint（前端唯一标准）。bd 是 Java 后端，没有 ESLint，但有**成熟的官方/社区检查工具**，每个精确对应一类 standards。

### 工具选型与对应关系

| Java 工具 | 定位 | 对应 bd standards | 接入方式 | 优先级 |
|-----------|------|-------------------|----------|--------|
| **Checkstyle** | 代码风格规范（官方，最权威） | 03-naming / 15-code-quality | Maven `maven-checkstyle-plugin` + `checkstyle.xml` | 🔴 P1 |
| **PMD** | 静态分析（坏味道/复杂度/重复） | 16-performance / 17-bug-prevention | `maven-pmd-plugin` + `ruleset.xml` | 🟡 P2 |
| **SpotBugs** | 字节码分析（NPE/资源/并发） | 17-bug-prevention | `spotbugs-maven-plugin` + `exclude.xml` | 🟡 P2 |
| **ArchUnit** | **架构分层测试**（禁止跨层！） | 02-project-structure | JUnit 测试，`archunit-junit5` | 🔴 P1 |
| **Spotless** | 格式统一（google-java-format） | 15-code-quality（格式部分） | `spotless-maven-plugin` | 🟢 P3 |

### 为什么 ArchUnit 是 bd 的"杀手锏"

bd 的 `02-project-structure.md` 核心红线是"禁止跨层（Controller → Mapper）"。这条用 Checkstyle/PMD **查不出来**（它们不做架构断言）。ArchUnit 专门干这个：

```java
// 一个测试就能卡死所有跨层调用，编译期/测试期失败
@AnalyzeClasses(packages = "com.jhict")
class LayerRulesTest {
    @ArchTest
    static final ArchRule 控制器不能直接调用Mapper =
        classes().that().resideInAPackage("..controller..")
                 .should().notDependOnClassesThat().resideInAPackage("..mapper..");
}
```

这把 bd 最重要的一条架构约束从"文字"变成"可执行的 CI 卡控"，是 bd 对标 kit 规则覆盖矩阵的**第一个确定性执行器落地**。

---

## 3. 规则覆盖矩阵（核心治理基线，对标 kit/rule-coverage.md）

> **治理规则**：标记为「阻断」的约定**必须**至少有一个确定性执行器（J*/regex）兜底，否则 `lint-skills.js` 报错。这逼着"文档约定"持续向"代码卡控"收敛。

| 执行器 | 类型 | 位置 | 确定性 |
|--------|------|------|--------|
| `J1~J8` | Java 检查工具委托 | `files/.github/java-quality/` | ✅ 确定性（CI 失败即阻断） |
| `regex` | 正则/行级扫描 | `lib/be-rules.js` | ✅ 确定性（AI 审计可即时跑） |
| `AI` | 仅 SKILL.md 约定 | 各 `SKILL.md` | ⚠️ 非确定性（靠 AI 自觉） |

### 覆盖矩阵（本轮先填 P1 阻断项，P2/P3 逐步补）

| 约定来源 | 规则描述 | 执行器 | 级别 | 阻断 | 本轮 |
|----------|----------|--------|------|------|------|
| standards/02 | 禁止 Controller→Mapper 跨层 | **J1** ArchUnit | error | 是 | ✅ |
| standards/02 | 单目录文件 ≤20 | regex | warn | 否 | ✅ |
| standards/03 | 类命名 PascalCase + 后缀 | **J2** Checkstyle | error | 是 | ✅ |
| standards/04 | Controller 方法缺 @PreAuthorize | regex | error | 是 | ✅ |
| standards/04 | Controller 缺 @ApiOperation | regex | warn | 否 | ✅ |
| standards/06 | XML 出现 SELECT \* | regex | error | 是 | ✅ |
| standards/06 | XML 使用 ${} 拼接（注入风险） | regex | error | 是 | ✅ |
| standards/05 | 写操作缺 @Transactional | regex | warn | 否 | ✅ |
| standards/11 | SELECT 缺 COMPANY_ID | regex | warn | 否 | ✅ |
| standards/15 | 魔法值/未用 import | **J3** PMD | warn | 否 | P2 |
| standards/17 | NPE/资源未关/equals 错误 | **J4** SpotBugs | error | 是 | P2 |
| standards/15 | 代码格式统一 | **J5** Spotless | warn | 否 | P3 |

> **本轮目标**：J1（ArchUnit）+ 全部 regex 执行器落地，覆盖所有🔴阻断项。J3/J4/J5 留 P2/P3。

---

## 4. 三种审计场景的分工（避免重复）

同一类违规，谁该查？避免工具/执行器/AI 三头查导致冲突：

| 场景 | 主力工具 | 触发时机 | 特点 |
|------|----------|----------|------|
| **本地开发** | IDE（IDEA Checkstyle/SpotBugs 插件） | 写代码时实时 | 体验最好 |
| **CI/CD 门禁** | Maven 插件（Checkstyle/PMD/SpotBugs/ArchUnit） | push/PR | 编译期硬卡，build failure |
| **AI 审计** | `lib/be-rules.js`（regex） | `convention-audit-be` Skill | 无需插件，AI 对话内即时跑，覆盖文档级规范 |

**分工原则**：能被 Maven 插件确定的（J*）→ 不写进 regex；regex 只做"插件查不了但 AI 容易犯"的（如 @PreAuthorize 缺失、SELECT \*、目录文件数）。这样维护成本最低。

---

## 5. 落地清单（本轮 P0+P1）

### P0 自检闭环（对标 kit，1-2h，止血）
- [x] `scripts/verify-version.js`：版本 + 计数（18 条）+ npm files 数组交叉校验
- [x] `scripts/lint-skills.js`：SKILL.md 的 Pre-flight/standards 引用/路径存在/行数/规则覆盖矩阵
- [x] `package.json`：补 `verify`/`lint:skills`/`test`/`prepublishOnly`/`release:check`
- [x] `tests/`：verify-version / lint-skills / be-rules 回归测试骨架

### P1 Java 规则集 + 执行器（防胶水代码核心）
- [x] `files/.github/java-quality/archunit/`：分层规则测试模板（J1）
- [x] `files/.github/java-quality/checkstyle/`：checkstyle.xml + README（J2）
- [x] `files/.github/java-quality/maven-snippets/`：pom 插件配置片段（一键接入）
- [x] `lib/be-rules.js`：正则执行器（J 标记以外的 regex 项）
- [x] `kit-internal/rule-coverage.md`：规则覆盖矩阵（本文件 §3）

### 留待后续（P2/P3，逐个细化时做）
- [ ] PMD / SpotBugs / Spotless 规则集（J3/J4/J5）
- [ ] 10 个 SKILL.md 从骨架（40-80行）补厚到落地（200-300行）
- [ ] `convention-audit-be` 加 `--quick` 复扫模式（对标 kit）
- [ ] MCP Server（对标 kit 的 21 个 tools）

---

## 6. 维护路径（未来持续演进）

1. **加新规范**：先写 `standards/NN-xxx.md`（人读）→ 评估能否物化到 `java-quality/`（J*）或 `lib/be-rules.js`（regex）→ 更新 `kit-internal/rule-coverage.md` 矩阵 → `lint-skills.js` 自动校验"阻断项有执行器"。
2. **发版**：`pnpm release:check`（跑全部自检）→ 改版本 → `pnpm publish`（prepublishOnly 再兜底）。
3. **接入新 Java 工程**：`npx wl-skills-bd init`（释放 standards+skills）→ 复制 `java-quality/` 到工程 → 按各 README 接 Maven 插件 → 跑 `mvn verify` 验证。

---

## 7. 与 kit 的对称与差异（一句话总结）

- **对称**：三层架构、规则覆盖矩阵、prepublishOnly 闭环、SKILL.md 范式。
- **差异**：kit = ESLint + Vue AST；**bd = Checkstyle + PMD + SpotBugs + ArchUnit + Spotless + 正则**（Java 工具链的天然形态，比前端工具更多元）。

---

## 变更记录
- 2026-07-17 v0.1 ADR 初始化（对标 kit v2.12.6）
