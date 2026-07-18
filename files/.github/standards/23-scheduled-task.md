# 23 · 定时任务规范（✅ 已落地）

> 定时任务是分布式系统的事故高发区：多实例重复执行、任务卡死无超时、幂等缺失重复处理、失败无重试或重试风暴。本规范把社区血泪教训固化为团队基线。
>
> 强制度：🔴 必遵。
>
> **依据**：Spring @Scheduled 官方、ShedLock 官方、XXL-Job 官方、Quartz 官方。

---

## 1. 技术选型

| 方案 | 适用 | 团队基线 |
|---|---|---|
| **Spring @Scheduled** | 单实例简单任务 | ✅ 小任务 |
| **ShedLock** | 多实例分布式锁定 | ✅ 配合 @Scheduled |
| **XXL-Job** | 分布式任务调度中心 | 🟡 重型任务、可视化管理 |
| **Quartz** | 复杂调度（cron/dag）| 🟡 按需 |

> jh4j-cloud 默认 @Scheduled + ShedLock。重型任务（数据分发、批量校验、对账）走 XXL-Job。

## 2. @Scheduled 基础规范

```java
@Component
@Slf4j
public class OrderSyncJob {
    @Scheduled(cron = "0 0 1 * * ?")  // 每天 1:00
    public void syncOrders() { ... }
}
```

| 要求 | 说明 | 依据 |
|---|---|---|
| cron 必须外部化 | 写在 yml/nacos，禁止硬编码 | Spring 官方 |
| 必须开 `@EnableScheduling` | 主类或配置类声明 | Spring 官方 |
| 任务类必须 `@Component` | 交由 Spring 管理 | Spring 官方 |
| 禁止 `fixedRate` 做业务调度 | 间隔固定，不考虑执行耗时 | 用 `fixedDelay` 或 cron |

```yaml
# application.yml
jhict:
  scheduled:
    order-sync: "0 0 1 * * ?"
    data-distribute: "0 0/30 * * * ?"
```

```java
@Scheduled(cron = "${jhict.scheduled.order-sync}")
```

## 3. 多实例防重复执行（ShedLock 官方）

> **核心问题**：@Scheduled 在每个实例都触发，N 个实例 = N 次执行，导致重复处理、数据错乱。

```java
@Scheduled(cron = "${jhict.scheduled.order-sync}")
@SchedulerLock(name = "orderSync", lockAtMostFor = "30m", lockAtLeastFor = "5m")
public void syncOrders() { ... }
```

| 参数 | 说明 | 最佳实践 |
|---|---|---|
| `name` | 锁名，全局唯一 | 任务方法名 |
| `lockAtMostFor` | 最大持锁时间（防实例宕机死锁）| > 任务预估最慢时间 |
| `lockAtLeastFor` | 最小持锁时间（防多实例时钟误差抢锁）| 任务预估平均时间 |

```java
// ShedLock 配置（Redis 或 JDBC）
@Bean
public LockProvider lockProvider(RedisConnectionFactory factory) {
    return new RedisLockProvider(factory, "wl-sale");
}
@EnableSchedulerLock(defaultLockAtMostFor = "30m")
```

> **禁止**：多实例场景下裸 @Scheduled 不加 @SchedulerLock。开发环境单实例可不加，但必须在任务类注释声明。

## 4. 幂等性（重复处理事故源）

定时任务**必须幂等**，即使重复执行也不产生副作用：

| 场景 | 幂等策略 |
|---|---|
| 数据同步 | 按 businessKey + updateTime 增量；已处理的不重复 |
| 对账 | 按对账批次号 + 状态机；已完成的不重复 |
| 数据清理 | 按条件批量；WHERE 保证可重入 |
| 状态推送 | 按目标系统 + 事件ID 去重；已推送的跳过 |

```java
// ✅ 幂等：按 updateTime 增量
List<Order> pending = orderMapper.listByUpdateTimeAfter(lastSyncTime);
lastSyncTime = pending.stream().map(Order::getUpdateTime).max(...).orElse(lastSyncTime);

// ❌ 非幂等：每次全量推送
List<Order> all = orderMapper.selectList(null);
pushToErp(all);
```

## 5. 超时与熔断（任务卡死事故源）

