# 10 · 事务规范（🟡 骨架）

## 基本原则

- **所有写操作** Service 方法必须加 `@Transactional(rollbackFor = Exception.class)`
- 显式声明 `rollbackFor = Exception.class`，避免只回滚 RuntimeException 导致 checked 异常时部分提交
- 查询方法**不加** `@Transactional`（除多次查询需要快照一致性）

## 粒度

- **粒度收敛到 Service 方法**，不要把事务加到 Controller / 工具方法
- 长事务（> 3 秒）必须拆分；先做无副作用计算，最后短事务写库

## 禁止事项

- 禁止在事务方法中调用**外部 Feign 接口**（除非外部服务幂等且业务允许回滚）
- 禁止在事务方法中发送 MQ / 邮件 / 短信（用事务消息或 `TransactionSynchronizationManager.registerSynchronization` 在提交后异步）
- 禁止同类内自调用绕过事务：
  ```java
  // ❌ self.callTx() 这种走非代理不生效
  public void outer() { inner(); }
  @Transactional public void inner() { ... }
  ```
- 禁止 try-catch 后吞异常导致事务不回滚

## 传播行为

- 默认 `Propagation.REQUIRED`，绝大多数场景适用
- 子任务隔离用 `REQUIRES_NEW`（注意性能 / 死锁）
- **不使用** `NESTED`（Oracle 不全支持 SAVEPOINT 跨连接）

## 隔离级别

- 默认数据库隔离级别（Oracle = READ COMMITTED；MySQL InnoDB = REPEATABLE READ）
- **不要随意调整**到 `SERIALIZABLE`，会导致性能急剧下降

> TODO（0.1.x）：补事务消息 / TCC / 本地消息表的团队选型与代码模板。
