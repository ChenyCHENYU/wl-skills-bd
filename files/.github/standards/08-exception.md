# 08 · 异常处理规范（🟡 骨架）

## 全局异常处理器

每个服务必须有一个 `GlobalExceptionHandler` (`@RestControllerAdvice`)：

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ServiceException.class)
    public ApiResult<?> handle(ServiceException e) {
        log.warn("业务异常: {}", e.getMessage());
        return ApiResult.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResult<?> handle(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ApiResult.fail(400, msg);
    }

    @ExceptionHandler(Exception.class)
    public ApiResult<?> handle(Exception e) {
        log.error("系统异常", e);
        return ApiResult.fail(500, "系统繁忙，请稍后重试");
    }
}
```

## 自定义业务异常

- 业务异常统一抛 `ServiceException(code, msg)`，**不要** `throw new RuntimeException`
- 断言工具：`ServiceAssert.notNull(obj, "记录不存在")` / `isTrue(cond, "状态非法")`
- 业务码：4xxxxx = 业务错误，5xxxxx = 系统错误（团队内约定）

## 禁止事项

- 禁止 catch 后吞异常（`catch (Exception ignored) {}`）
- 禁止把异常 message 直接抛给前端（生产敏感信息）
- 禁止 controller 层 try-catch 业务异常（让全局处理器接管）

> TODO（0.1.x）：补完整业务码字典 + 与前端的错误码协作；补审计日志切面集成。
