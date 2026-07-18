# 04 · Controller 与 HTTP 接口规范（✅ 已落地）

> 适用：Spring Boot 2 + jh4j-cloud 3.x。接口文档统一使用 OpenAPI 3；存量 Springfox 代码只允许在 `legacy-springfox` Profile 中维护，不进入新模板。

## 1. 职责与依赖

Controller 只负责协议适配：接收参数、Bean Validation、权限校验、调用 Service、包装 `ApiResult`。禁止直接调用 Mapper、拼 SQL、开启事务或实现业务状态机。

默认依赖同子域的直接 Service 类；存在多实现/跨模块边界时依赖 `ServicePort`，禁止依赖 `ServiceImpl`。

## 2. 类级标准

```java
@Tag(name = "特征量分类")
@Validated
@RestController
@RequestMapping("mdmFeatureCategory")
public class MdmFeatureCategoryController {
    @Resource
    private MdmFeatureCategoryService service;
}
```

- 类必须有 `@RestController`、`@RequestMapping`、`@Validated`、`@Tag`。
- import 禁止通配符。
- 资源路径保持团队 lowerCamelCase 基线；网关服务前缀不在 Controller 重复声明。

## 3. 默认 CRUD 契约

| 场景 | HTTP | 方法路径 | Java 方法 | 返回类型 |
|---|---|---|---|---|
| 分页 | POST | `queryPage` | `queryXxxPage` | `ApiResult<JhPage<XxxPageVO>>` |
| 详情 | GET | `getById/{id}` | `getById` | `ApiResult<XxxVO>` |
| 新增 | POST | `save` | `save` | `ApiResult<String>` |
| 修改 | PUT | `updateById` | `updateById` | `ApiResult<Void>` |
| 删除 | DELETE | `deleteById/{id}` | `deleteById` | `ApiResult<Void>` |

该表是当前 `jh4j3-openapi3` Profile，不是跨系统硬编码。若前端或网关约定 `/list`、`/update`、`/remove`，必须先新增并验证独立兼容性 Profile，再由 codegen 同时生成前后端契约；当前 Profile 禁止资源级随意覆盖 method/path，避免同一服务风格漂移。

## 4. 权限与公开接口

- 每个非公开接口必须有 `@PreAuthorize("@pms.hasPermission('...')")`。
- 公开接口必须用 `@Anonymous`，同时添加 `@WlPublicApi(reason = "...")` 或等价的项目登记；B1 对已登记公开接口豁免。
- 权限码由契约字段 `permissionCode` 生成，格式由 Profile 决定，不在模板中二次推导。

## 5. 参数与响应

- 请求体使用 DTO，禁止直接接收 Entity。
- 新增、修改 DTO 在确定性 codegen 中分离；存量共享 DTO 仅为兼容模式。
- 长 ID 始终以 String 对外，避免 JavaScript 精度丢失。
- 业务响应成功码由 `ApiResult` 统一产生，当前 jh4j-cloud 3.1.0 为 `2000`。
- 分页泛型必须是 `JhPage<XxxPageVO>`，不得写成 `JhPage<List<XxxPageVO>>`。
- Controller 不捕获通用 Exception，由全局异常处理器统一转换。

## 6. OpenAPI 3

- 类使用 `@Tag`，方法使用 `@Operation`，字段使用 `@Schema`。
- 路径变量显式写 `@PathVariable("id")`。
- 新代码禁止 `@Api/@ApiOperation/@ApiModelProperty`。

## 7. 机器门禁

- B1：非公开映射缺 `@PreAuthorize`，error。
- B2：接口缺 `@Operation`，warn；modern Profile 可升级为 error。
- J1：Controller 依赖 Mapper，error。
- contract-diff：HTTP 方法、路径、请求、响应、权限码与契约不一致，error。
- 外部网关路径由契约 `api.externalBasePath` 显式声明；Controller 仍只声明 `requestPath`。

## 变更记录

- 2026-07-18 v0.8：统一 OpenAPI 3、分页泛型、直接 Service 默认模式和契约驱动路径。
