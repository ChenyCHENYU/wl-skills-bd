# data-safety USAGE

> 一页纸速查：把 Redis/敏感写/限流熔断/定时任务/多环境/配置分层的事故源降到机器兜底层。
> 覆盖 standards 20~25 + be-rules B13~B23 + config/troubleshoot 工具闭环。

## 速查表

| 我要做... | 必读 | 关键 B 规则 / 工具 |
|---|---|---|
| 写 Redis 缓存 | 20 §1~§4 | B13（TTL）/B14（锁）/B15（禁令）/B16（序列化） |
| 实现分布式锁 | 20 §3 | B14（必须 Redisson RLock；长 TTL>10min 需 watchdog） |
| 批量写库 | 21 §2 | B19（≤1000）/分批游标 |
| 删除数据 | 21 §3 | B17（禁物理删，软删 IS_DELETE=0） |
| 写 Mapper XML | 06 + 21 §4 | B18（update/delete 必有 WHERE） |
| 事务内发消息/HTTP | 10 §7 + 22 | **B20 error**（移出事务或用事务消息 + afterCommit） |
| 调用其他服务 | 22 §1~§7 | B21（HttpUtil/RestTemplate 必须超时）+ Feign 熔断 + 降级 |
| 限流防刷 | 22 §5 | Sentinel/Resilience4j |
| 写定时任务 | 23 | @SchedulerLock 多实例防重复 + 幂等 + 超时 |
| Swagger 注解 | 13 §8 | B22（新代码 OpenAPI 3；同类混用 error） |
| 巨型 Service 拆分 | 02 + 19 | B23（注入依赖 > 10 按子域拆分） |
| 生产发布 | 12 §8.5 + 21 §8 | 审批 + 备份 + 窗口 + 只读护栏 |
| 配置管理/迁移 | 25 | `config init/migrate/doctor/fix` |
| 本地启动不了 | 25 §5 | `config doctor --probe` + `troubleshoot` |

## 典型场景对照

### 场景 1：业务加缓存（B13/B15/B16）

```java
// 1. Key 命名：{env}:{module}:{biz}:{id}
String key = "prod:mdm:cache:dict:" + dictCode;

// 2. Cache-Aside + 随机 TTL（防雪崩）
String cached = redisTemplate.opsForValue().get(key);
if (cached != null) return "NULL".equals(cached) ? null : deserialize(cached);
String value = mapper.queryDict(dictCode);
int ttl = 3600 + ThreadLocalRandom.current().nextInt(600);  // 60~70 分钟随机
redisTemplate.opsForValue().set(key, serialize(value), ttl, TimeUnit.SECONDS);  // ✅ 带 TTL

// 3. 防穿透：空值缓存（短 TTL）
if (value == null) {
    redisTemplate.opsForValue().set(key, "NULL", 300, TimeUnit.SECONDS);
}
```

### 场景 2：分布式锁（B14，必须 Redisson）

```java
// ✅ Redisson RLock（自动续期 watchdog + 可重入 + 安全释放）
RLock lock = redissonClient.getLock("prod:sale:lock:order:" + orderId);
try {
    if (!lock.tryLock(3, 30, TimeUnit.SECONDS)) throw new ServiceException("请稍后再试");
    // 业务逻辑
} finally {
    if (lock.isHeldByCurrentThread()) lock.unlock();
}

// ❌ setIfAbsent 自实现锁（B14 error）
// ❌ setIfAbsent(k, v, 1, TimeUnit.HOURS) 长 TTL 无 watchdog（B14 error，业务超时>锁超时）
```

### 场景 3：防重复下单（幂等）

```java
String idempotentKey = "prod:sale:idempotent:order:" + dto.getClientOrderId();
Boolean first = redisTemplate.opsForValue().setIfAbsent(idempotentKey, "1", 30, TimeUnit.MINUTES);
if (!Boolean.TRUE.equals(first)) throw new ServiceException("请勿重复提交");
try {
    return service.createOrder(dto);
} catch (Exception e) {
    redisTemplate.delete(idempotentKey); // 失败允许重试
    throw e;
}
```

### 场景 4：批量更新大表（B19，分批游标）

```java
List<String> allIds = mapper.listIdsByCondition(params);
for (List<String> batch : Lists.partition(allIds, 500)) {
    mapper.updateStatusByIds(batch, "ARCHIVED");
    Thread.sleep(100); // 限速，给主从同步留时间
}
```

### 场景 5：调用下游服务（B21 + 熔断降级）

```java
@FeignClient(name = "inventory", fallbackFactory = InventoryFallback.class)
public interface InventoryClient {
    @PostMapping("/stock/deduct")
    ApiResult<Void> deduct(@RequestBody DeductDTO dto);
}

// ❌ HttpUtil 裸调用无超时（B21 warn）
// HttpResponse resp = HttpUtil.createPost(url).body(data).execute();  // 无 .timeout()

// ✅ 加超时 或用 Feign + 熔断
HttpResponse resp = HttpUtil.createPost(url).timeout(5000).body(data).execute();
```

