# 08 · 异常处理规范（✅ 已落地）

> 统一异常处理是"代码精简直观，非意大利面条"的关键。
>
> 强制度：🔴 必遵。be-rules B8 检测裸 RuntimeException。
>
> **依据**：Effective Java（Joshua Bloch）异常章节、Spring Framework 官方 `@ControllerAdvice`/`@ExceptionHandler`。

---

## 1. 三层异常体系

```
业务校验失败 → ServiceAssert.isTrue/isNotNull(...)  → 自动抛 ServiceException
                       ↓
业务逻辑异常 → throw new ServiceException(code, msg)
                       ↓
全局处理器   → @RestControllerAdvice 统一兜底 → ApiResult.fail(code, msg)
```

> Controller 层**禁止 try-catch 业务异常**（依据 Spring 官方：统一由 @ControllerAdvice 接管）。

## 2. ServiceAssert 断言工具（团队基线，最高频）

断言失败自动抛 ServiceException，**替代手写 if + throw**：

| 方法 | 用途 | 用法 |
|------|------|------|
| `isNotNull(obj, "xxx不存在")` | 非空校验 | `ServiceAssert.isNotNull(model, "模型不存在")` |
| `isNull(obj, "xxx已存在")` | 必须为空（唯一性）| `ServiceAssert.isNull(existing, "编码已存在")` |
| `isTrue(cond, "状态非法")` | 布尔条件 | `ServiceAssert.isTrue("DRAFT".equals(s), "仅待提交可操作")` |
| `hasText(text, "xxx不能为空")` | 字符串非空 | `ServiceAssert.hasText(id, "ID不能为空")` |

> **生成代码优先用 ServiceAssert，不要手写 `if (...) throw new RuntimeException`**（B8 会查）。

## 3. 何时抛受检/非受检异常（Effective Java 原则）

> **依据 Effective Java 第 71 条**：用受检异常表示可恢复条件，非受检异常表示编程错误。

| 场景 | 异常类型 | 团队落地 |
|------|---------|---------|
| 业务规则违反（编码重复、状态非法）| 非受检 | `ServiceException`（继承 RuntimeException）|
| 调用方应处理的预期错误 | 受检 | 团队基线统一用 ServiceException 非受检 |
| 编程错误（NPE、参数非法）| 非受检 | IllegalArgumentException / NullPointerException |
| 第三方不可恢复故障 | 非受检 | ServiceException 包装 |

> 团队基线：业务异常统一用 `ServiceException(code, msg)`（非受检），避免受检异常强制 try-catch 污染调用链（Effective Java 第 71 条：受检异常不要过度使用）。

## 4. ServiceException 自定义异常

```java
throw new ServiceException(40001, "特征量编码与已有记录冲突");
```

## 5. 业务码字典（团队约定，分段分配）

| 码段 | 含义 | 示例 |
|------|------|------|
| 200 | 成功 | ApiResult.success 默认 |
| 400 | 参数校验失败 | @Validated 触发 |
| 401 | 未认证 | token 失效 |
| 403 | 无权限 | @PreAuthorize 拒绝 |
| 404 | 资源不存在 | ServiceAssert.isNotNull 失败 |
| 40001-49999 | 业务规则错误 | "编码已存在" / "状态非法" |
| 500 | 系统异常 | 全局兜底，不暴露堆栈 |
| 50001-59999 | 第三方调用失败 | Feign 超时 / MQ 异常 |

> 新增业务码在模块内集中定义（如 `FeatureErrorCode` 常量类），不要散落硬编码。

## 6. 全局异常处理器（Spring 官方 @ControllerAdvice）

```java
@Slf4j
@RestControllerAdvice                    // 依据 Spring 官方
public class GlobalExceptionHandler {

    @ExceptionHandler(ServiceException.class)
    public ApiResult<?> handleServiceException(ServiceException e) {
        log.warn("业务异常 code={} msg={}", e.getCode(), e.getMessage());
        return ApiResult.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResult<?> handleValid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        log.warn("参数校验失败: {}", msg);
        return ApiResult.fail(400, msg);
    }

    @ExceptionHandler(Exception.class)
    public ApiResult<?> handleSystem(Exception e) {
        log.error("系统异常", e);
        return ApiResult.fail(500, "系统繁忙，请稍后重试");  // 不暴露堆栈
    }
}
```

> 全局处理器已兜底，业务代码**不需要再 try-catch**（Effective Java 第 65 条：不要忽略异常，但也不要每层都 catch）。

---

## 7. 🔴 反面教材（mdm-service 存量缺陷，禁止沿用）

> mdm-service 的 `wl-mdm-dingtalk-adapter` 模块有 **22 处 `throw new RuntimeException`**（绕过全局异常处理器，被当作未知系统错误返回 500）。
>
> **整改**：统一改 `ServiceException` 或 `ServiceAssert`。

## 8. 禁止事项（B8 + 审计项）

| 禁止 | 原因 | 依据 |
|------|------|------|
| `throw new RuntimeException("x")` | 绕过统一异常体系 | Effective Java |
| `catch (Exception ignored) {}` 吞异常 | 掩盖问题，事务不回滚 | Effective Java 第 65 条 |
| 异常 message 含 SQL/堆栈/密码 | 泄露敏感信息 | OWASP |
| Controller try-catch 业务异常 | 绕过全局处理器 | Spring 官方 |
| `e.printStackTrace()` | 不进日志框架 | — |

> **注意**：catch 后若不重新抛出，事务**不会回滚**（异常被吞）。必须重新抛出或转换后抛 ServiceException。

## 9. 正反例

```java
✅ ServiceAssert.isNotNull(model, "模型不存在：" + modelCode);
✅ throw new ServiceException(40001, "编码重复");

❌ if (model == null) throw new RuntimeException("模型不存在");   // B8 命中
❌ try { ... } catch (Exception e) { e.printStackTrace(); }       // 吞异常 + 日志框架外
```

## 变更记录
- 2026-07-17 v0.4.2 修正：依据 Effective Java + Spring 官方重写；标注 dingtalk 反面
- 2026-07-17 v0.4 补厚（误用 mdm-service 为基线，已纠正）
- 2026-05-14 v0.0.1 骨架
