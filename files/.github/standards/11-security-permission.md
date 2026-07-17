# 11 · 权限与租户隔离（✅ 已落地）

> 权限注解防越权调用，租户隔离防跨租户数据泄露。两者都是安全红线。
>
> 强制度：🔴 必遵。be-rules B1 查 @PreAuthorize / B7 查 COMPANY_ID。
>
> **依据**：MyBatis-Plus 官方多租户（TenantLineHandler 插件）、Spring Security 官方、OWASP 数据隔离最佳实践。

---

## 1. 权限码（接口级鉴权）

### 注解（强制，B1 检测）

```java
@PreAuthorize("@pms.hasPermission('mdm_feature_category_query_page')")
@PostMapping("queryPage")
public ApiResult<...> queryPage(...) { ... }
```

- **每个 Controller 接口方法必须加** `@PreAuthorize`（B1 error）
- 依据：Spring Security 官方基于表达式的访问控制（method security）

### 命名规则

```
{module}_{resource}_{action}
```

| 动作 | 后缀 | 示例 |
|------|------|------|
| 分页查询 | `_query_page` | `mdm_feature_category_query_page` |
| 详情查询 | `_get_by_id` | `mdm_feature_category_get_by_id` |
| 新增 | `_save` | `mdm_feature_category_save` |
| 修改 | `_update_by_id` | `mdm_feature_category_update_by_id` |
| 删除 | `_delete_by_id` | `mdm_feature_category_delete_by_id` |
| 业务动作 | 动词 | `mdm_feature_category_submit` / `_approve` / `_import` |

> 全小写下划线，与前端 `SYS_PERMISSION_INFO.md` **严格一致**。

### 权限码同步流程（强制）

```
后端新增权限码 → 同步登记到 → ① 前端 SYS_PERMISSION_INFO.md
                            ② 权限中心数据库（SYS_PERMISSION_INFO 表）
                            ③ 角色分配（DBA/运维）
```

> 遗漏任一步：前端按钮不显示 / 角色无权限 / 接口 403。生成代码时在完成摘要提示"以下权限码需同步：xxx"。

## 2. 公开接口（豁免鉴权）

```java
@Anonymous                        // jh4j-cloud 内置注解，豁免 token 校验
@GetMapping("public/health")
public ApiResult<?> health() { ... }
```

- 类或方法加 `@Anonymous`，**并在注释说明开放原因**
- 公开接口必须做：**限流 / 验证码 / IP 白名单** 任一（OWASP：防自动化滥用）
- 公开接口**禁止**返回敏感数据

## 3. 当前登录用户获取

```java
LoginUser user = SecurityUtils.getLoginUser();
String userNo     = user.getUserNo();      // 工号
String companyId  = user.getCompanyId();   // 租户ID（动态，从安全上下文）
String userName   = user.getUserName();    // 姓名
```

> **禁止**从请求参数接收 userId/companyId（用户可伪造，OWASP 越权漏洞），必须从 SecurityUtils 取。

---

## 4. 租户隔离（COMPANY_ID，数据级鉴权）

### 4.1 建表强制（与 standards/12 联动）

所有业务表**必含** `COMPANY_ID` 字段。

### 4.2 推荐方案：MyBatis-Plus 多租户插件（官方，自动注入）

> **依据**：MyBatis-Plus 官方 `TenantLineInnerInterceptor` + `TenantLineHandler`，自动给所有 SQL 注入租户条件，**无需手写 SQL 条件**，且杜绝遗漏。

```java
// 1. 配置拦截器（jh4j-cloud 已封装或自行配置）
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
    interceptor.addInnerInterceptor(new TenantLineInnerInterceptor(new TenantLineHandler() {
        @Override
        public Expression getTenantId() {
            // 动态从安全上下文取，禁止硬编码
            return new LongValue(SecurityUtils.getLoginUser().getCompanyId());
        }
        @Override
        public String getTenantIdColumn() { return "COMPANY_ID"; }
        @Override
        public boolean ignoreTable(String tableName) { return ignoreTables.contains(tableName); }
    }));
    return interceptor;
}
```

启用插件后，MyBatis-Plus 自动：
- INSERT 自动填充 `COMPANY_ID`
- UPDATE/DELETE/SELECT 自动追加 `AND COMPANY_ID = ?`
- 无需在 XML/Wrapper 手写条件

### 4.3 备选方案：显式过滤（插件未启用时）

若团队未启用多租户插件，所有 SELECT **必须显式**带 COMPANY_ID 条件：

