# Checkstyle 代码风格规则（J2）

> **作用**：把 `standards/03-naming` + `standards/15-code-quality` 的命名/风格约定物化为 Checkstyle 规则，CI 跑 `mvn verify` 自动卡控。
>
> 官方：https://checkstyle.org/ （Java 代码风格事实标准，最权威）

## 与 standards 的对应

| standards 条款 | Checkstyle 模块 |
|----------------|-----------------|
| 03 类名 PascalCase + Controller/Service/Mapper 后缀 | `TypeName` + 正则 `^([A-Z][a-z0-9]+)+Controller$` 等 |
| 03 方法名 camelCase | `MethodName` |
| 03 常量 UPPER_SNAKE | `ConstantName` |
| 03 包名全小写 | `PackageName` |
| 15 未用 import | `UnusedImports` |
| 15 import 通配符 `*` | `AvoidStarImport` |
| 15 大括号强制 | `NeedBraces` |
| 15/19 文件与方法长度 | `FileLength` + `MethodLength` |
| 15 缺少 Javadoc | `MissingJavadocType/Method` |
| 15 Javadoc 标签 | `JavadocType/Method` |

## 接入步骤

### 1. 复制规则文件到工程

```bash
# init 已放入工程的稳定路径，不再复制第二份
.github/java-quality/checkstyle/checkstyle.xml
```

### 2. 接入 `maven-snippets/quality-profile.xml`

### 3. 跑

```bash
mvn checkstyle:check
# 或随 verify: mvn verify
```

违规会输出报告 `target/checkstyle-result.xml`，CI 配置 `<failOnViolation>true</failOnViolation>` 即 build 红灯。

## 渐进启用

存量项目先 `<failOnViolation>false</failOnViolation>` 只报告不阻断，逐步清零后再开。

## IDE 集成

- IDEA：装 Checkstyle-IDEA 插件，导入 `checkstyle.xml`，写代码实时提示
- VS Code：Checkstyle for Java 扩展

## 与 be-rules.js 的分工

Checkstyle（J2）管**编译期能确定的命名/风格/格式**；be-rules.js（regex）管**框架级注解缺失**（@PreAuthorize 等 Checkstyle 查不了）。
