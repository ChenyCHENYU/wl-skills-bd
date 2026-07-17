# Spotless 格式统一规则（J5）

> **作用**：物化 `standards/15-code-quality` 的格式部分，统一代码格式（import 排序、空格、换行），消灭"格式战"。
>
> 官方：https://github.com/diffplug/spotless （google-java-format 封装）

## 与 standards 的对应

| standards/15 条款 | Spotless 处理 |
|-------------------|--------------|
| import 顺序 | `removeUnusedImports` + 排序 |
| import 通配符 | `importOrder` |
| 缩进/空格 | google-java-format |
| 尾随空格 | `trimTrailingWhitespace` |
| 文件末换行 | `endWithNewline` |

## 接入步骤

### 1. Maven 插件（见 maven-snippets/pom-plugins.xml 的 Spotless 段）

### 2. 跑

```bash
# 检查格式（不改文件，违规报错）
mvn spotless:check

# 自动格式化（改文件）
mvn spotless:apply
```

## 与 Checkstyle 的分工

- **Checkstyle**：命名/结构约定（type 该叫什么）→ 错误必须改逻辑
- **Spotless**：纯格式（import 顺序、空格）→ 可自动修复（`spotless:apply`）
- 互补：Checkstyle 查不了的格式交给 Spotless，Spotless 查不了的命名交给 Checkstyle

## 格式风格选择

团队默认 `google-java-format` 的 AOSP 风格（4 空格缩进，比 Google 默认的 2 空格更贴合团队习惯）：

```xml
<googleJavaFormat>
    <version>1.17.0</version>
    <style>AOSP</style>
</googleJavaFormat>
```

如团队倾向 2 空格，改 `<style>GOOGLE</style>`。
