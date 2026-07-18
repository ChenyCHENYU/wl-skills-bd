# Java 质量门

本目录把团队规范物化为可执行检查。默认 `wl-quality` profile 在 Java 8 上真实验证，阻断项由 Maven `verify` 执行。

| 编号 | 工具 | 职责 | 默认硬门 |
|---|---|---|:---:|
| J1 | ArchUnit 1.4.2 | Controller/Service/Mapper/Entity 依赖方向 | 是 |
| J2 | Checkstyle Maven Plugin 3.6.0 | 命名、Javadoc、规模、基础风格 | 是 |
| J3 | Maven PMD Plugin 3.28.0 / PMD 7.17 | 缺陷、资源、复杂度、性能 | 是 |
| J4 | SpotBugs Maven Plugin 4.8.6.8 | Java 8 可运行的字节码缺陷分析 | 是 |
| J5 | Spotless Maven Plugin 2.30.0 | Java 8 可运行的 AOSP 格式和 UNIX 换行 | 是 |
| J6 | P3C 2.1.1 / PMD 6 | 存量规约审计 | 否，隔离运行 |
| J7 | Knife4j/OpenAPI 导出 | 运行时接口文档能力 | 否，不属于静态质量门 |
| J8 | JaCoCo 0.8.15 | Service/Controller 类级测试覆盖率 | 是 |

## 接入

1. 执行 `wl-skills-bd init`，保留 `.github/java-quality/` 的目录结构。
2. 将 `maven-snippets/quality-profile.xml` 中的 `<profile>` 复制到父 POM 的 `<profiles>`。
3. 将 `archunit/LayerRulesTest.java` 复制到测试源码并替换 `{{rootPackage}}`。
4. 执行：

```bash
mvn verify -Pwl-quality
```

配置使用 `${project.basedir}/.github/java-quality/...` 的稳定路径，避免手工复制到另一个 `build/` 目录形成双份规则。

## PMD 7 与 P3C 隔离

`p3c-pmd:2.1.1` 的发布 POM声明它编译于 PMD 6.15；默认 PMD 插件 3.28.0 使用 PMD 7.17。两者混装会产生类/API 冲突，因此：

- `wl-quality` 只运行 PMD 7 原生规则；
- `wl-p3c-legacy` 使用 PMD 插件 3.21.2 的 PMD 6 分支，且 `failOnViolation=false`；
- 两个 profile 不得在同一次 Maven 调用中激活。

## 包自身验证

```bash
npm run verify:quality-config   # 离线检查 XML、版本和隔离关系
npm run verify:quality-maven    # 创建临时 Java 8 工程，真实运行 J1~J5/J8
```

真实夹具会编译源码、执行测试与 5 条 ArchUnit 断言，并依次通过 Checkstyle、PMD 7、SpotBugs、Spotless 和 JaCoCo。CI 在 Ubuntu/Node 22/Java 8 组合上执行此轮验证。
