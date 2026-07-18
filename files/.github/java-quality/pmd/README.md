# PMD 静态分析（J3/J6）

`pmd-ruleset.xml` 是默认 PMD 7 硬门，覆盖：

- 资源关闭、空 catch、equals/hashCode 和字符串比较；
- 未使用局部变量/私有方法、参数重赋值；
- 循环内实例化、重复 String 构造和循环字符串拼接；
- 不必要 import；
- 圈复杂度、认知复杂度和 God Class。

默认接入位于 `../maven-snippets/quality-profile.xml`：Maven PMD Plugin 3.28.0，实际加载 PMD 7.17.0，`failOnViolation=true`。

## P3C 兼容审计

P3C 2.1.1 的最后发布基于 PMD 6.15，不能作为 PMD 7 的扩展依赖。`p3c-legacy-profile.xml` 使用 Maven PMD Plugin 3.21.2（PMD 6.55 分支）单独加载 `ali-*` 规则，默认只报告不阻断。禁止两套 profile 同时激活。

```bash
mvn verify -Pwl-quality
mvn pmd:check -Pwl-p3c-legacy  # 另一次调用，可选
```

新增/删除 PMD 规则后必须执行 `npm run verify:quality-maven`，确保规则名、属性和 Java 8 运行时均真实可用。
