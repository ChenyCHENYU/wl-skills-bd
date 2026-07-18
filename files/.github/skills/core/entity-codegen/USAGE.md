# 使用指南：entity-codegen

## 起步

复制 `.github/templates/examples/feature-category.contract.json`，修改资源事实后执行：

```bash
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
```

## 字段示例

```json
{
  "name": "categoryCode",
  "column": "CATEGORY_CODE",
  "javaType": "String",
  "dbType": "VARCHAR2(64 CHAR)",
  "comment": "分类编码",
  "requiredOnCreate": true,
  "writable": true,
  "queryMode": "eq",
  "detail": true,
  "list": true,
  "maxLength": 64
}
```

该字段会进入 Entity/CreateDTO/UpdateDTO/PageDTO/VO/PageVO，但验证、Patch、查询与响应注解按各模型职责不同。`companyId/isDelete/revision` 不按普通字段这样填写。

## 常见边界

- 只读展示字段：`writable=false`，根据 `detail/list` 决定响应；如果它不是数据库列，不应塞进 Entity，需要先扩展协作模型能力；
- 模糊查询：只有明确 `queryMode=like` 才生成 LIKE；
- 金额：使用 BigDecimal，并在 `dbType` 明确 precision/scale；
- 时间：使用当前 Schema 支持的 LocalDate/LocalDateTime，并确认 JSON 与数据库格式；
- 超过 JavaScript 安全整数的 ID：先建立统一字符串序列化契约，不能只在前端临时转型。

## 与其他能力衔接

- `api-design-be` 形成 `wl-contract.json`；
- codegen 同次生成 Service/Mapper/DDL/tests/contracts，避免分层漂移；
- `contract diff` 核对前端/OpenAPI/权限；
- `validate` 与 `mvn verify -Pwl-quality` 做最终验收。
