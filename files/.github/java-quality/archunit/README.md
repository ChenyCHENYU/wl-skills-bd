# ArchUnit 架构分层规则（J1）

> **作用**：把 `standards/02` 的"禁止跨层调用"从文字变成**可执行的测试卡控**。
> CI 跑 `mvn test` 时，任何跨层调用都会让测试失败，build 红灯。
>
> **这是 bd 对标 kit 规则覆盖矩阵的第一个确定性架构执行器。**

## 为什么用 ArchUnit

`02-project-structure.md` 的核心红线是禁止跨层（Controller → Mapper）。这条用 Checkstyle/PMD **查不出来**（它们不做架构断言）。ArchUnit 专门干这个：分析字节码，断言包/类/层之间的依赖关系。

官方：https://www.archunit.org/ （v1.4.2，活跃维护，TNG 出品）

## 接入步骤

### 1. 加依赖（xxx-service/pom.xml）

```xml
<dependency>
    <groupId>com.tngtech.archunit</groupId>
    <artifactId>archunit-junit5</artifactId>
    <version>1.4.2</version>
    <scope>test</scope>
</dependency>
```

### 2. 把 `LayerRulesTest.java` 放到测试目录

```
xxx-service/src/test/java/com/jhict/{prod}/arch/
└── LayerRulesTest.java        ← 本目录的模板文件
```

> 把 `com.jhict.mdm` 换成你的根包（见 standards/02 业务中心包名映射）。

### 3. 跑测试

```bash
mvn test -Dtest=LayerRulesTest
# 或随全量测试：mvn test
```

跨层调用会让对应断言失败，输出形如：
```
Architecture Violation [Priority: MEDIUM] - Rule 'classes that reside in a package '..controller..' should not depend on classes that reside in a package '..mapper..' was violated (XxxController depends on XxxMapper)
```

## 规则清单（对应 standards/02）

| 规则 | 断言 |
|------|------|
| 控制器不依赖 Mapper | controller..  ✗→  mapper.. |
| 控制器不依赖 Mapper XML | controller..  ✗→  *Mapper.xml |
| Service 不直接依赖其他 Service 实现类 | service..impl ✗→ service..impl |
| Entity 不依赖 Controller/Service | entity.. ✗→ controller../service.. |
| 禁止循环依赖 | 包间无环 |

## 渐进启用（存量项目）

历史代码可能已有跨层调用，直接全开会满屏红。建议：

```java
// 先用 FREEZE 模式记录现状，不阻断，只输出报告
@AnalyzeClasses(packages = "${rootPackage}", importOptions = ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
class LayerRulesTest {
    @ArchTest
    static final ArchRule 控制器不依赖Mapper = noClasses()
        .that().resideInAPackage("..controller..")
        .should().dependOnClassesThat().resideInAPackage("..mapper..")
        .because("standards/02: Controller 必须经 Service，禁止直连 Mapper");
}
```

存量违规可先加 `@ArchIgnore` 或用 `freeze()` 冻结基线，新代码违规才失败。

## 与 be-rules.js(regex) 的分工

- ArchUnit（J1）：**编译后字节码**，精确，CI 卡控 → 跨层这种需要类型解析的
- be-rules.js（regex）：**源码文本**，AI 对话内即时跑，无需编译 → 缺注解/SELECT \* 这种文本级

两者互补：ArchUnit 兜底架构，regex 兜底编码习惯。
