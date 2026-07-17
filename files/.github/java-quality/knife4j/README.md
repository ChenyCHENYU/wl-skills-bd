# Knife4j + OpenAPI 3 在线接口文档（J7）

> **作用**：启动后访问 `/doc.html`，按模块分组的中文接口文档，清晰直观。对标前端 Swagger UI 但更符合中文团队习惯。
>
> 官方：https://doc.xiaominfo.com/ （Knife4j 4.4.0，社区最流行的 Swagger 增强 UI）
> 规范：https://spec.openapis.org/oas/v3.0.3 （OpenAPI 3 官方）
> 依赖：`knife4j-openapi3-spring-boot-starter`（一站式带入 springdoc + UI）

## 为什么用 Knife4j + OpenAPI 3（不用 Springfox 2）

| 维度 | Springfox 2（旧）| Knife4j + OpenAPI 3（现代）|
|------|-----------------|---------------------------|
| 维护 | 2022 起停更 | 活跃 |
| 配置 | Java Docket Bean | yml 声明式 |
| UI | 英文 Swagger UI | Knife4j 中文增强 UI |
| 规范 | Swagger 2.0 | OpenAPI 3.0 |
| Apifox 导入 | 降级兼容 | 原生无损 |
| 模块分组 | 不支持 | group-configs 原生支持 |

> 详见 `standards/13-api-doc-swagger.md`。

## 接入步骤（3 步）

### 1. 加依赖（pom.xml，见 maven-snippets/pom-plugins.xml 的 Knife4j 段）

```xml
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>4.4.0</version>
</dependency>
```

### 2. 加 yml 配置（按模块分组）

复制 `knife4j-config.yml.tmpl` 到工程的 `application.yml`，按业务模块改 `group-configs`：

```yaml
springdoc:
  swagger-ui:
    path: /doc.html
    tags-sorter: alpha
    operations-sorter: alpha
  group-configs:
    - group: 模型管理
      packages-to-scan: com.jhict.mdm.controller.modelAttributeMap
    - group: 数据集成
      packages-to-scan: com.jhict.mdm.controller.sourceData
knife4j:
  enable: true
  setting:
    language: zh_cn
```

### 3. 启动访问

```
http://localhost:{port}/{context-path}/doc.html
```

左侧菜单：group（模块）→ @Tag（控制器）→ @Operation（接口），清晰按模块列举。

## 注解规范（OpenAPI 3，对应 standards/13）

| 位置 | 注解 |
|------|------|
| Controller 类 | `@Tag(name = "模块名")` |
| 接口方法 | `@Operation(summary = "动作+对象")` |
| 参数 | `@Parameter(name, description)` / `@Parameter(hidden = true)` |
| DTO/VO 字段 | `@Schema(description = "字段中文")` |
| DTO/VO 类 | `@Schema(description = "类说明")` |

> codegen 模板已用 OpenAPI 3 注解，填空即合规。

## 生产环境关闭

```yaml
# application-prod.yml
springdoc:
  api-docs:
    enabled: false
knife4j:
  production: true
```

防接口泄露（OWASP：生产环境不应暴露 API 文档）。

## 与 Apifox 同步（roadmap）

```bash
# 导出 OpenAPI 3 JSON（启动后访问）
curl http://localhost:port/context/v3/api-docs -o openapi.json
# 手动导入 Apifox（Apifox 原生支持 OpenAPI 3）
```

> 未来集成 Apifox CLI 自动同步（需团队 Apifox 平台就绪）。

## 常见问题

**Q：Knife4j 和 springdoc 什么关系？**
A：springdoc-openapi 是 OpenAPI 3 的 Java 实现（生成 /v3/api-docs）；Knife4j 是 UI 增强（提供 /doc.html 中文界面）。`knife4j-openapi3-spring-boot-starter` 一个依赖同时带入两者。

**Q：为什么按 group 分组？**
A：业务模块多时，单个文档列表几百个接口没法看。group-configs 按包扫描拆分，左侧菜单按模块分组，每模块独立清晰。

**Q：Knife4j 4.4.0 兼容 Spring Boot 2.x 吗？**
A：兼容。团队基线 Spring Boot 2.6.x + Knife4j 4.4.0 已验证可用。
