# PMD 静态分析规则（J3）

> **作用**：物化 `standards/16-performance` + `standards/17-bug-prevention` + `standards/19-design` + **阿里巴巴黄山版社区最佳实践**。
>
> 官方：https://pmd.github.io/ （PMD 7.x，Java 静态分析主力）
> 社区：https://github.com/alibaba/p3c （阿里巴巴 Java 开发手册 P3C 实现，54 条规则）

## 两套规则集并存

本目录提供**两套** PMD 规则集，建议同时启用（互补）：

| 规则集文件 | 来源 | 覆盖范围 | 接入 |
|-----------|------|---------|------|
| `pmd-ruleset.xml` | PMD 官方通用规则 | 16 性能 / 17 漏洞 / 15 质量（基础项）| 直接引用 |
| `ali-p3c-ruleset.xml` | **阿里巴巴黄山版 P3C** + 设计级补充 | 命名/常量/OOP/集合/并发/控制/异常/注释/ORM + 19 设计（方法长度/参数/圈复杂度/God Class/嵌套）| 需加 `p3c-pmd` 依赖 |

> **强烈建议同时启用**：pmd-ruleset 是 PMD 原生（无额外依赖），ali-p3c 是社区最佳实践（黄山版）。两者覆盖的规则基本不重叠，互补形成完整检查网。

## 与 standards 的对应

| standards 条款 | 规则来源 |
|----------------|---------|
| 03 命名 | P3C ali-naming + 19 §设计 |
| 15 代码质量 | pmd-ruleset + P3C ali-comment/ali-flowcontrol |
| 16 性能 | pmd-ruleset + P3C ali-other |
| 17 漏洞防护 | pmd-ruleset + P3C ali-oop/ali-set/ali-concurrent |
| **19 设计规约** | **ali-p3c-ruleset（方法长度/参数/圈复杂度/God Class/嵌套）+ be-rules B9/B10/B11** |

## 接入步骤

### 1. 复制规则集

```bash
cp files/.github/java-quality/pmd/pmd-ruleset.xml       your-project/build/
cp files/.github/java-quality/pmd/ali-p3c-ruleset.xml   your-project/build/
```

### 2. Maven 插件配置（见 maven-snippets/pom-plugins.xml 的 PMD + P3C 段）

P3C 需要额外把 `com.alibaba.p3c:p3c-pmd:2.1.1` 加入插件的 `<dependencies>`（让 PMD 能加载 ali-* 规则类）。

### 3. 跑

```bash
mvn pmd:check
# 或随 verify：mvn verify
```

违规输出 `target/pmd.xml`，配 `<failOnViolation>true</failOnViolation>` 即 build 红灯。

## P3C 54 条规则分类速查

| 规则集 | 条数 | 覆盖 |
|--------|:---:|------|
| ali-naming | 10 | 命名（类/方法/常量/包/数组/布尔）|
| ali-constant | 2 | 魔法值、long 大写 L |
| ali-oop | 7 | @Deprecated/equals/包装类比较/POJO 规范/toString |
| ali-set | 6 | subList/toArray/asList/foreach 删除/集合初始化 |
| ali-concurrent | 8 | ThreadLocal/线程命名/线程池/SimpleDateFormat/Timer |
| ali-flowcontrol | 4 | switch break/大括号/复杂条件/否定符 |
| ali-exception | 3 | rollback/finally return/NPE 防护 |
| ali-comment | 6 | Javadoc/抽象方法注释/@author/枚举注释 |
| ali-other | 7 | BeanUtils/正则预编译/时间获取/日期格式 y |
| ali-orm | 1 | ORM 规范 |

> 详情见 [P3C-PMD README](https://github.com/alibaba/p3c/tree/master/p3c-pmd)。

## 与 Checkstyle / be-rules 的分工

- **Checkstyle**（J2）：编译期命名/风格/格式
- **PMD**（J3）：静态分析坏味道/性能/复杂度
- **P3C**（J6，PMD 扩展）：社区最佳实践（黄山版全量）
- **be-rules**（B1~B11）：框架级注解/SQL + 设计长度（regex，AI 对话内即时）

四者互补：Checkstyle 查风格，PMD/P3C 查质量与设计，be-rules 查框架级。

## 渐进启用

存量项目先 `<failOnViolation>false</failOnViolation>` 只报告，逐步清零。P3C 对存量代码命中率高（黄山版就是为大厂存量整改设计），建议分阶段启用：
1. 先开 ali-naming/ali-constant/ali-flowcontrol（易改）
2. 再开 ali-oop/ali-set/ali-concurrent（中等）
3. 最后开 ali-comment + 设计级（ExcessiveMethodLength/GodClass）
