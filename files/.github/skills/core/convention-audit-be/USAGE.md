# 使用指南：后端规范审计（convention-audit-be）

按 19 条 standards + be-rules B1~B12 + Java 工具链 J1~J7 全量扫描工程，输出分级审计报告。

## 触发词

```
后端审计 / 代码体检 / 全量扫描 / 检查代码 / 代码质量 / 复扫验证 / 分层违规
```

## 典型场景

### 场景 A：首次全量审计（最常见）

```bash
wl-skills-bd validate src/main/java    # 即时 be-rules（B1~B12）
```
触发词"后端审计" → AI 跑全量（be-rules + Checkstyle + PMD/P3C + SpotBugs + ArchUnit + Spotless），输出 `reports/AUDIT_BE_{ts}.md`。

### 场景 B：--quick 复扫（code-fix 后验证）

code-fix-be 修完后自动触发，仅查上次偏差涉及的文件，省 90% token。输出前后对比矩阵：

```
| 指标 | 修复前 | 修复后 | 变化 |
| 🔴 阻断 | 12 | 0 | -12 ✅ |
```

### 场景 C：CI 卡控（mvn verify）

无需触发词，push/PR 时 `mvn clean verify` 自动跑全部 Java 工具，违规 build failure。

## 执行器覆盖矩阵（速查）

| 检查 | 执行器 | 即时? |
|------|:---:|:---:|
| 缺 @PreAuthorize / @Operation | B1/B2 | ✓ |
| SELECT 星号 / 美元符注入 | B3/B4 | ✓ |
| 缺 @Transactional / 裸异常 | B5/B8 | ✓ |
| 单目录文件>20 | B6 | ✓ |
| 缺 COMPANY_ID | B7 | ✓ |
| **上帝类(>500) / 长方法(>80) / 高复杂度(>10)** | **B9/B10/B11** | ✓ |
| **业务/接口方法缺 Javadoc** | **B12** | ✓ |
| 跨层（Controller→Mapper）| J1 ArchUnit | mvn |
| 命名/风格/Javadoc | J2 Checkstyle | mvn |
| 性能/坏味道 | J3 PMD + J6 P3C | mvn |
| NPE/资源泄漏 | J4 SpotBugs | mvn |
| 格式 | J5 Spotless | mvn |
| 接口文档完整性 | J7 Knife4j（启动访问）| 启动 |

## FAQ

**Q：be-rules 和 Java 工具重复吗？**
A：不重复。be-rules（regex，AI 对话即时）查框架级（注解/SQL/长度）；Java 工具（mvn，CI）查语义级（字节码/AST）。分工见 `standards/19 §设计`。

**Q：审计后怎么修？**
A：触发 `code-fix-be`（"修复规范问题"），自动读 templates 修 + 强制复扫。

**Q：骨架 Skill 生成的代码会被审计吗？**
A：会。所有生成代码都过同一套 B1~B12 + J1~J7。
