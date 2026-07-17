# 08 · 异常处理规范（✅ 已落地）

> 统一异常处理是"代码精简直观，非意大利面条"的关键。业务异常用 ServiceAssert 断言 + ServiceException 抛出，全局处理器接管，Controller **不写 try-catch**。
>
> 强制度：🔴 必遵。be-rules B8 检测裸 RuntimeException。

---

## 1. 三层异常体系

```
业务校验失败 → ServiceAssert.isTrue/isNotNull(...)  → 自动抛 ServiceException
                       ↓
业务逻辑异常 → throw new ServiceException(code, msg)
                       ↓
全局处理器   → @RestControllerAdvice 统一兜底 → ApiResult.fail(code, msg)
```

> Controller 层**禁止 try-catch 业务异常**（让全局处理器接管，否则返回结构不一致）。

## 2. ServiceAssert 断言工具（团队基线，最高频）

来自 mdm-service 真实代码（233 处用法），断言失败自动抛 ServiceException，**替代手写 if + throw**：

| 方法 | 用途 | 真实例（mdm-service）|
|------|------|-----|
| `isNotNull(obj, "xxx不存在")` | 非空校验 | `ServiceAssert.isNotNull(model, "模型不存在：" + modelCode)` |
| `isNull(obj, "xxx已存在")` | 必须为空（唯一性）| `ServiceAssert.isNull(existingModel, "该模型编码已存在")` |
| `isTrue(cond, "状态非法")` | 布尔条件 | `ServiceAssert.isTrue(StringUtils.isNotBlank(modelCode), "模型编码不能为空")` |
| `hasText(text, "xxx不能为空")` | 字符串非空 | `ServiceAssert.hasText(id, "子实体ID不能为空")` |

> **生成代码时优先用 ServiceAssert，不要手写 `if (...) throw new RuntimeException`**（B8 会查）。

### 使用模式（状态变更四段式）

```java
// ① 校验存在
MdmFeatureCategory entity = baseMapper.selectById(id);
ServiceAssert.isNotNull(entity, "特征量分类不存在");
// ② 校验状态
ServiceAssert.isTrue("DRAFT".equals(entity.getStatus()), "仅待提交状态可操作");
```

## 3. ServiceException 自定义异常

```java
// 仅在 ServiceAssert 无法覆盖的场景显式抛（如复杂业务规则）
throw new ServiceException(40001, "特征量编码与已有记录冲突");
```

| 字段 | 含义 | 取值见业务码字典 |
|------|------|-----------------|
| code | 业务码 | 4xxxxx 业务 / 5xxxxx 系统 |
| message | 提示文案 | 用户可见，**禁止含敏感信息** |

## 4. 业务码字典（团队约定，分段分配）

| 码段 | 含义 | 示例 |
|------|------|------|
| 200 | 成功 | ApiResult.success 默认 |
| 400 | 参数校验失败 | @Validated 触发 |
| 401 | 未认证 | token 失效 |
| 403 | 无权限 | @PreAuthorize 拒绝 |
| 404 | 资源不存在 | ServiceAssert.isNotNull 失败 |
| 40001-49999 | 业务规则错误 | "该模型编码已存在" / "状态非法" |
| 500 | 系统异常 | 全局兜底，不暴露堆栈 |
| 50001-59999 | 第三方调用失败 | Feign 超时 / MQ 异常 |

> 新增业务码在模块内集中定义（如 `FeatureErrorCode` 常量类），不要散落硬编码。

## 5. 全局异常处理器（每服务一个）

```java
@Slf4j
@RestControllerAdvice
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

> 全局处理器已兜底所有异常，业务代码**不需要再 try-catch**（除非要捕获后转换业务码）。

---

## 6. 禁止事项（B8 + 审计项）

| 禁止 | 原因 | 正确 |
|------|------|------|
| `throw new RuntimeException("x")` | 统一异常体系，返回结构不一致 | `ServiceAssert.isTrue(false, "x")` 或 `throw new ServiceException(code, "x")` |
| `catch (Exception ignored) {}` 吞异常 | 掩盖问题，事务也不回滚 | 记录日志后重新抛出或转换业务码 |
| 异常 message 含 SQL/堆栈/密码 | 生产泄露敏感信息 | message 只给用户友好提示 |
| Controller try-catch 业务异常 | 绕过全局处理器 | 让全局接管 |
| `e.printStackTrace()` | 不进日志框架，生产丢失 | `log.error("描述", e)` |

---

## 7. 正反例

```java
✅ ServiceAssert.isNotNull(model, "模型不存在：" + modelCode);
✅ throw new ServiceException(40001, "编码重复");

❌ if (model == null) throw new RuntimeException("模型不存在");   // B8 命中
❌ try { ... } catch (Exception e) { e.printStackTrace(); }       // 吞异常 + 日志框架外
```

## 变更记录
- 2026-07-17 v0.4 补厚（ServiceAssert 全方法 + 业务码字典 + 全局处理器完整版 + 正反例）
- 2026-05-14 v0.0.1 骨架
