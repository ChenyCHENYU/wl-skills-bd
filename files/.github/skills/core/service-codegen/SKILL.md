---
name: service-codegen
description: |
  基于 wl-contract.json 生成 Controller + 直接 Service（当前 Profile 直继 JhServiceImpl，无空接口层）。
  含分页/主键查询/新增/修改/删除标准 CRUD，状态变更四段式（校验存在→校验状态→构造patch→updateById），
  以及 v0.9 扩展：customOperations 业务命令/状态机/批量、relations 主从关联查询、export 导出。
  读 templates 填空，生成后跑 validate 查 B1/B2/B5。对标 wl-skills-kit/service-codegen 落地深度。
  典型触发：「生成 Service」「全套 CRUD」「实现业务方法」「写业务逻辑」「生成后端接口」「业务命令」「状态机」「submit/approve」
status: ✅ 已落地
stage: ④ 业务实现
---

# service-codegen

## Pre-flight 声明（必填）

```
🚀 已触发技能 service-codegen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 A
✅ 已读取 standards/02-project-structure.md → 包名 + 分层禁止跨层
✅ 已读取 standards/04-controller.md     → Controller 模板 + 权限码
✅ 已读取 standards/05-service.md        → Service 实现 + 状态变更
✅ 已读取 standards/07-entity-dto-vo.md  → DTO/VO 用法
✅ 已读取 standards/10-transaction.md    → @Transactional 粒度
✅ 已读取 standards/11-security-permission.md → 权限码同步
✅ 已读取 templates/Controller.java.tmpl + Service.java.tmpl
✅ wl-contract.json 已通过 codegen validate
```

## 前置检查

- [ ] `wl-contract.json` 已声明模型字段、外部路径和五类权限码
- [ ] 本次完整 codegen plan 已评审，模型/Service/Mapper/DDL 不会分批漂移
- [ ] Mapper 接口存在或同步在 ⑤ 生成

---

## 执行步骤（4 步）

### 步骤 1：确认占位符

| 变量 | 来源 | 示例 |
|------|------|------|
| `{{rootPackage}}` | 父 pom | `com.jhict.mdm` |
| `{{module}}` | 子域 | `feature` |
| `{{Entity}}` | PascalCase | `MdmFeatureCategory` |
| `{{entity}}` | camelCase | `mdmFeatureCategory` |
| `{{requestPath}}` | Controller 路径（驼峰）| `mdmFeatureCategory` |
| `{{apiDesc}}` | 中文名 | `特征量分类` |
| `{{apiPath}}` | OpenAPI 分组 | `主数据/特征量` |
| `{{permissionPrefix}}` | 权限码前缀 | `mdm_feature_category` |

### 步骤 2：生成 Controller（读模板填空）

读 `templates/Controller.java.tmpl`，5 个标准方法保持模板结构：

| 方法 | HTTP | 路径 | 权限码后缀 |
|------|------|------|-----------|
| queryPage | POST | `queryPage` | `_query_page` |
| getById | GET | `getById/{id}` | `_get_by_id` |
| save | POST | `save` | `_save` |
| updateById | PUT | `updateById` | `_update_by_id` |
| deleteById | DELETE | `deleteById/{id}` | `_delete_by_id` |

> **每个方法必须配 @PreAuthorize + @Operation**（validate 的 B1/B2 会查）。

### 步骤 3：生成 Service（读模板填空）

读 `templates/Service.java.tmpl`。当前 `jh4j3-openapi3` Profile 使用 **Service 直继 JhServiceImpl，无独立接口**；另一种分层形态应新增兼容性 Profile。

标准 5 方法（模板已固化）：

```
queryPage  → mapper.queryPage(page, params, AuthUtil.getLoginCompanyId())
getById    → id + companyId 查询 + ServiceAssert 校验存在
save       → BeanUtil.copyProperties + EntityUtil.setCreateProp + insert
updateById → 租户归属查询 + revision + 字段白名单 + updateById
deleteById → 租户归属查询 + setIsDelete(0) + updateById
```

### 步骤 4：业务方法扩展（customOperations，v0.9 自动生成）

契约声明 `customOperations[]` 时，codegen 按四段式自动生成 Service 方法 + Controller 方法，无需手写：

- `kind=stateTransition`：四段式（校验存在→校验前置→构造 patch→updateById）
- `kind=command`：同 stateTransition 但可不声明 preconditions
- `kind=batch`：`(List<String> ids)` 遍历四段式，返回 `{successCount, failureCount, failedIds}`

