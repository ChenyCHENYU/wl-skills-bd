# 05 · Application Service 规范（✅ 已落地）

> 当前 `jh4j3-openapi3` Profile 采用直接 Service：`XxxService extends JhServiceImpl<Mapper, Entity>`。只有多实现、策略或跨模块边界才抽 `ServicePort + ServiceImpl`；新的形态必须通过兼容性 Profile 固化。

## 1. 职责

Service 是用例编排和事务边界，负责权限之后的数据归属校验、业务校验、状态变化、审计字段、Mapper/远程调用编排。禁止返回 Entity 给 Controller，禁止拼接 SQL，禁止让 Controller 决定租户。

## 2. 查询

- 分页参数使用 `JhPage<XxxPageVO>`，禁止 raw type。
- 详情和列表查询必须带租户条件；租户值由 `AuthUtil.getLoginCompanyId()` 获取，禁止从 DTO 接收。
- `getById` 不是仅按主键查询，而是按 `id + companyId + isDelete` 数据归属查询。

## 3. 新增

```java
@Transactional(rollbackFor = Exception.class)
public String save(XxxCreateDTO dto) {
    Xxx entity = new Xxx();
    BeanUtil.copyProperties(dto, entity);
    EntityUtil.setCreateProp(entity);
    entity.setIsDelete(1);
    entity.setRevision(0);
    ServiceAssert.isTrue(baseMapper.insert(entity) == 1, "新增失败");
    return entity.getId();
}
```

- `EntityUtil.setCreateProp` 已生成 ID 并填充 companyId/create*，禁止再次调用 `IdWorker`。
- 默认值在 Service/Entity 明确设置，不依赖未声明的数据库隐式行为。
- 必须检查影响行数。

## 4. 修改

- UpdateDTO 必须含 id/revision；revision 使用 `@Version` 做乐观锁。
- 先按当前租户查询，再复制允许修改的白名单字段。
- 禁止覆盖 id、companyId、isDelete、createUserNo、createDateTime。
- Patch 语义忽略 null；PUT 全量替换必须由契约明确声明。
- 更新影响行数为 0 时提示并发更新或记录不存在。

## 5. 删除

- 默认只允许软删除：`IS_DELETE` 从 1 变为 0，并填充更新审计字段。
- 默认模板不生成 `deleteBatchIds` 等物理删除入口。
- 物理删除只能由单独的运维/数据治理契约生成，必须预览 SQL、人工确认和审计。

## 6. 事务

- 写用例使用 `@Transactional(rollbackFor = Exception.class)`。
- 不使用同类自调用绕开代理；拆分 Bean 或使用明确的事务模板。
- 外部通知需要提交成功后执行时使用 `@TransactionalEventListener(AFTER_COMMIT)`。
- 不在长事务中执行文件上传、慢网络调用或无界循环。

## 7. 接口抽取决策

| 场景 | 规则 |
|---|---|
| 单模块、单实现、普通 CRUD | 直接 `XxxService` |
| 两个及以上实现 | `XxxServicePort + XxxServiceImpl` |
| 跨模块公开能力 | 在 API 模块声明 Port/Feign 契约 |
| 外部系统适配 | Port + Adapter |
| 为“以后可能有实现”预建接口 | 禁止 |

同一业务子域只能选择一种风格，由 Profile/模块配置记录，ArchUnit 据此校验。

## 8. 业务命令/状态机（customOperations，v0.9）

契约声明 `customOperations[]` 时，codegen 按**四段式**机械生成 Service 方法，覆盖 submit/approve/reject/withdraw/changeStatus/convert/release/close/cancel/batchXxx 等业务命令：

1. **校验存在**：按 id + companyId 查询，ServiceAssert.isNotNull
2. **校验前置**：按 preconditions（equals/notEquals/in/notIn/isNull/notNull）逐条 ServiceAssert
3. **构造 patch**：按 patch 字段列表逐字段 setXxx
4. **持久化**：EntityUtil.setUpdateProp + updateById + 影响行数校验

`kind=batch` 时方法签名改为 `(List<String> ids)`，遍历四段式并返回 `{successCount, failureCount, failedIds}`；单次失败不回滚已成功项，由前端按 failedIds 重试。

业务命令命名规范与 wl-skills-kit api-contract 对齐；B5 规则已扩展识别全部业务命令前缀，确保 @Transactional 覆盖。请求字段用 `@RequestParam`（GET/POST 适用），避免生成独立 RequestDTO；批量操作用 `@RequestBody List<String> ids`。

## 9. 机器门禁

- B5：写方法缺事务为 error；只有公开写方法且不存在事务注解冲突时才允许进入条件安全修复。v0.9 扩展识别 release/close/cancel/withdraw/convert/changeStatus/publish/archive/restore/print/send/reset/assign/transfer/lock/unlock/audit/verify 等业务命令前缀。
- B8：业务层抛裸通用异常，warn。
- B12：公开业务方法缺业务 Javadoc，warn。
- J1：跨层/跨模块非法依赖，error。

## 变更记录

- 2026-07-18 v0.9：新增 §8 业务命令/状态机四段式生成；B5 扩展业务命令前缀识别。
- 2026-07-18 v0.8：以直接 Service 为默认，统一租户、乐观锁、影响行数和软删除规则。
