# PMD 静态分析规则（J3）

> **作用**：物化 `standards/16-performance` + `standards/17-bug-prevention`（部分），查代码坏味道、性能反模式、重复代码。
>
> 官方：https://pmd.github.io/ （PMD 7.x，Java 静态分析主力）

## 与 standards 的对应

| standards 条款 | PMD 规则集 |
|----------------|-----------|
| 16 BeanUtils → Spring/Lombok | `performance` |
| 16 集合指定初始容量 | `performance` |
| 16 正则预编译 | `performance` |
| 17 equals 用 == 比较 | `errorprone` |
| 17 包装类比较用 equals | `errorprone` |
| 15 魔法值 | `cleanCode` |
| 15 空 catch 块 | `empty` |

## 接入步骤

### 1. 复制规则集

```bash
cp files/.github/java-quality/pmd/pmd-ruleset.xml  your-project/build/pmd-ruleset.xml
```

### 2. Maven 插件（见 maven-snippets/pom-plugins.xml 的 PMD 段）

### 3. 跑

```bash
mvn pmd:check
# 或随 verify：mvn verify
```

违规输出 `target/pmd.xml`，配 `<failOnViolation>true</failOnViolation>` 即 build 红灯。

## 与 SpotBugs 的分工

- **PMD**：源码 AST 分析 → 坏味道、性能、复杂度（编译前可查）
- **SpotBugs**：字节码分析 → NPE、资源泄漏、并发（需编译后）
- 两者互补，PMD 先行（更快），SpotBugs 兜底（更深）

## 渐进启用

存量项目先 `<failOnViolation>false</failOnViolation>` 只报告，逐步清零。
