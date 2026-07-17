# 规则 → 执行器 覆盖矩阵（治理基线）

> **目的**：回答一个关键问题——*每条"必遵"约定，到底是谁在兜底？*
> 是 Java 检查工具（J*）、正则执行器（regex）、还是仅靠 AI 自觉？
>
> **治理规则**：标记为「阻断」的约定必须至少有一个**确定性执行器**（J*/regex）兜底，
> 否则 `scripts/lint-skills.js` 报错。这逼着"文档约定"持续向"代码卡控"收敛，不再退化为纯文档。

---

## 执行器图例

| 执行器 | 类型 | 位置 | 确定性 |
|--------|------|------|--------|
| `J1` | ArchUnit 架构断言 | `files/.github/java-quality/archunit/` | ✅ 确定性（mvn test 失败即阻断） |
| `J2` | Checkstyle 风格 + Javadoc | `files/.github/java-quality/checkstyle/` | ✅ 确定性（mvn verify） |
| `J3` | PMD 静态分析 | `files/.github/java-quality/pmd/pmd-ruleset.xml` | ✅ 确定性（mvn verify） |
| `J4` | SpotBugs 字节码 | `files/.github/java-quality/spotbugs/` | ✅ 确定性（mvn verify） |
| `J5` | Spotless 格式 | `files/.github/java-quality/spotless/` | ✅ 确定性（mvn verify） |
| `J6` | **P3C 阿里黄山版 + 设计级** | `files/.github/java-quality/pmd/ali-p3c-ruleset.xml` | ✅ 确定性（mvn verify） |
| `regex` | 正则/行级扫描 | `lib/be-rules.js`（B1~B12） | ✅ 确定性（AI 审计/CLI/MCP 即时跑） |
| `AI` | 仅 SKILL.md 约定 | 各 `SKILL.md` | ⚠️ 非确定性（靠 AI 自觉） |

---

## 覆盖矩阵

| 约定来源 | 规则描述 | 执行器 | 级别 | 阻断 |
|----------|----------|--------|------|------|
| standards/02 | 禁止 Controller→Mapper 跨层调用 | **J1** | error | 是 |
| standards/02 | 禁止 Controller→DB 跨层 | **J1** | error | 是 |
| standards/02 | 单目录文件 ≤ 20 | **regex** B6 | warn | 否 |
| standards/03 | 类命名 PascalCase + 后缀规范 | **J2** | error | 是 |
| standards/04 | Controller 接口缺 @PreAuthorize | **regex** B1 | error | 是 |
| standards/04 | Controller 缺 @ApiOperation | **regex** B2 | warn | 否 |
| standards/05 | 写操作缺 @Transactional | **regex** B5 | warn | 否 |
| standards/06 | XML 出现 SELECT \* | **regex** B3 | error | 是 |
| standards/06 | XML 使用 ${} 拼接（注入） | **regex** B4 | error | 是 |
| standards/08 | 抛裸 RuntimeException | **regex** B8 | warn | 否 |
| standards/11 | SELECT 缺 COMPANY_ID | **regex** B7 | warn | 否 |
| standards/15 | 魔法值 / 未用 import / **类与方法 Javadoc** | **J2 / B12** | warn | 否 |
| standards/17 | NPE / 资源未关 / equals 误用 | **J4** | error | 是 |
| standards/15 | 代码格式统一 | **J5** | warn | 否 |
| **standards/19** | **类长度 >500（上帝类）** | **regex B9** | error | 是 |
| **standards/19** | **方法长度 >80（长方法）** | **regex B10 / J6** | warn | 否 |
| **standards/19** | **圈复杂度 >10** | **regex B11 / J6** | warn | 否 |
| **standards/19** | **设计规约（SOLID/封装/反模式）** | **J6 P3C GodClass + AI 判断** | warn | 否 |

---

## 仅 AI 约定（无确定性执行器，未来收敛目标）

以下约定目前仅靠 SKILL.md 告知 AI，没有代码兜底。**不标记为「阻断」**，随规则成熟度逐步接入执行器：

- standards/07 Entity/DTO/VO 边界（extends 关系）— 待 regex 扩展
- standards/09 日志占位符（log.info 拼接）— 待 regex 扩展
- standards/10 事务方法内发 MQ — 难以静态检测
- standards/13 Swagger 注解完整性 — 部分 regex，剩余靠 AI

> **收敛目标**：每个版本至少把 1-2 条 AI 约定升级为 J*/regex 执行器。

---

## 变更记录
- 2026-07-17 v0.6 新增 B12（业务/接口方法缺 Javadoc）；注释规范单一数据源（15 引用 19 §9）
- 2026-07-17 v0.5 J3/J4/J5 全部落地 + 新增 19 设计规约 + J6 P3C + B9/B10/B11
- 2026-07-17 v0.1 初始化（对标 kit/rule-coverage.md）；落地 J1/J2 + regex B1~B8
