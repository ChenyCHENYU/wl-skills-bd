# 10 · 事务规范（✅ 已落地）

> 事务边界决定数据一致性。规则：写操作必加 @Transactional(rollbackFor)、查询不加、禁止事务内调外部/MQ、禁止自调用。
>
> 强制度：🔴 必遵。be-rules B5 检测写方法缺 @Transactional。

---

## 1. 基本原则（核心，对应 mdm-service 76 处真实写法）

```java
@Transactional(rollbackFor = Exception.class)   // ✅ 显式 rollbackFor
public String save(MdmFeatureCategoryDTO dto) { ... }
```

| 规则 | 说明 | 来源 |
|------|------|------|
| **所有写操作必加** | save/insert/update/delete/batch/import | mdm-service 全部 76 处均带此注解 |
| **显式 rollbackFor = Exception.class** | 避免 checked 异常不回滚导致部分提交 | Spring 默认只回滚 RuntimeException |
| **查询方法不加** | 除需快照一致性的多次查询 | `@Transactional(readOnly = true)` 用于只读（mdm-service 有 2 处） |
| **粒度收敛到 Service 方法** | Controller / 工具方法不加 | — |

## 2. 回滚矩阵（决策表）

| 异常类型 | 默认回滚？ | 加 rollbackFor=Exception.class 后 | 说明 |
|---------|:---:|:---:|------|
| RuntimeException | ✅ | ✅ | Spring 默认 |
| Error | ✅ | ✅ | Spring 默认 |
| checked Exception（IOException 等）| ❌ | ✅ | **必须显式 rollbackFor** |
| 业务 ServiceException | ✅（继承 RuntimeException）| ✅ | 团队基线 ServiceException 是 RuntimeException 子类 |

> **生成代码默认写 `rollbackFor = Exception.class`**，覆盖所有异常，最安全。

## 3. 传播行为场景表

| 传播行为 | 适用场景 | 团队是否用 | 示例 |
|---------|---------|:---:|------|
| **REQUIRED**（默认）| 95% 场景，加入当前事务 | ✅ 主力 | save/update/delete |
| **REQUIRES_NEW** | 独立新事务（如操作日志，主事务回滚也不影响日志）| ✅ 有（mdm-service 操作日志 2 处）| 操作日志记录 |
| **NESTED** | 嵌套事务（SAVEPOINT）| ❌ **不用** | Oracle 不全支持跨连接 SAVEPOINT |
| **SUPPORTS** | 有事务加入，无则非事务 | 少用 | 查询可加可不加 |
| **NOT_SUPPORTED** | 强制非事务执行 | 禁用 | — |
| **NEVER** | 必须非事务 | 禁用 | — |

> 操作日志用 REQUIRES_NEW 的原因：主业务回滚后仍需记录"操作失败"日志（mdm-service `MdmOperationLogService` 真实用法）。

## 4. 隔离级别

- **默认数据库隔离级别**（Oracle = READ COMMITTED；MySQL InnoDB = REPEATABLE READ）
- **禁止随意调到 SERIALIZABLE**（性能急剧下降，生产事故源）
- 特殊场景（脏读防护）用 `@Transactional(isolation = Isolation.READ_COMMITTED)`

## 5. 禁止事项（高频陷阱）

### 5.1 禁止事务内调外部 Feign（超时导致长事务 + 锁占用）

```java
@Transactional(rollbackFor = Exception.class)
public void save() {
    baseMapper.insert(entity);
    remoteClient.sync(entity);   // ❌ Feign 超时 → 数据库连接被占数十秒
}
```

> 正确：Feign 调用移到事务外，或用事务消息保证最终一致。

### 5.2 禁止事务内发 MQ / 邮件 / 短信

```java
@Transactional(rollbackFor = Exception.class)
public void save() {
    baseMapper.insert(entity);
    mqProducer.send(entity);     // ❌ 事务回滚后消息已发，数据不一致
}
```

> 正确：用事务消息，或 `TransactionSynchronizationManager.registerSynchronization` 在提交后发：

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronizationAdapter() {
    @Override public void afterCommit() { mqProducer.send(entity); }  // ✅ 提交后发
});
```

### 5.3 禁止同类自调用绕过事务（Spring AOP 代理失效）

```java
public void outer() {
    this.inner();   // ❌ 直接调用不走代理，inner 的 @Transactional 不生效
}
@Transactional(rollbackFor = Exception.class)
public void inner() { baseMapper.insert(entity); }
```

> 解决方案（按推荐度）：
> 1. **拆到不同 Service**（最佳，符合单一职责）
> 2. 注入自身代理：`@Autowired private XxxService self; self.inner();`
> 3. `AopContext.currentProxy()`（需开启 `exposeProxy = true`）

### 5.4 禁止 try-catch 吞异常导致不回滚

```java
@Transactional(rollbackFor = Exception.class)
public void save() {
    try { baseMapper.insert(entity); }
    catch (Exception e) { log.error("失败", e); }   // ❌ 异常被吞，事务不回滚
}
```

> 正确：catch 后重新抛出（或转换业务码后抛 ServiceException）。

### 5.5 禁止长事务（> 3 秒）

- 先做无副作用计算（校验、转换），最后短事务写库
- 大批量循环写拆成批次，每批独立事务

---

## 6. 线程安全（与事务相关的并发规则）

| 规则 | 说明 | 详见 |
|------|------|------|
| 事务内禁显式 new Thread | 统一用线程池 | 17-bug-prevention R08 |
| SimpleDateFormat 非 static | 事务日志时间线程安全 | 17 R40 |
| ThreadLocal 事务上下文 finally remove | 防线程池串号 | 17 R43 |

## 7. 正反例

```java
✅ @Transactional(rollbackFor = Exception.class)
   public String save(DTO dto) {
       ServiceAssert.isNotNull(dto, "参数不能为空");
       baseMapper.insert(entity);
   }

✅ @Transactional(propagation = Propagation.REQUIRES_NEW)   // 操作日志独立事务
   public void logOperation() { ... }

❌ public void save(DTO dto) {                              // 缺 @Transactional（B5）
       this.validate(dto);                                  // 自调用风险
   }

❌ @Transactional
   public void save() {
       remoteClient.sync();                                 // 事务内 Feign（长事务）
   }
```

## 变更记录
- 2026-07-17 v0.4 补厚（回滚矩阵 + 传播场景表 + self-injection 三方案 + 5 个禁止陷阱 + 真实用法对齐）
- 2026-05-17 v0.0.2 补充线程安全交叉引用
- 2026-05-14 v0.0.1 骨架
