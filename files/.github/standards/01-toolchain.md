# 01 · 工具链前置检测（✅ 已落地）

> 在执行任何代码生成 / 审计前，AI（或 `wl-skills-bd doctor`）必须确认目标后端工程满足以下工具链基线，否则**红叉暂停**。
>
> 强制度：🔴 阻断。未就绪时 codegen / audit Skill 拒绝执行。
>
> 检测方式：静态读取项目文件（pom.xml / bootstrap.yml / application.yml），**无需执行命令**。
>
> **说明**：以下基线是团队 jh4j-cloud 技术栈要求（非对齐某个存量项目）。JDK 版本随团队框架升级演进，优先 Oracle 官方 LTS（当前基线 1.8，新项目建议评估 17 LTS）。

---

## 1. 必检项清单

| # | 检测项 | 期望值 | 检测来源 | 失败处理 |
|---|--------|--------|----------|---------|
| 1 | JDK 版本 | 1.8（`<maven.compiler.source>8</maven.compiler.source>`）| 父/子 pom.xml 的 `<properties>` | 改 pom 或确认目标工程非 jh4j 体系 |
| 2 | Maven | ≥ 3.6.x | 父 POM 能解析 `<parent>jh4j-cloud` | 检查本地 Maven + settings.xml 私服 |
| 3 | Lombok | 注解处理器启用 | pom 含 `lombok` 依赖 + IDE 插件 | IDE 装 Lombok 插件 + 开 Enable |
| 4 | MyBatis-Plus | 通过 `jh4j-cloud-starter-mybatis` 间接引入 | pom 依赖树含 `mybatis-plus` | 确认 starter 未被 exclude |
| 5 | 包结构 | 根包 `com.{company}.{product}` | src/main/java 目录树 | 按 standards/02 包名映射表确认 |
| 6 | 必备依赖 | api/fastjson2/hutool5/hibernate-validator | pom `<dependencies>` | 补缺失依赖 |

---

## 2. 数据库类型探测（关键，决定 SQL 方言）

触发 `db-migration` / `mapper-xml-gen` / `entity-codegen` 前**必须先确认**（standards/12 §0）：

| 探测来源 | 判断规则 | 结论 |
|---------|---------|------|
| pom 含 `jh4j-cloud-starter-oracle-resource-service` 或 `ojdbc8` | Oracle 驱动 | **Oracle**（如 mdm-service）|
| pom 含 `mysql-connector-java` 或 `jh4j-cloud-starter-mysql-resource-service` | MySQL 驱动 | **MySQL**（主流业务）|
| bootstrap.yml `${DATASOURCE:oracle}` | 默认值 oracle | **Oracle** |
| bootstrap.yml `${DATASOURCE:mysql}` | 默认值 mysql | **MySQL** |
| 以上都未命中 | — | ⛔ **暂停，向用户询问** |

> 数据库类型决定：分页语法(ROWNUM/LIMIT)、CONCAT 参数数、注释语法、日期函数（详见 standards/06 方言表）。

---

## 3. Pre-flight 输出格式（codegen/audit Skill 必须）

```
✅ JDK 1.8                    ✓ ( target=8 )
✅ Maven 3.8.x                ✓
✅ Lombok                     ✓ ( 注解处理器已启用 )
✅ MyBatis-Plus               ✓ ( via jh4j-cloud-starter-mybatis )
✅ 父 POM                     ✓ ( jh4j-cloud 3.1.0 )
✅ 数据库类型                 ✓ ( Oracle，探测：starter-oracle-resource-service )
✅ 包结构                     ✓ ( com.jhict.mdm.{controller,service,mapper} )
[全部就绪]
```

## 4. 失败处理（阻断）

```
❌ 工具链检测失败：未检测到 Lombok 注解处理器
   → 请在 IDE 启用 Lombok 插件；或 Maven build 检查 annotationProcessor
   → ⛔ 代码生成已暂停，修复后重新触发

❌ 数据库类型未探测到
   → 检查 pom.xml 的 starter 或 bootstrap.yml 的 ${DATASOURCE}
   → ⛔ db-migration/mapper-xml-gen 已暂停（方言未定）
```

---

## 5. doctor 命令（已落地）

```bash
wl-skills-bd doctor
```

体检 7 项：bd 已 init / Maven 工程 / ArchUnit 规则就位 / Checkstyle 规则就位 / ArchUnit 测试已接入 / pom 已配 Checkstyle / pom 已加 ArchUnit 依赖。未就绪项给修复 hint。

## 变更记录
- 2026-07-17 v0.4 补厚（数据库类型探测决策表 + 7 项检测清单 + doctor 联动）
- 2026-05-14 v0.0.1 骨架
