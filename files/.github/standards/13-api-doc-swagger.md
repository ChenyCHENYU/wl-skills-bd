# 13 · API 文档规范（✅ 已落地 · OpenAPI 3 + Knife4j）

> 接口文档是前后端契约载体（codegen 的 api.md 来源），不是可选项。
>
> 强制度：🔴 必遵。be-rules B2 查 @Operation。
> **技术栈**：**Knife4j 4.4.0 + OpenAPI 3**（springdoc）—— **取代**老牌 Springfox 2（已停更，2022 起无更新）。
>
> **依据**：OpenAPI 3 官方规范 + Knife4j 官方（社区最流行的中文增强 UI）+ springdoc-openapi 官方。

---

## 0. 为什么从 Springfox 2 升级到 OpenAPI 3

| 维度 | Springfox 2（旧）| OpenAPI 3 + Knife4j（现代）|
|------|-----------------|---------------------------|
| 维护状态 | **2022 起停更** | springdoc 活跃维护 |
| 注解包 | `io.swagger.annotations.*`（@Api/@ApiOperation）| `io.swagger.v3.oas.annotations.*`（@Tag/@Operation）|
| 配置 | Java Docket Bean（啰嗦）| yml 声明式（简洁）|
| 规范 | Swagger 2.0 | **OpenAPI 3.0**（业界标准）|
| Apifox/Postman 导入 | 兼容但降级 | **原生 OpenAPI 3，无损** |
| 中文 UI | 需自配 | Knife4j 原生中文 |

> **生成代码统一用 OpenAPI 3 注解**（@Tag/@Operation/@Schema）。存量 Springfox 2 迁移必须先评估依赖、Profile 和调用方，再按人工评审的专项计划处理；安全修复器不会改文档技术栈。

---

## 1. 必填注解（OpenAPI 3）

| 位置 | 注解 | 必填项 | 示例 |
|------|------|--------|------|
| Controller 类 | `@Tag` | name（模块名，中文）| `@Tag(name = "特征量分类")` |
| 接口方法 | `@Operation` | summary（动作+对象）| `@Operation(summary = "查询特征量分类分页")` |
| 分页参数 | `@Parameter` | name + description | `@Parameter(name="current", description="当前页码")` |
| 隐藏参数 | `@Parameter(hidden = true)` | — | `@Parameter(hidden = true) JhPage page` |
| DTO/VO 字段 | `@Schema` | description | `@Schema(description = "分类编码")` |
| DTO/VO 类 | `@Schema` | description | `@Schema(description = "特征量分类DTO")` |
| 必填字段 | `@Schema(required = true)` | — | 配合 `@NotBlank` 校验 |

> **与 B2 规则联动**：Controller 接口方法缺 `@Operation` → be-rules B2 告警。

## 2. 注解写法对照（Springfox 2 → OpenAPI 3 迁移）

| Springfox 2（旧） | OpenAPI 3（新）|
|------------------|----------------|
| `@Api(value = "x")` | `@Tag(name = "x")` |
| `@ApiOperation(value = "x")` | `@Operation(summary = "x")` |
| `@ApiImplicitParams({@ApiImplicitParam(...)})` | `@Parameters({@Parameter(...)})` 或参数级 `@Parameter` |
| `@ApiIgnore` | `@Parameter(hidden = true)` |
| `@ApiModel(value = "x")` | `@Schema(description = "x")` |
| `@ApiModelProperty(value = "x")` | `@Schema(description = "x")` |
| `import springfox.documentation.annotations.ApiIgnore` | `import io.swagger.v3.oas.annotations.Parameter` |

## 3. description 规范

- **Controller @Tag.name**：模块中文名（"特征量分类"，不加"管理"后缀，左侧菜单更简洁）
- **@Operation.summary**：动词+对象（"查询分页"/"新增"/"修改"/"删除"/"提交审核"），≤10 字
- **@Operation.description**：复杂业务补详细说明（如"批量导入，返回成功失败条数"）
- **@Parameter.description**：参数中文含义
- **@Schema.description**：字段中文 + 值域（枚举：`"状态：0=待提交, 1=审核中, 2=已通过"`）

## 4. 必填项约束

