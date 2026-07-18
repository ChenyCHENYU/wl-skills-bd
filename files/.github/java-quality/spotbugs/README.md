# SpotBugs 字节码分析（J4）

SpotBugs 在编译后检查 NPE、资源泄漏、并发、equals/hashCode 和可疑控制流。Java 8 基线固定使用 `spotbugs-maven-plugin:4.8.6.8`；4.9+ 插件要求 Java 11，不能用于 jh4j-cloud 3.1.0 的 Java 8 构建进程。

```bash
mvn spotbugs:check -Pwl-quality
# 或随全量门禁
mvn verify -Pwl-quality
```

`spotbugs-exclude.xml` 只排除确定的生成目录、Lombok 模型初始化噪声和特定测试内部类告警，不全局压制可变对象暴露等真实缺陷。新增排除必须写到具体类/具体 bug pattern，并在评审中说明原因。

默认 `effort=Max`、`threshold=Low`、`failOnError=true`。存量项目可以先在独立整改分支收敛告警，但主分支 profile 不降低门禁。