```xml
<select id="queryPage" resultType="...PageVO">
    SELECT <include refid="BaseColumns"/>
    FROM MDM_FEATURE_CATEGORY t
    <where>
        AND t.IS_DELETE = 1
        AND t.COMPANY_ID = #{param.companyId}          <!-- 显式过滤，值从 LoginUser 动态取 -->
    </where>
</select>
```

be-rules B7 启发式检测：SELECT 无 COMPANY_ID 且无 JOIN → 提示确认。

### 4.4 写操作租户填充

```java
entity.setId(IdWorker.getIdStr());
entity.setCompanyId(SecurityUtils.getLoginUser().getCompanyId());  // ✅ 动态取
EntityUtil.setCreateProp(entity);
baseMapper.insert(entity);
```

---

## 5. 🔴 反面教材（明确禁止，存量代码须整改）

> 以下写法来自 mdm-service（AI 生成存量代码），是**多租户失效的典型缺陷**，严禁沿用：

```java
// ❌❌❌ 禁止：硬编码租户ID（多租户形同虚设）
putIfColumnPresent(data, ..., CommonFiledEnum.COMPANY_ID, "1");  // mdm-service 真实缺陷
obj.put(COMPANY_ID.name(), "1");                                 // 所有租户被当成同一租户
```

**危害**：所有租户的数据被当作 `COMPANY_ID=1`，跨租户数据完全互通，企业级多租户根本不生效。

**整改**：启用 MP 多租户插件（§4.2），或显式过滤时从 `SecurityUtils.getLoginUser().getCompanyId()` 动态取值（§4.4）。

---

## 6. 数据权限（行级，进阶）

- 行级数据权限走 jh4j-cloud 数据权限拦截器（基于角色 + 部门 + 自定义规则）
- SQL 中预留 `${dataScope}` 占位（由拦截器注入 WHERE 条件）
- 字段级权限：敏感字段（如薪资）通过 VO 按角色过滤

## 7. 越权检查清单（audit 用）

| 检查项 | 风险 | 检测方式 |
|--------|:---:|---------|
| Controller 接口缺 @PreAuthorize | 🔴 | B1 regex |
| SELECT 缺 COMPANY_ID | 🔴 | B7 regex |
| **COMPANY_ID 硬编码**（如 "1"）| 🔴 | regex：搜索 `"1"` 字面量赋给 companyId |
| 从请求参数取 userId/companyId | 🔴 | 人工/AI |
| 公开接口返回敏感数据 | 🔴 | 人工 |
| 权限码未同步前端 | 🟡 | AI 比对 |

## 8. 禁止事项

| 禁止 | 原因 |
|------|------|
| Controller 不加 @PreAuthorize | 任何人可调（B1）|
| SQL 漏 COMPANY_ID 条件 | 跨租户数据泄露（B7）|
| **COMPANY_ID 硬编码字面量** | 多租户失效（mdm-service 缺陷）|
| 从请求参数取 userId/companyId | 用户可伪造 |
| 业务代码硬编码用户 ID | 越权风险 |
| 公开接口不做限流 | 被刷 |

## 9. 正反例

```java
✅ @PreAuthorize("@pms.hasPermission('mdm_feature_category_save')")
   @PostMapping("save")
   public ApiResult<String> save(@RequestBody @Validated DTO dto) {
       LoginUser user = SecurityUtils.getLoginUser();   // 从上下文取
       return ApiResult.success("", service.save(dto));
   }

✅ entity.setCompanyId(SecurityUtils.getLoginUser().getCompanyId());  // 动态取

❌ @PostMapping("save")                                  // 缺 @PreAuthorize（B1）
   public ApiResult<String> save(@RequestBody DTO dto,
                                  @RequestParam String userId) {  // 从参数取（可伪造）

❌ putIfColumnPresent(data, COMPANY_ID, "1");           // 硬编码租户（致命，多租户失效）
```

```xml
✅ <where> AND t.IS_DELETE = 1 AND t.COMPANY_ID = #{param.companyId} </where>

❌ <where> AND t.IS_DELETE = 1 </where>                  <!-- 缺 COMPANY_ID（B7）-->
```

## 变更记录
- 2026-07-17 v0.4.2 修正：依据 MyBatis-Plus 官方多租户重写；明确禁止硬编码并标注 mdm-service 反面教材
- 2026-07-17 v0.4 补厚（误用 mdm-service 为基线，已纠正）
- 2026-05-14 v0.0.1 骨架
