# 09 · 日志规范（✅ 已落地）

> 日志是线上排查的唯一线索。规范日志 = 占位符 + 合适级别 + 脱敏 + 链路追踪。
>
> 强制度：🔴 必遵。日志拼接是 AI 生成代码的高发错误。

---

## 1. 框架与注入

- **SLF4J + Logback**（jh4j-cloud 默认；mdm-service 用 Log4j2，同为 SLF4J 门面）
- 使用 Lombok `@Slf4j` 注入 logger，**不手写** `LoggerFactory.getLogger(...)`

```java
@Slf4j                  // ✅ Lombok 注入
@Service
public class XxxService { 
    public void save() {
        log.info("...");  // 直接用 log
    }
}
```

## 2. 占位符（强制，最高频违规）

```java
log.info("用户 {} 提交特征量分类 {}", userId, categoryCode);        // ✅ 占位符
log.error("处理失败 dto={}", dto, ex);                              // ✅ 异常作为最后参数（自动打堆栈）

log.info("用户 " + userId + " 提交");                               // ❌ 字符串拼接（性能 + 安全）
log.error("处理失败: " + ex.getMessage(), ex);                      // ❌ 重复拼接 message
```

> **生成代码时必须用 `{}` 占位符**，拼接字符串会：① 性能损耗（编译期无法优化）② SQL/参数无法脱敏 ③ 违反 SLF4J 最佳实践。

## 3. 级别决策表

| 级别 | 适用场景 | 生产频率 | 示例 |
|------|---------|:---:|------|
| **ERROR** | 系统异常、外部服务调用失败、数据不一致、需立即关注 | 必报警 | Feign 超时、DB 连接失败 |
| **WARN** | 业务异常、降级、重试、限流、可恢复错误 | 关注 | ServiceAssert 失败、重试第 N 次 |
| **INFO** | 关键业务节点：创建/状态变更/批量任务起止 | 默认开 | `log.info("模型 {} 启用", modelCode)` |
| **DEBUG** | 入参出参、内部分支、循环细节 | 生产关 | 开发调试用 |
| **TRACE** | 极细粒度排查 | 不常用 | 临时启用 |

> **级别决策原则**：能 WARN 不 ERROR（减少误报）；能 DEBUG 不 INFO（减少生产噪音）。关键业务流转必须 INFO。

## 4. 敏感信息脱敏（强制）

**禁止原文打印**的字段及脱敏规则：

| 字段类型 | 脱敏方式 | 正则/示例 |
|---------|---------|----------|
| 密码/密钥/Token | 完全不打印，或打 `***` | `log.info("token={}", "***")` |
| 手机号 | 中间 4 位打码 | `183****5678`，正则 `(\d{3})\d{4}(\d{4})` → `$1****$2` |
| 身份证号 | 中间 8 位打码 | `110***********1234` |
| 银行卡号 | 仅留后 4 位 | `************1234` |
| 邮箱 | @ 前打码 | `z***@example.com` |

**大字段截断**：JSON / SQL / 响应体内容 > 1KB 必须截断：

```java
String json = JSON.toJSONString(dto);
if (json.length() > 1000) json = json.substring(0, 1000) + "...(truncated)";
log.debug("响应: {}", json);
```

> 打印整个 DTO 前确认其 toString 不含密码字段（或用 `@ToString(exclude = "password")`）。

## 5. 链路追踪（traceId）

- **网关已注入 traceId 到 MDC**（jh4j-cloud 网关层），业务代码**无需手动写入**
- 日志输出格式已含 traceId（logback/log4j2 pattern 配置 `%X{traceId}`）
- **异步任务 / 线程池 / 消息消费时必须复制 MDC** 到子线程：

```java
Map<String, String> mdc = MDC.getCopyOfContextMap();
executor.submit(() -> {
    if (mdc != null) MDC.setContextMap(mdc);  // ✅ 复制到子线程
    try {
        log.info("异步任务执行");  // traceId 不断
    } finally {
        MDC.clear();               // ✅ 清理，防线程池复用串号
    }
});
```

> 不复制 MDC → 异步日志无 traceId → 无法串联主流程，线上排查断链。

---

## 6. 禁止事项

| 禁止 | 原因 | 正确 |
|------|------|------|
| 字符串拼接日志 | 性能 + 安全 | `{}` 占位符 |
| `System.out.println` | 不进日志框架，生产丢失 | `log.info` |
| `e.printStackTrace()` | 不进日志框架 | `log.error("描述", e)` |
| 打印密码/Token/身份证原文 | 安全 | 脱敏或不打印 |
| 异步任务不复制 MDC | traceId 断链 | `MDC.getCopyOfContextMap()` |

## 7. 正反例

```java
✅ log.info("用户 {} 查询模型 {}", userNo, modelCode);
✅ log.error("保存失败 modelCode={}", modelCode, e);    // 异常最后参数
✅ log.info("手机号 {}", phone.replaceAll("(\\d{3})\\d{4}(\\d{4})", "$1****$2"));

❌ log.info("用户 " + userNo + " 查询");                // 拼接
❌ log.info("密码: {}", password);                       // 敏感原文
❌ System.out.println("调试");                           // 非日志框架
```

## 变更记录
- 2026-07-17 v0.4 补厚（脱敏正则表 + traceId/MDC 复制 + 级别决策表 + 大字段截断）
- 2026-05-14 v0.0.1 骨架
