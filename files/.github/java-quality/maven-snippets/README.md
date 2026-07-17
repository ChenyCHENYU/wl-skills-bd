# Maven 插件接入片段

本目录的 `pom-plugins.xml` 是**一键接入** wl-skills-bd 全部 Java 检查工具的 Maven 配置片段集合。

## 用法

1. 复制 `pom-plugins.xml` 到工程根或 `build/` 目录作为参考
2. 按需把其中各 `<plugin>` / `<dependency>` 段粘到目标工程的父 `pom.xml`
3. 对应的规则文件（checkstyle.xml / LayerRulesTest.java）从同级 `../{tool}/` 目录复制
4. 跑 `mvn clean verify` 验证

## 各工具速查

| 工具 | 片段用途 | 详细规则 |
|------|----------|----------|
| Checkstyle | 命名/风格（J2） | `../checkstyle/README.md` |
| ArchUnit | 架构分层（J1） | `../archunit/README.md` |
| PMD | 静态分析（J3，P2） | `../pmd/`（待） |
| SpotBugs | 字节码（J4，P2） | `../spotbugs/`（待） |
| Spotless | 格式（J5，P3） | `../spotless/`（待） |

具体配置见 `pom-plugins.xml`。