preconditions 支持六种操作符：equals/notEquals/in/notIn/isNull/notNull。patch 字段值按 Java 类型生成字面量。requestFields 用 @RequestParam（避免独立 RequestDTO）。

未声明 `customOperations` 时，按**四段式**手工追加业务方法；当前 CRUD codegen 不会从字段名猜状态机：

```
① 校验存在：Entity entity = baseMapper.selectById(id);
             ServiceAssert.isNotNull(entity, "xxx不存在");
② 校验状态：ServiceAssert.isTrue("DRAFT".equals(entity.getStatus()), "仅待提交可操作");
③ 构造 patch：entity.setStatus("APPROVED");
               EntityUtil.setUpdateProp(entity);
④ 持久化：baseMapper.updateById(entity);
```

> 所有写方法（save/update/delete/状态变更）必须加 `@Transactional(rollbackFor = Exception.class)`。

---

## 产物（2 文件，团队基线无独立 Service 接口）

```
xxx-service/.../controller/{module}/{Entity}Controller.java
xxx-service/.../service/{module}/{Entity}Service.java     ← extends JhServiceImpl<Mapper, Entity>
```

---

## 约束（强制）

**Controller**：
- `@RestController` + `@Validated` + `@RequestMapping("驼峰")`
- 每方法 `@PreAuthorize` + `@Operation`（B1/B2 必查）
- 返回 `ApiResult.success(msg, data)`
- **禁止**写业务逻辑（只调 Service）
- **禁止**注入 Mapper（必须经 Service，ArchUnit J1 卡控）

**Service**：
- `extends JhServiceImpl<EntityMapper, Entity>` 获 baseMapper/lambdaQuery/saveBatch
- `@RequiredArgsConstructor` 构造注入（依赖声明 `private final`）
- 写操作 `@Transactional(rollbackFor = Exception.class)`（B5 查）
- 业务校验用 `ServiceAssert`，**禁止** `throw new RuntimeException`（B8 查）
- 审计字段用 `EntityUtil.setCreateProp` / `setUpdateProp`
- 跨 Service 调用：注入其他 Service（@RequiredArgsConstructor），**禁止**直接注入其他 Mapper

---

## 边界用例

| 场景 | 处理 |
|------|------|
| 批量新增 | `saveBatch(list)`（JhServiceImpl 内置），循环内先 `EntityUtil.setCreateProp` |
| 树形查询 | lambdaQuery 查全量 + 内存 `TreeBaseUtil.treeSetList(list, "0")` 构树 |
| 联表查询详情 | getById 中关联查子表（如分类→字段列表），组装到 VO |
| 软删除 | `entity.setIsDelete(0)` + updateById（团队基线 0=删除，1=有效）|
| 乐观锁 | REVISION 字段由 MP @Version 维护，updateById 自动 +1 |
| 状态机 | 四段式，每个状态迁移单独方法（submitForReview/approve/offline）|

---

## 正反例对照

```
✅ @Transactional(rollbackFor = Exception.class)   显式回滚 checked 异常
   public String save(DTO dto) {
       ServiceAssert.isNotNull(dto, "参数不能为空");  ServiceAssert 校验
       EntityUtil.setCreateProp(entity);              审计字段自动填充

❌ public String save(DTO dto) {                    缺 @Transactional（B5）
       if (dto == null) throw new RuntimeException("x");  应 ServiceAssert（B8）
       entity.setCreateUserNo("admin");               手动填审计字段（应用 EntityUtil）
```

---

## 完成摘要

```
✅ service-codegen 完成
   - 产出: Controller / Service（基于 templates 填空）
   - 接口数: {N}（CRUD {5} + 业务方法 {M}）
   - 权限码已对齐: ✓ / ✗
   - @Transactional 覆盖: {N}/{写方法数}
   - ★ 生成后自检: wl-skills-bd validate（B1缺@PreAuthorize / B2缺@Operation / B5缺@Transactional / B8裸异常）
   - 下一步建议: ⑤ mapper-xml-gen
```

## 变更记录
- 2026-07-17 v0.4 补厚落地（执行步骤 + CRUD展开 + 四段式 + 边界用例 + 正反例）+ USAGE.md
- 2026-07-17 v0.2 加 templates 引用
- 2026-05-14 v0.0.1 骨架
