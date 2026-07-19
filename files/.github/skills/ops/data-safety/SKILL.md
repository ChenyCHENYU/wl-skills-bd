---
name: data-safety
description: |
  数据安全与稳定性护栏。把 Redis/敏感写/限流熔断的事故源（OOM/超卖/雪崩/误删全表/级联故障）降到机器兜底层。
  覆盖 standards/20（Redis）、21（敏感写）、22（限流熔断）和 be-rules B13~B19。
  典型触发：「Redis 规范」「缓存」「分布式锁」「批量删除」「物理删」「生产只读」「二次确认」「熔断」「限流」「Feign 超时」
status: ✅ 已落地
stage: ops 横切
risk: 🟡 中风险（写代码需人工确认语义）
---

# data-safety

> v0.10 新增。把"生产事故源"从口头规范固化为机器可校验的 B 规则，AI 生成 Redis/批量/外部调用代码时强制对照。

## Pre-flight

```text
🚀 已触发 data-safety
✅ 已读取 standards/index.md，匹配任务类型 I（数据安全与稳定性审计）
✅ 已读取 standards/20-redis-cache.md → Key/TTL/Redisson 锁/大 Key/序列化/禁令
✅ 已读取 standards/21-sensitive-write.md → 分级/批量/物理删禁令/幂等/生产只读
✅ 已读取 standards/22-resilience.md → Feign 超时/重试/熔断/舱壁/限流
⚠️ 写代码后必须跑 B13~B19，error 未清零不得提交
⚠️ pre/prod/production 的 codegen/safe-fix/config/permissions apply 默认阻断
```

## 覆盖范围（机器兜底）

| 规则 | 标准 | 检测 | severity |
|---|---|---|---|
| B13 | 20 §2 | RedisTemplate set/setIfAbsent 缺 TTL | error |
| B14 | 20 §3 | setnx/setIfAbsent 自实现锁（非 Redisson）| error |
| B15 | 20 §7 | KEYS \* / FLUSHDB / FLUSHALL | error |
| B16 | 20 §6 | JdkSerializationRedisSerializer | warn |
| B17 | 21 §3 | deleteBatchIds/deleteById/TRUNCATE/DROP TABLE | error |
| B18 | 21 §4 | Mapper XML update/delete 缺 WHERE | error |
| B19 | 21 §2 | saveBatch 显式批量 > 1000 | warn |

## 可执行流程

### 1. 数据安全审计

```bash
wl-skills-bd validate src/main --strict
# 关注 B13~B19 的 issues，每条带 standards 引用和修复指引
```

### 2. Redis 代码生成对照

生成 Redis 操作代码时，按 20-redis-cache 模板：

```java
// ✅ Cache-Aside + TTL 随机抖动
String key = env + ":mdm:cache:user:" + id;
UserVO cached = redisTemplate.opsForValue().get(key);
if (cached != null) return "NULL".equals(cached) ? null : cached;
UserVO entity = mapper.getById(id);
int ttl = 1800 + ThreadLocalRandom.current().nextInt(300);
redisTemplate.opsForValue().set(key, entity == null ? "NULL" : entity, ttl, TimeUnit.SECONDS);

// ✅ Redisson 分布式锁
RLock lock = redissonClient.getLock(env + ":sale:lock:order:" + orderId);
try {
    if (!lock.tryLock(3, 30, TimeUnit.SECONDS)) throw new ServiceException("请稍后再试");
    // 业务
} finally {
    if (lock.isHeldByCurrentThread()) lock.unlock();
}
```

### 3. 批量写分批对照

```java
// ✅ saveBatch 默认 1000
service.saveBatch(list);

// ✅ 大表更新按主键游标
for (List<String> batch : Lists.partition(allIds, 500)) {
    mapper.updateStatusByIds(batch, "X");
    Thread.sleep(100); // 限速
}
```

### 4. Feign 超时配置对照

```yaml
feign:
  client:
    config:
      default:
        connect-timeout: 2000
        read-timeout: 5000
ribbon:
  MaxAutoRetries: 0          # 网关层不重试
  MaxAutoRetriesNextServer: 0
```

### 5. 受保护环境只读护栏对照

```bash
# pre/prod/production 默认零写入
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm
# 输出：❌ 拒绝：受保护环境需先评审同一 planHash，再显式授权

# 本地显式开启（人工授权）
WL_ALLOW_PRODUCTION_WRITES=true wl-skills-bd codegen apply ...
```

## 反面教材（明确禁止）

```java
// ❌ 无 TTL（B13）
redisTemplate.opsForValue().set(key, value);

// ❌ setIfAbsent 自实现锁（B14）
Boolean ok = redisTemplate.opsForValue().setIfAbsent(key, "1");

// ❌ KEYS *（B15）
Set<String> keys = redisTemplate.keys("*");

// ❌ 物理删除（B17）
baseMapper.deleteBatchIds(ids);

// ❌ 全表 UPDATE（B18）
<update id="resetAll">UPDATE T SET STATUS = 'X'</update>

// ❌ saveBatch 超量（B19）
service.saveBatch(list, 50000);
```

## 与其他 Skill 的关系

| Skill | data-safety 的边界 |
|---|---|
| service-codegen | 生成 Service 时遵守 B13/B14/B17/B19（不写违规代码） |
| mapper-xml-gen | 生成 XML 时遵守 B18（必有 WHERE） |
| convention-audit-be | 审计 B13~B19，输出 issues |
| code-fix-be | B13~B19 当前**不在安全修复白名单**（语义敏感，需人工） |
| db-migration | DDL 走 12 + 生产审批；DML 走 21 |

## 接入检查清单（doctor 未来扩展）

- [ ] `.wl-skills-bd/config.json` 声明 `environment` 字段（dev/sit/uat/pre/prod）
- [ ] `.wl-skills-bd/redis-persistent-keys.json` 登记持久 Key 白名单
- [ ] Feign 客户端统一超时配置
- [ ] Resilience4j/Sentinel 熔断器配置
- [ ] 操作日志独立表 + REQUIRES_NEW 事务

## 变更记录

- 2026-07-18 v0.14：保护范围扩展为 pre/prod/production，并覆盖 config 与 permissions 写链。
- 2026-07-18 v0.10：新增 data-safety Skill，落地 standards 20/21/22 和 B13~B19。
