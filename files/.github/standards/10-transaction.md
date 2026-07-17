# 10 · 事务规范（✅ 已落地）

> 事务边界决定数据一致性。
>
> 强制度：🔴 必遵。be-rules B5 检测写方法缺 @Transactional。
>
> **依据**：Spring Framework 官方文档《Using @Transactional》《Transaction Propagation》《Method visibility and @Transactional in proxy mode》。

---

## 1. 基本原则

```java
@Transactional(rollbackFor = Exception.class)   // ✅ 显式 rollbackFor
public String save(DTO dto) { ... }
```

| 规则 | 说明 | 依据 |
|------|------|------|
| **写操作必加 @Transactional** | save/insert/update/delete/batch/import | Spring 官方：声明式事务 |
| **显式 rollbackFor = Exception.class** | 覆盖 checked 异常，避免部分提交 | Spring 官方：默认只回滚 RuntimeException/Error |
| **查询方法默认不加** | 除需快照一致性的多次查询用 `readOnly = true` | Spring 官方 |
| **粒度收敛到 Service 方法** | Controller / 工具方法不加 | 单一职责 |

## 2. 方法可见性（Spring 官方约束，高频踩坑）

> **依据 Spring 官方**：在**代理模式**（默认）下，只有 **public** 方法经代理拦截，事务才生效。`protected/private/包级` 方法的 @Transactional **不生效**（AspectJ 模式除外）。

```java
@Transactional   // ✅ public，生效
public void save(DTO dto) { ... }

@Transactional   // ❌ private，代理模式下不生效（静默失败，最危险）
private void inner() { ... }
```

## 3. 回滚矩阵

| 异常类型 | 默认回滚？ | 加 rollbackFor=Exception.class 后 |
|---------|:---:|:---:|
| RuntimeException | ✅ | ✅ |
| Error | ✅ | ✅ |
| checked Exception（IOException 等）| ❌ | ✅ |
| 业务 ServiceException | ✅（RuntimeException 子类）| ✅ |

> 生成代码默认写 `rollbackFor = Exception.class`，覆盖所有异常，最安全。

## 4. 传播行为（Spring 官方 Transaction Propagation）

| 传播行为 | 适用场景 | 团队是否用 |
|---------|---------|:---:|
| **REQUIRED**（默认）| 95% 场景，加入当前事务 | ✅ 主力 |
| **REQUIRES_NEW** | 独立新事务（如操作日志，主事务回滚也不影响日志）| ✅ 有 |
| **NESTED** | 嵌套事务（SAVEPOINT）| ❌ 不用（Oracle 不全支持跨连接 SAVEPOINT）|
| **SUPPORTS** | 有事务加入，无则非事务 | 少用 |

> 操作日志用 REQUIRES_NEW：主业务回滚后仍需记录"操作失败"日志。

## 5. 隔离级别

- **默认数据库隔离级别**（Oracle = READ COMMITTED；MySQL InnoDB = REPEATABLE READ）
- **禁止随意调到 SERIALIZABLE**（性能急剧下降，生产事故源）

## 6. self-invocation 失效（Spring 官方明确，最高频陷阱）

> **依据 Spring 官方**：基于代理的 AOP，**同类内部直接方法调用不走代理**，被调用方法的 @Transactional 不生效。

```java
public void outer() {
    this.inner();   // ❌ 直接调用不走代理，inner 的 @Transactional 不生效
}
@Transactional(rollbackFor = Exception.class)
public void inner() { baseMapper.insert(entity); }
```

**官方推荐解决方案（按推荐度）**：
1. **拆到不同 Bean**（最佳，符合单一职责）
2. 注入自身代理：`@Autowired @Lazy private XxxService self; self.inner();`
3. `AopContext.currentProxy()`（需开启 `@EnableAspectJAutoProxy(exposeProxy = true)`）

## 7. 禁止事项（官方约束 + 社区最佳实践）

| 禁止 | 原因 | 依据 |
|------|------|------|
| 事务内调 Feign/HTTP | 超时→长事务→锁占用 | Spring 官方 Solutions to Common Problems |
| 事务内发 MQ/邮件/短信 | 回滚后消息已发，数据不一致 | Spring Transaction-bound Events；用 `afterCommit` |
| 同类自调用 @Transactional 方法 | 代理失效，事务不生效 | Spring 官方 self-invocation |
| try-catch 吞异常 | 事务不回滚 | — |
| @Transactional 加 private 方法 | 代理模式不生效 | Spring 官方方法可见性 |
| 长事务（> 3 秒）| 锁占用、连接耗尽 | 先无副作用计算，最后短事务写 |

### 事务内发消息的正确做法（Spring 官方 Transaction-bound Events）

```java
// ✅ 用 afterCommit 钩子，提交后才发消息
@EventListener(condition = "@transactionSynchronizationManager.isActualTransactionActive()")
// 或
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override public void afterCommit() { mqProducer.send(entity); }
});
```

---

## 8. 🔴 反面教材（mdm-service 存量缺陷，禁止沿用）

> mdm-service 的 `saveSystemAuthorization`：方法内先调 Feign 建客户端、最后写库，**却没加 @Transactional**，且网络调用与 DB 写混用。故障时留脏数据。
>
> **整改**：写操作必加 @Transactional；Feign 调用移到事务外或用事务消息。

## 9. 线程安全（与事务相关的并发规则）

| 规则 | 说明 | 详见 |
|------|------|------|
| 事务内禁显式 new Thread | 统一用线程池 | 17 R08 |
| SimpleDateFormat 非 static | 时间线程安全 | 17 R40 |
| ThreadLocal 事务上下文 finally remove | 防线程池串号 | 17 R43 |

## 10. 正反例

```java
✅ @Transactional(rollbackFor = Exception.class)
   public String save(DTO dto) {
       ServiceAssert.isNotNull(dto, "参数不能为空");
       baseMapper.insert(entity);
   }

✅ @Transactional(propagation = Propagation.REQUIRES_NEW)   // 操作日志独立事务
   public void logOperation() { ... }

❌ public void save(DTO dto) {                              // 缺 @Transactional（B5）
       this.validate(dto);                                  // 自调用风险（事务失效）
   }

❌ @Transactional
   public void save() {
       remoteClient.sync();                                 // 事务内 Feign（长事务）
   }
```

## 变更记录
- 2026-07-17 v0.4.2 修正：依据 Spring 官方文档重写（self-invocation/方法可见性/Propagation）；标注 mdm-service 反面
- 2026-07-17 v0.4 补厚（误用 mdm-service 为基线，已纠正）
- 2026-05-14 v0.0.1 骨架
