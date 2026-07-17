# Java Quality — 检查工具规则集

> **作用**：把 `standards/`（人读规范）物化为 **Java 官方/社区检查工具的规则配置**，让约定从"靠自觉"变成"CI 硬卡控"。
>
> 这是 wl-skills-bd 对标 wl-skills-kit(ESLint) 的 Java 后端等价方案。
> 前端只有 ESLint 一个标准；Java 后端有 Checkstyle/PMD/SpotBugs/ArchUnit/Spotless 多元工具链。

## 目录与工具映射

| 目录 | 工具 | 对应 standards | 执行器编号 | 优先级 | 状态 |
|------|------|----------------|-----------|--------|------|
| `archunit/` | ArchUnit | 02 跨层禁止 | J1 | 🔴 P1 | ✅ 已落地 |
| `checkstyle/` | Checkstyle | 03 命名 / 15 质量 | J2 | 🔴 P1 | ✅ 已落地 |
| `maven-snippets/` | Maven 插件配置 | 全部（接入入口） | — | 🔴 P1 | ✅ 已落地 |
| `pmd/` | PMD | 16 性能 / 17 防护 | J3 | 🟡 P2 | ✅ 已落地 |
| `spotbugs/` | SpotBugs | 17 防护 | J4 | 🟡 P2 | ✅ 已落地 |
| `spotless/` | Spotless | 15 格式 | J5 | 🟢 P3 | ✅ 已落地 |

## 三种审计场景分工

| 场景 | 主力 | 何时触发 | 特点 |
|------|------|----------|------|
| 本地开发 | IDE 插件（IDEA Checkstyle/SpotBugs） | 写代码时 | 实时提示，体验好 |
| CI/CD 门禁 | Maven 插件（本目录） | push/PR | build failure 硬卡 |
| AI 审计 | `lib/be-rules.js`（正则） | convention-audit-be Skill | 无需插件，对话内即时 |

**原则**：能被 Maven 插件确定的（J*）→ 不写进 be-rules；regex 只做插件查不了的（注解缺失/SELECT \*/目录密度）。

## 接入新工程（3 步）

1. `npx @agile-team/wl-skills-bd init`（释放 standards + skills + 本目录）
2. 按需复制 `checkstyle/`、`archunit/` 到工程，改根包（见 standards/02 包名映射）
3. 粘 `maven-snippets/pom-plugins.xml` 到 pom.xml，`mvn clean verify` 验证

## 治理

- 规则与 standards 的对应关系登记在 `kit-internal/rule-coverage.md`
- `scripts/lint-skills.js` 校验"阻断项必须有 J*/regex 执行器"，防止约定漂移成纯文档
- 新增 Java 规则：先写 standards（人读）→ 物化到本目录（机器）→ 更新 rule-coverage.md 矩阵

## 参考链接

- Checkstyle：https://checkstyle.org/
- ArchUnit：https://www.archunit.org/
- PMD：https://pmd.github.io/
- SpotBugs：https://spotbugs.github.io/
- Spotless：https://github.com/diffplug/spotless
