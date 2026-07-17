# SpotBugs 字节码分析规则（J4）

> **作用**：物化 `standards/17-bug-prevention`，查 NPE、资源泄漏、并发问题、equals/hashCode 缺陷。需编译后跑（分析字节码）。
>
> 官方：https://spotbugs.github.io/ （SpotBugs 4.x，FindBugs 继任者）

## 与 standards 的对应

| standards/17 条款 | SpotBugs 检测器 |
|-------------------|-----------------|
| NPE 风险（空指针）| `NP_*` 系列 |
| 资源未关闭（流/连接）| `OS_*` 系列 |
| equals 不一致 | `Eq_*` 系列 |
| 并发问题 | `IS2_*` / `SC_*` |
| 浮点精度 | `FL_*` |
| switch 漏 break | `SF_*` |

## 接入步骤

### 1. 复制排除规则（按需排除 MyBatis-Plus 生成的代码）

```bash
cp files/.github/java-quality/spotbugs/spotbugs-exclude.xml  your-project/build/spotbugs-exclude.xml
```

### 2. Maven 插件（见 maven-snippets/pom-plugins.xml 的 SpotBugs 段）

### 3. 跑

```bash
mvn spotbugs:check
# 或随 verify：mvn verify
```

违规输出 `target/spotbugsXml.xml`，配 `<failOnError>true</failOnError>` 即 build 红灯。

## 与 PMD 的分工

- **PMD**：源码分析（坏味道/性能，编译前）
- **SpotBugs**：字节码分析（深层 bug，编译后）— SpotBubs 查 PMD 查不到的运行时缺陷

## 排除项

`spotbugs-exclude.xml` 默认排除：
- `target/generated-sources/`（MyBatis-Plus 生成代码）
- Lombok 生成的方法
- DTO/VO/Entity 的 getter/setter

## 渐进启用

threshold 设 `<threshold>Low</threshold>` 全查，或先 `High` 只查严重 bug，逐步收紧。
