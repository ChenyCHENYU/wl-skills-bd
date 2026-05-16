# 01 · 工具链前置检测（🟡 骨架）

> 在执行任何代码生成 / 审计前，AI 必须确认目标后端工程满足以下工具链基线，否则**红叉暂停**。

## 必检项

- [ ] **JDK**：1.8（与 `mdm-service` 对齐；`<maven.compiler.source>8</maven.compiler.source>`）
- [ ] **Maven**：≥ 3.6.x，能加载父 POM `jh4j-product-mdm-*`
- [ ] **Lombok**：插件已启用（IDE / 编译期）
- [ ] **MyBatis-Plus**：通过 `jh4j-cloud-starter-mybatis` 间接引入，版本由 `jh4j-cloud` 锁定
- [ ] **包结构**：根包 = `com.{company}.{product}`（如 `com.jhict.mdm`），含 `controller/service/mapper` 三个标准子包
- [ ] **必备依赖**：`jh4j-cloud-starter-api`、`fastjson 2.0+`、`hutool 5.x`、`hibernate-validator 6.0+`

## Pre-flight 输出格式

```
✅ JDK 1.8                    ✓ ( target=8 )
✅ Maven 3.8.x                ✓
✅ Lombok                     ✓ ( IDE plugin enabled )
✅ MyBatis-Plus               ✓ ( via jh4j-cloud-starter-mybatis )
✅ 父 POM                     ✓ ( jh4j-product-* 3.1.0 )
[全部就绪]
```

## 失败时

```
❌ 工具链检测失败：未检测到 Lombok 注解处理器
   → 请在 IDE 启用 Lombok 插件；或 Maven build 检查 annotationProcessor
   → ⛔ 代码生成已暂停，修复后重新触发
```

> TODO（0.1.x）：补脚本化 `wl-skills-bd doctor`；补 OS / 中文路径 / 端口冲突等扩展检测项。