```java
@Scheduled(cron = "${jhict.scheduled.order-sync}")
@SchedulerLock(name = "orderSync", lockAtMostFor = "30m")
public void syncOrders() {
    ExecutorService executor = Executors.newSingleThreadExecutor();
    Future<?> future = executor.submit(this::doSync);
    try {
        future.get(25, TimeUnit.MINUTES);  // 业务超时 < 锁超时
    } catch (TimeoutException e) {
        future.cancel(true);
        log.error("订单同步超时", e);
        alertService.notify("订单同步任务超时");
    } finally {
        executor.shutdown();
    }
}
```

| 要求 | 说明 |
|---|---|
| 业务超时 < 锁超时 | 否则锁过期后多实例并发执行 |
| 超时必须告警 | 接入钉钉/邮件/企业微信 |
| 必须有监控 | 任务执行频次、耗时、失败率 |

## 6. 失败处理

| 策略 | 适用 | 限制 |
|---|---|---|
| 不重试（默认） | 非关键任务 | 下次周期自动执行 |
| 内部重试 ≤ 3 次 | 网络/外部依赖抖动 | 指数退避，总时长 < 业务超时 |
| 死信告警 | 关键任务 | 失败入死信表，人工介入 |
| 禁止无限重试 | — | 会形成重试风暴 |

```java
// ✅ 重试模板（Spring Retry）
@Retryable(value = {ResourceAccessException.class}, maxAttempts = 3,
    backoff = @Backoff(delay = 1000, multiplier = 2))
public void callExternal() { ... }

@Recover
public void recover(ResourceAccessException e) {
    log.error("外部调用重试耗尽，入死信", e);
    deadLetterService.save(task, e.getMessage());
}
```

## 7. 日志与监控

```java
@Scheduled(cron = "${jhict.scheduled.order-sync}")
public void syncOrders() {
    long start = System.currentTimeMillis();
    int success = 0, failure = 0;
    try {
        // 业务逻辑
        log.info("[定时任务] 订单同步开始");
        // ...
        log.info("[定时任务] 订单同步完成，成功{}，失败{}，耗时{}ms", success, failure, System.currentTimeMillis() - start);
    } catch (Exception e) {
        log.error("[定时任务] 订单同步异常，耗时{}ms", System.currentTimeMillis() - start, e);
        throw e;  // 重新抛出，让框架记录失败
    }
}
```

- **必须**有开始/结束/耗时日志
- **必须**有成功/失败计数
- **建议**接入任务监控面板（Prometheus + Grafana）

## 8. 与事务/MQ 的关系

| 规则 | 说明 | 依据 |
|---|---|---|
| 任务方法本身不加 @Transactional | 任务是批处理，事务粒度收敛到内部单条/单批 | 10-transaction |
| 任务内发 MQ 用 afterCommit | 防事务回滚消息已发 | Spring 官方 |
| 任务内调外部服务必须超时 | 防 Feign/HTTP 阻塞 | 22-resilience |
| 任务内禁止物理删除 | 软删 + 审计 | 21-sensitive-write |

## 9. 正反例

```java
// ✅ 完整定时任务：cron 外部化 + ShedLock + 幂等 + 超时 + 日志
@Component
@Slf4j
@RequiredArgsConstructor
public class OrderSyncJob {
    private final OrderService orderService;
    private final AlertService alertService;

    @Scheduled(cron = "${jhict.scheduled.order-sync}")
    @SchedulerLock(name = "orderSync", lockAtMostFor = "30m", lockAtLeastFor = "5m")
    public void syncOrders() {
        long start = System.currentTimeMillis();
        try {
            log.info("[定时任务] 订单同步开始");
            int count = orderService.syncIncremental();
            log.info("[定时任务] 订单同步完成，同步{}条，耗时{}ms", count, System.currentTimeMillis() - start);
        } catch (Exception e) {
            log.error("[定时任务] 订单同步异常，耗时{}ms", System.currentTimeMillis() - start, e);
            alertService.notifyDingTalk("订单同步任务失败：" + e.getMessage());
            throw e;
        }
    }
}

// ❌ 裸 @Scheduled + 硬编码 cron + 无锁 + 无幂等 + 无超时
@Component
public class BadJob {
    @Scheduled(fixedRate = 60000)
    public void run() {
        orderMapper.selectList(null).forEach(this::push);  // 全量推送，重复
    }
}
```

## 变更记录

- 2026-07-18 v0.11：新增定时任务规范，基于 mdm-service 的 FeatureCategoryJob 空壳实证和 ShedLock 官方最佳实践。
