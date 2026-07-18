# Spotless 格式门（J5）

Java 8 基线使用 `spotless-maven-plugin:2.30.0` 与 `google-java-format:1.7` 的 AOSP 风格。更高版本的 Spotless Maven Plugin 已提高运行 JRE 要求，不能直接放进 Java 8 构建。

配置还固定：

- 删除未使用 import；
- 去除尾随空格；
- 文件末换行；
- `lineEndings=UNIX`，避免 Windows/Linux 反复改行尾。

```bash
mvn spotless:check -Pwl-quality  # CI 只检查
mvn spotless:apply -Pwl-quality  # 开发者显式格式化
```

自动格式化会改文件，应先查看 diff；CI 和 MCP 不得静默执行 `apply`。
