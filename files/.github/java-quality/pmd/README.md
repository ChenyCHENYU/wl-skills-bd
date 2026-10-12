# PMD 静态分析（J3/J6）

当前模式以 [Java 质量门总说明](../README.md) 为准：wl-quality 保留严格硬门；wl-quality-audit 生产静态报告交给 Gate 分级，wl-quality-unit 独立运行单元/架构与覆盖率。检查不自动 apply 格式，也不运行外部集成测试。

`pmd-ruleset.xml` 是共享 PMD 7 规则集，覆盖：

- 资源关闭、空 catch、equals/hashCode 和字符串比较；
- 字符串大小写转换显式 Locale、硬编码加密密钥、固定 IV；
- 未使用局部变量/私有方法、参数重赋值；
- 循环内实例化、重复 String 构造和循环字符串拼接；
- 不必要 import；
- 圈复杂度、认知复杂度和 God Class。

严格模式接入位于 `../maven-snippets/quality-profile.xml`：Maven PMD Plugin 3.28.0，实际加载 PMD 7.17.0，`failOnViolation=true`。

## P3C 兼容审计

P3C 2.1.1 的最后发布基于 PMD 6.15，不能作为 PMD 7 的扩展依赖。`p3c-legacy-profile.xml` 使用 Maven PMD Plugin 3.21.2（PMD 6.55 分支）单独加载 `ali-*` 规则，默认只报告不阻断。禁止两套 profile 同时激活。

```bash
mvn verify -Pwl-quality
mvn pmd:check -Pwl-p3c-legacy  # 另一次调用，可选
```

源码维护者新增/删除 PMD 规则后必须在本包源码仓库执行 `npm run verify:quality-maven`，确保规则名、属性和 Java 8 运行时均真实可用。本轮精选规则还由 `npm run verify:quality-codecc` 在临时 Java 8 工程中验证真实 PMD 正反例；机器码使用 `Locale.ROOT`，自然语言使用明确的业务 Locale，不能只为消除告警改变协议。

更多生成约束和需要语境复核的规则见 [扫描规则决策](../codecc-triage.md)。这三项为 0.40.0 新增规则，不代表业务项目已经更新或旧 CodeCC 附件已被重新扫描。