- 路径变量必须 `@PathVariable("id")` 显式指定名称（OpenAPI 才能正确解析）
- 时间字段 `@Schema(example = "2026-05-14 12:00:00")`
- 枚举字段 `@Schema(description = "状态：0=待提交, 1=审核中, 2=已通过")` 写明值域
- 请求体用 `@RequestBody` + DTO，DTO 字段标 `@Schema` + `@NotBlank`/`@NotNull`
- 响应用 `ApiResult<T>` 包装，泛型 T 是 VO

---

## 5. Knife4j 配置（yml 声明式，无需 Java 配置类）

> **依据**：Knife4j 4.4.0 官方推荐 yml 配置。对比参考项目的 @EnableSwagger2 + Docket Bean，yml 更简洁。

### 基础配置（application.yml）

```yaml
springdoc:
  api-docs:
    path: /v3/api-docs
  swagger-ui:
    path: /doc.html              # Knife4j 增强 UI 入口
    tags-sorter: alpha           # 模块按字母排序
    operations-sorter: alpha     # 接口按字母排序

knife4j:
  enable: true
  setting:
    language: zh_cn              # 中文界面
    enable-footer: false
```

### ★ 按模块分组（group-configs，解决"按模块列举接口"诉求）

```yaml
springdoc:
  group-configs:
    - group: 模型管理
      packages-to-scan: com.jhict.mdm.controller.modelAttributeMap
    - group: 数据集成
      packages-to-scan: com.jhict.mdm.controller.sourceData
    - group: 系统授权
      packages-to-scan: com.jhict.mdm.controller.systemAuthorization
    - group: 特征管理
      packages-to-scan: com.jhict.mdm.controller.feature
```

> 启动后访问 `/doc.html`，左侧菜单按 group 分模块展示，每模块下按 @Tag 分控制器，再按 @Operation 列接口——**清晰直观，按模块列举**。

### 可选：项目级 OpenAPI 信息（Java 极简配置）

```java
@Configuration
public class OpenApiConfig {
    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("MDM 主数据服务 API")
                .description("主数据管理平台后端接口文档")
                .version("v1"));
    }
}
```

> Knife4j 4.4.0 + yml 已能跑起文档；项目信息（title/version）按需加这个 Bean。

---

## 6. 依赖（pom.xml）

```xml
<!-- Knife4j + OpenAPI 3 一站式 starter -->
<dependency>
    <groupId>com.github.xiaoymin</groupId>
    <artifactId>knife4j-openapi3-spring-boot-starter</artifactId>
    <version>4.4.0</version>
</dependency>
```

> 一个 starter 同时带入 springdoc-openapi + Knife4j UI，无需单独引 springdoc。

---

## 7. 生产环境安全（重要）

- 生产环境**关闭文档入口**（防接口泄露）：
  ```yaml
  # application-prod.yml
  springdoc:
    api-docs:
      enabled: false
  knife4j:
    production: true            # 关闭 UI
  ```
- 或加权限拦截 `/doc.html` + `/v3/api-docs`（仅管理员可访问）
- 文档不暴露敏感字段（密码/Token 的 @Schema 用 `example = "***"`）

---

## 8. 与前端 api.md / OpenAPI 的同步

```
后端 Controller @Operation/@Schema
        ↓ springdoc 自动生成
/v3/api-docs（OpenAPI 3 JSON）
        ↓ 导出（脚本/CI）
openapi.json
        ↓ 手动/自动导入
Apifox / Postman（OpenAPI 3 原生支持）
        ↓ 前端对照
api.md（前端 wl-skills-kit 消费）
```

`wl-skills-bd contract diff --strict` 已支持把契约与前端 `wl-api-contract`、运行时 `openapi.json`、权限清单及双方 completion 做确定性核对。Apifox 导入仍由团队平台流程负责，本包不持有平台凭据，也不宣称自动发布。

### 8.1 Apifox 集成最佳实践（v0.11）

Apifox 官方推荐 OpenAPI 3 导入，自动同步文档与 mock。团队基线：

