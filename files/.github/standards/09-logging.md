# 09 · 日志规范（🟡 骨架）

## 框架

- SLF4J + Logback（jh4j-cloud 默认）
- 使用 Lombok `@Slf4j` 注入 logger

## 占位符（强制）

```java
log.info("用户 {} 提交特征量分类 {}", userId, categoryCode);             // ✅
log.error("处理失败 dto={}", dto, ex);                                   // ✅ 异常作为最后参数

log.info("用户 " + userId + " 提交特征量分类 " + categoryCode);          // ❌ 字符串拼接
log.error("处理失败: " + ex.getMessage(), ex);                           // ❌ 重复拼接
```

## 级别使用准则

| 级别  | 适用场景                                       | 频率   |
| ----- | ---------------------------------------------- | ------ |
| ERROR | 系统异常、外部服务调用失败、需立即关注          | 必报警 |
| WARN  | 业务异常、降级、重试、限流                     | 关注   |
| INFO  | 关键业务节点（订单创建 / 状态变更 / 大数据量任务） | 默认开 |
| DEBUG | 入参出参、内部分支、循环细节                   | 生产关闭 |
| TRACE | 极细粒度排查，临时启用                         | 不常用 |

## 敏感信息

- **禁止** 打印密码、密钥、Token、身份证号、银行卡号原文
- 手机号、邮箱中间打码：`183****5678`
- 大字段截断：JSON / SQL 内容 > 1KB 必须截断

## 链路追踪

- 网关已注入 `traceId` 到 MDC；业务无需手动写入
- 异步任务 / 线程池 / 消息消费时必须**复制 MDC** 到子线程（用 `MDC.getCopyOfContextMap()`）

> TODO（0.1.x）：补 logback-spring.xml 样板 + 业务审计日志切面规范。
