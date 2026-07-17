---
name: service-codegen
description: |
  生成 Controller + Service 接口 + ServiceImpl 三层完整代码。包含分页/主键查询/新增/修改/删除标准 CRUD，
  以及业务状态变更模板（先校验存在→校验状态→构造 patch→updateById）。
  典型触发：「生成 Service」「全套 CRUD」「实现业务方法」「写业务逻辑」
status: 🟡 骨架
stage: ④ 业务实现
---

# service-codegen

## Pre-flight 声明（必填）

```
🚀 已触发技能 service-codegen/SKILL.md
✅ 已读取 standards/index.md             → 任务类型 A
✅ 已读取 standards/02-project-structure.md
✅ 已读取 standards/04-controller.md
✅ 已读取 standards/05-service.md
✅ 已读取 standards/07-entity-dto-vo.md
✅ 已读取 standards/10-transaction.md
✅ 已读取 standards/11-security-permission.md
```

## 前置检查

- [ ] Entity / DTO / VO 已存在（否则回退到 `entity-codegen`）
- [ ] `docs/api/{module}.md` 已存在
- [ ] Mapper 接口存在或同步在 ⑤ 生成

## ★ 生成方式：读模板填空（非自由发挥）

**必须**先读 `templates/Controller.java.tmpl` + `templates/Service.java.tmpl`，按占位符替换：

- `{{rootPackage}}`/`{{module}}`/`{{Entity}}`/`{{permissionPrefix}}` 按工程实际填
- CRUD 方法（queryPage/getById/save/updateById/deleteById）**保持模板结构**，不增删
- 权限码按 standards/04 命名：`{module}_{resource}_{action}`

> 模板已固化 @PreAuthorize/@ApiOperation/@Transactional/JhServiceImpl/ServiceAssert，填空即合规。

## 产物

```
xxx-service/.../controller/{module}/{Entity}Controller.java
xxx-service/.../service/{module}/{Entity}Service.java
xxx-service/.../service/{module}/impl/{Entity}ServiceImpl.java
```

## 约束（骨架）

**Controller**：

- `@RestController` + `@Validated` + `@RequestMapping("xxx")`（驼峰）
- 每个方法带 `@PreAuthorize` + `@ApiOperation`
- 返回 `ApiResult.success(msg, data)`
- 不写业务逻辑

**Service 接口**：

- 继承 `JhService<Entity>`
- 方法用 DTO/VO 签名，不用 Entity

**ServiceImpl**：

- 继承 `JhServiceImpl<Mapper, Entity>` 实现接口
- `@RequiredArgsConstructor` 构造注入
- 写操作 `@Transactional(rollbackFor = Exception.class)`
- 业务校验用 `ServiceAssert`，**不用** `throw new RuntimeException`
- 审计字段统一 `EntityUtil.fillCreateData / fillUpdateData`
- 软删除：patch.setIsDelete(0) + updateById
- 状态变更四段式：requireExist → 状态校验 → patch → updateById

## 完成摘要

```
✅ service-codegen 完成
   - 产出: Controller / Service（基于 templates 填空）
   - 接口数: N
   - 权限码已对齐: ✓ / ✗
   - ★ 生成后自检: 已跑 wl-skills-bd validate（查 B1/B2/B5）
   - 下一步建议: ⑤ mapper-xml-gen
```