| 方式 | 配置 | 适用 |
|---|---|---|
| **Apifox 定时自动同步**（推荐）| 数据源 URL = `${gateway}/v3/api-docs`，频率 5~30 分钟 | 开发/测试环境 |
| 手动导入 openapi.json | CI 产物下载后手动导入 | 偶发同步 |
| Apifox CLI | `apifox-cli import --type openapi` | CI 集成 |

```yaml
# application-uat.yml（为 Apifox 暴露 api-docs）
springdoc:
  api-docs:
    enabled: true
    path: /v3/api-docs
  swagger-ui:
    enabled: false   # 用 Apifox 不用 Swagger UI
knife4j:
  production: false
```

> 生产环境必须关闭 `/v3/api-docs` 与 `/doc.html`（见 §7），Apifox 同步只在 sit/uat 环境进行。

### 8.2 Swagger 2（io.swagger.annotations）与 OpenAPI 3 并存策略（v0.11）

团队允许两种注解共存，但有明确分级：

| 场景 | 注解 | 规则 | B22 |
|---|---|---|---|
| **新生成代码** | OpenAPI 3（`@Tag`/`@Operation`/`@Schema`）| 强制 | 违规 error |
| **存量 Swagger 2 代码** | Swagger 2（`@Api`/`@ApiOperation`/`@ApiModel`）| 允许保留 | warn（迁移指引）|
| **同类混用** | 同一类同时有 `@Api` 和 `@Tag` | 禁止（文档冗余）| error |
| **Apifox 导入** | 统一 OpenAPI 3 | springdoc 聚合输出 | — |

> **为什么允许 Swagger 2 保留**：mdm-service 全工程是 Swagger 2，强制迁移成本高且无业务收益。springdoc 1.7.0 能识别 Swagger 2 注解并聚合输出 OpenAPI 3 JSON，Apifox 导入不受影响。新代码统一 OpenAPI 3 即可逐步收敛。

**迁移指引**（存量 → OpenAPI 3）：

1. 评估依赖：springfox 是否还有其他用途（Docket Bean、拦截器）
2. 引入 springdoc（Spring Boot 2.x 用 1.7.0）：`springdoc-openapi-ui`
3. 注解替换按 §2 对照表（@Api→@Tag、@ApiOperation→@Operation）
4. 移除 Docket Bean 配置
5. 验证 `/v3/api-docs` 输出完整
6. Apifox 重新同步

> 安全修复器不会改文档技术栈；迁移走专项 PR。

---

## 9. 🔴 反面教材（参考项目与 mdm-service 的 Swagger 缺陷，禁止沿用）

| 缺陷 | 来源 | 整改 |
|------|------|------|
| @Tag 中文乱码（`"寮傚父绠＄悊"`）| 参考项目（GBK 编码 bug）| 文件存 UTF-8，IDE 编码统一 UTF-8 |
| @Parameter 用 0 次（参数无文档）| 参考项目 | 分页/查询参数必须 @Parameter |
| Controller 直连 Mapper（跨层）| 参考项目 | 走 Service，见 standards/02 + ArchUnit J1 |
| group-configs 仅 default 单组 | 参考项目 | 按 modules 拆 group（§5）|
| **全工程 Swagger 2 注解**（mdm-service）| mdm-service `import io.swagger.annotations.Api` | 新代码用 OpenAPI 3；存量允许保留（B22 warn）；同类混用禁止（B22 error）|

---

## 10. codegen 自检（B2）

Controller 生成后跑 `wl-skills-bd validate`：
- B2 查接口方法缺 `@Operation`（OpenAPI 3）或 `@ApiOperation`（Springfox 2 兼容存量）
- B22（v0.11）查同类混用 Swagger 2 与 OpenAPI 3 注解（error）；纯 Swagger 2 存量（warn）

模板（Controller.java.tmpl）已用 OpenAPI 3 注解，填空即合规。

## 变更记录
- 2026-07-18 v0.11：新增 §8.1 Apifox 集成最佳实践 + §8.2 Swagger 2/OpenAPI 3 并存策略；B22 分级检测（混用 error / 纯 Swagger 2 warn）。
- 2026-07-17 v0.7 重写为 OpenAPI 3 + Knife4j 落地（从 Springfox 2 骨架升级）；强制度 🟡建议 → 🔴必遵
- 2026-05-14 v0.0.1 骨架（Springfox 2，已过时）
