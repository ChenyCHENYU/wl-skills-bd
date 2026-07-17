# 04 · Controller 层规范（✅ 已落地，依据 Spring MVC 官方 + 团队基线）

> 团队基线模板。共性参考 `CLAUDE规范文档/后端` §六，但具体注解 / 返回值用本团队栈。

---

## 类级别声明

```java
@Api(value = "主数据模型管理/特征量模型管理/特征量分类")  // tags 用斜杠表达层级
@RestController
@Validated
@RequestMapping("mdmFeatureCategory")                  // 驼峰资源名，不带版本前缀
public class MdmFeatureCategoryController {
    @Resource
    private MdmFeatureCategoryService mdmFeatureCategoryService;
}
```

**要点**：

- `@Api(value = ...)` 必填，描述层级用斜杠分隔
- `@RestController` + `@Validated`（开启方法级 `@Validated` 校验）
- `@RequestMapping` **不带 `/v1/...` 前缀**（与 HZERO 体系区分），由网关统一加版本
- 注入方式优先 `@Resource`（与团队代码风格一致）
- **不强制继承 BaseController**（与 HZERO 不同）

---

## 标准 CRUD 模板

### 分页

```java
@ApiOperation(value = "查询特征量分类分页")
@ApiImplicitParams({
    @ApiImplicitParam(name = "current", value = "当前页码", dataType = "long", paramType = "query", example = "1"),
    @ApiImplicitParam(name = "size", value = "每页记录条数", dataType = "long", paramType = "query", example = "10")
})
@PreAuthorize("@pms.hasPermission('mdm_feature_category_query_page')")
@PostMapping("queryPage")
public ApiResult<JhPage<List<MdmFeatureCategoryPageVO>>> queryMdmFeatureCategoryPage(
        @ApiIgnore JhPage page,
        @RequestBody @Validated MdmFeatureCategoryPageDTO params) {
    return ApiResult.success("查询成功", mdmFeatureCategoryService.queryMdmFeatureCategoryPage(page, params));
}
```

### 主键查询

```java
@ApiOperation(value = "主键查询数据")
@PreAuthorize("@pms.hasPermission('mdm_feature_category_get_by_id')")
@GetMapping("getById/{id}")
public ApiResult<MdmFeatureCategoryVO> getById(@PathVariable("id") String id) {
    return ApiResult.success("查询成功", mdmFeatureCategoryService.getById(id));
}
```

### 新增

```java
@ApiOperation(value = "新增数据")
@PreAuthorize("@pms.hasPermission('mdm_feature_category_save')")
@PostMapping("save")
public ApiResult<String> insert(@RequestBody @Validated MdmFeatureCategoryDTO dto) {
    return ApiResult.success("新增成功", mdmFeatureCategoryService.save(dto));
}
```

### 修改

```java
@ApiOperation(value = "修改数据")
@PreAuthorize("@pms.hasPermission('mdm_feature_category_update_by_id')")
@PutMapping("updateById")
public ApiResult<Void> updateById(@RequestBody @Validated MdmFeatureCategoryDTO dto) {
    mdmFeatureCategoryService.updateById(dto);
    return ApiResult.success("更新成功", null);
}
```

### 删除

```java
@ApiOperation(value = "删除数据")
@PreAuthorize("@pms.hasPermission('mdm_feature_category_delete_by_id')")
@DeleteMapping("deleteById/{id}")
public ApiResult<Void> deleteById(@PathVariable("id") String id) {
    mdmFeatureCategoryService.deleteById(id);
    return ApiResult.success("删除成功", null);
}
```

---

## 操作日志注解

写操作（save / update / delete / 状态变更）**建议**加 `@MdmOperationLog`（团队自定义注解，aspect 切面采集）：

```java
@MdmOperationLog(module = "特征量分类", operation = "新增")
@PostMapping("save")
public ApiResult<String> insert(...) { ... }
```

> 该注解定义在 `xxx-service/annotation/MdmOperationLog.java`，切面在 `aspect/`。

---

## 返回值规范

| 场景       | 写法                                                        |
| ---------- | ----------------------------------------------------------- |
| 有数据     | `ApiResult.success("xxx成功", data)`                        |
| 无数据     | `ApiResult.success("xxx成功", null)` 或 `ApiResult.success()` |
| 分页       | `ApiResult<JhPage<List<XxxVO>>>`                            |
| 业务错误   | `throw new ServiceException("xxx")` (走全局异常)            |

---

## 权限码规范

`@PreAuthorize("@pms.hasPermission('xxx')")` 中字符串：

- 格式：`{module}_{resource}_{action}`，全小写下划线
- 示例：`mdm_feature_category_query_page` / `mdm_feature_category_save`
- 必须出现在前端 `SYS_PERMISSION_INFO.md` 或同步到权限中心

> 与外部参考的 `@Permission(level = ResourceLevel.ORGANIZATION)` 不同。

---

## 禁止事项

- 禁止在 Controller 写业务逻辑（状态判断、DB 操作、循环计算）
- 禁止直接注入 Mapper（必须经 Service）
- 禁止返回裸对象，必须 `ApiResult` 包装
- 禁止省略 `@PreAuthorize`（公开接口除外，并在类上加 `@Anonymous` 或注释说明）
- 禁止省略 `@ApiOperation` / `@ApiModelProperty`

---

## 变更记录

- 2026-05-14 v0.0.1 落地（基于 `mdm-service/MdmFeatureCategoryController.java`）
