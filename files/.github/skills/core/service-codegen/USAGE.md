# 使用指南：生成业务服务（service-codegen）

生成 Controller + Service 两层代码（当前 Profile 的 Service 直继 JhServiceImpl，无空接口层）。确定性生成覆盖标准 CRUD；额外业务动作必须有已确认规则。

## 触发词

```
生成 Service / 全套 CRUD / 实现业务方法 / 写业务逻辑 / 生成后端接口 / 生成 Controller
```

## 典型场景

### 场景 A：标准 CRUD 接口（最常见）

输入：已通过 Schema/语义校验的 `wl-contract.json`
产出：Controller（5 方法）+ Service（5 方法）

```
用户：帮我生成 特征量分类 的全套 CRUD 接口
AI：  → 读 templates/Controller.java.tmpl 填空（5 方法 + 权限码）
      → 读 templates/Service.java.tmpl 填空（CRUD + @Transactional）
      → 跑 validate（查 B1/B2/B5）
```

### 场景 B：含状态变更（审核流）

**v0.9 起优先用契约 `customOperations` 自动生成**（推荐），无需手写：

```json
{
  "customOperations": [{
    "name": "submitForReview",
    "method": "POST", "path": "submitForReview/{id}",
    "permission": "mdm_feature_category_submit",
    "kind": "stateTransition",
    "preconditions": [{ "field": "status", "operator": "equals", "value": "DRAFT", "message": "仅待提交可操作" }],
    "patch": [{ "field": "status", "value": "PENDING" }]
  }]
}
```

codegen 自动生成 Controller 方法 + Service 四段式（校验存在→校验前置→构造 patch→updateById）。

**无契约驱动时手写四段式**：
```java
@Transactional(rollbackFor = Exception.class)
public void submitForReview(String id) {
    // ① 校验存在
    MdmFeatureCategory entity = lambdaQuery().eq(...).one();
    ServiceAssert.isNotNull(entity, "分类不存在");
    // ② 校验状态
    ServiceAssert.isTrue("DRAFT".equals(entity.getStatus()), "仅待提交可操作");
    // ③ 构造 patch
    entity.setStatus("PENDING");
    EntityUtil.setUpdateProp(entity);
    // ④ 持久化
    int affected = baseMapper.updateById(entity);
    ServiceAssert.isTrue(affected == 1, "更新失败");
}
```

> ⚠️ **B20**：业务方法内禁止发 MQ/HTTP（事务回滚后消息已发）；用事务消息 + afterCommit。

### 场景 C：批量导入

```java
@Transactional(rollbackFor = Exception.class)
public void batchImport(List<MdmFeatureCategoryDTO> list) {
    List<MdmFeatureCategory> entities = list.stream().map(dto -> {
        MdmFeatureCategory e = new MdmFeatureCategory();
        BeanUtil.copyProperties(dto, e, "id");
        EntityUtil.setCreateProp(e);
        return e;
    }).collect(Collectors.toList());
    saveBatch(entities);
}
```

### 场景 D：联表详情查询

getById 中关联查子表，组装到 VO：
```java
public MdmFeatureCategoryVO getById(String id) {
    MdmFeatureCategory entity = baseMapper.selectById(id);
    ServiceAssert.isNotNull(entity, "分类不存在");
    MdmFeatureCategoryVO vo = new MdmFeatureCategoryVO();
    BeanUtil.copyProperties(entity, vo);
    // 关联查字段列表
    List<MdmFeatureField> fields = fieldService.lambdaQuery()
        .eq(MdmFeatureField::getCategoryId, id).list();
    vo.setFields(fields.stream().map(...).collect(toList()));
    return vo;
}
```

## 权限码命名速查

```
{module}_{resource}_{action}

mdm_feature_category_query_page     分页
mdm_feature_category_get_by_id      详情
mdm_feature_category_save           新增
mdm_feature_category_update_by_id   修改
mdm_feature_category_delete_by_id   删除
mdm_feature_category_submit         业务动作（如提交审核）
```

> 权限码必须同步到前端 `SYS_PERMISSION_INFO.md`（standards/11）。

## validate 自检对照

生成后跑 `wl-skills-bd validate`，重点查：

| 规则 | 查什么 | 修复 |
|------|--------|------|
| B1 | Controller 方法缺 @PreAuthorize | 补权限码注解 |
| B2 | Controller 方法缺 @Operation | 补 OpenAPI 3 注解 |
| B5 | 写操作方法缺 @Transactional | 加 @Transactional(rollbackFor=Exception.class) |
| B8 | throw new RuntimeException | 改 ServiceAssert / ServiceException |

## FAQ

**Q：为什么没有 Service 接口 + Impl 两层？**
A：当前 `jh4j3-openapi3` Profile 使用直接 Service，避免只有单实现时的空接口层。只有存在多实现、明确模块端口或替换策略时才增加接口，并应通过新的兼容性 Profile 固化，不能按单个资源临时漂移。

**Q：Controller 能不能直接调 Mapper？**
A：**禁止**。ArchUnit（J1）会卡：`controller.. ✗→ mapper..`。必须经 Service。

**Q：跨 Service 调用怎么注入？**
A：`@RequiredArgsConstructor` + `private final OtherService otherService`。**禁止**注入其他 Service 的 Mapper。

**Q：软删除还是物理删除？**
A：团队基线用软删除（`IS_DELETE = 0`）。deleteById 方法做 `entity.setIsDelete(0) + updateById`，不调 `deleteById`（MP 物理删）。

**Q：@Transactional 加在 Controller 还是 Service？**
A：**Service**。Controller 不加事务注解（standards/10）。