### 场景 6：定时任务（23，多实例防重复）

```java
@Component @Slf4j
public class OrderSyncJob {
    @Scheduled(cron = "${jhict.scheduled.order-sync}")
    @SchedulerLock(name = "orderSync", lockAtMostFor = "30m", lockAtLeastFor = "5m")
    public void syncOrders() {
        // 幂等：按 updateTime 增量；业务超时 < 锁超时；失败告警
    }
}
```

### 场景 7：事务内禁发 MQ/HTTP（B20 error）

```java
// ❌ 事务内发 MQ（B20 error，回滚后消息已发）
@Transactional(rollbackFor = Exception.class)
public void save() {
    baseMapper.insert(entity);
    rocketMQTemplate.syncSend("topic", msg);  // ❌
}

// ✅ 移出事务 或用事务消息 + afterCommit
@Transactional(rollbackFor = Exception.class)
public void save() {
    baseMapper.insert(entity);
}
// afterCommit 钩子发消息（Spring TransactionSynchronizationManager）
```

## 受保护环境只读护栏（v0.14）

| 工具 | dev/sit/uat | pre/prod/production |
|---|---|---|
| `codegen apply` | 确认后写 | 阻断（需 WL_ALLOW_PRODUCTION_WRITES=true） |
| `safe_fix apply` | 确认后写 | 阻断 |
| `permissions export apply` | 确认后写 | 阻断 |
| `config init apply` | 确认后写 | 阻断 |
| `config migrate apply` | 确认后写 | 阻断 |
| `config fix apply` | 确认后写 | 阻断 |
| `db preview` | 只读 | 只读 |
| `validate` / `config doctor` | 只读 | 只读 |
| `contract diff` | 只读 | 只读 |
| `troubleshoot` | 只读 | 只读 |

## 配置体检与故障排查（v0.12）

```bash
# 配置全链路体检（L0~L8，每项失败给"下一步查哪里"）
wl-skills-bd config doctor
wl-skills-bd config doctor --probe    # + DB/Redis/Nacos TCP 连通性

# 明文密码修复：先预览 hash，再使用同一 hash 应用
wl-skills-bd config fix --json
wl-skills-bd config fix --plan-hash <hash> --confirm

# 故障排查（错误关键字 → 诊断步骤）
wl-skills-bd troubleshoot "Communications link failure"   # DB
wl-skills-bd troubleshoot "Unable to connect to Redis"    # Redis
wl-skills-bd troubleshoot "NacosException"                # Nacos
wl-skills-bd troubleshoot "CrashLoopBackOff"              # K8s
wl-skills-bd troubleshoot --list                          # 列出所有诊断项
```

## 错误码速查（B13~B23）

| 规则 | 错误示例 | 修复 |
|---|---|---|
| B13 | `Redis set() 缺少 TTL 参数` | 加 `30, TimeUnit.MINUTES` |
| B14 | `setnx 自实现锁` / `setIfAbsent 1 HOURS 长 TTL` | 改用 Redisson `RLock` + watchdog |
| B15 | `禁用 Redis 命令 KEYS *` | 改用 `SCAN` |
| B16 | `JdkSerializationRedisSerializer` | 改 Jackson + JavaTimeModule |
| B17 | `deleteById()：业务代码禁止物理删除` | 改软删 IS_DELETE=0 |
| B18 | `<update> 缺少 WHERE` | 加 WHERE + COMPANY_ID 谓词 |
| B19 | `saveBatch(list, 5000) 超过 1000` | 移除显式大小或分批 |
| B20 | `@Transactional 内调 rocketMQTemplate/HttpUtil` | 移出事务或用事务消息 + afterCommit |
| B21 | `HttpUtil 裸调用无超时` | 加 `.timeout(N)` 或用 Feign + 熔断 |
| B22 | `Swagger 2/OpenAPI 3 混用` / `Controller 用 Swagger 2` | 新代码用 OpenAPI 3（@Tag/@Operation） |
| B23 | `Service 注入依赖 12 个（>10）` | 按子域拆分（OrderQueryService/OrderWriteService） |

## 变更记录

- 2026-07-18 v0.14：保护范围扩展为 pre/prod/production；config init/migrate/fix 统一 planHash 写门。
- 2026-07-18 v0.12：补 B20~B23 错误码 + 定时任务场景 + 配置体检/故障排查段 + 生产护栏补 config 行。
- 2026-07-18 v0.11：补 B20~B23（事务内 MQ/HTTP、HttpUtil 超时、Swagger 混用、巨型 Service）+ 定时任务/多环境速查行。
- 2026-07-18 v0.10：新增 data-safety USAGE 速查。
