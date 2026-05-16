# 13 · Swagger / API 文档规范（🟡 骨架）

## 框架

- jh4j-cloud 默认集成 Springfox（Swagger 2）
- 文档 UI：`{service}/doc.html`（knife4j）

## 必填注解

| 位置        | 注解                          | 必填项                                  |
| ----------- | ----------------------------- | --------------------------------------- |
| Controller  | `@Api(value = "层级/层级/模块名")` | value                                   |
| 方法         | `@ApiOperation(value = "动作描述")` | value                                   |
| Query 参数  | `@ApiImplicitParam`            | name / value / paramType                |
| DTO / VO 字段 | `@ApiModelProperty`           | value；必填字段加 `required = true`     |
| Entity       | `@ApiModel`                   | 一般业务不暴露 Entity 给前端            |

## 配置类

```java
@Configuration
@EnableSwagger2
public class SwaggerConfig {
    @Bean
    public Docket api() {
        return new Docket(DocumentationType.SWAGGER_2)
                .apiInfo(new ApiInfoBuilder()
                        .title("MDM 主数据服务 API")
                        .version("3.1.0")
                        .build())
                .select()
                .apis(RequestHandlerSelectors.basePackage("com.jhict.mdm.controller"))
                .paths(PathSelectors.any())
                .build();
    }
}
```

## 约束

- `@ApiOperation` 描述必须**用动作 + 对象**："查询特征量分类分页" / "新增特征量分类"
- 时间字段 `@ApiModelProperty` 标注示例：`example = "2026-05-14 12:00:00"`
- 枚举字段 `@ApiModelProperty` 写明值域：`"状态：0=待提交, 1=审核中, 2=已通过"`
- 路径变量必须 `@PathVariable("id")` 显式指定名称（Swagger 才能正确解析）

> TODO（0.1.x）：迁移到 SpringDoc (OpenAPI 3) 的可行性评估；契约导出 `api.yaml` 与前端 `api.md` 双向同步。
