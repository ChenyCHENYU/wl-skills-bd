# 11 · 权限与租户隔离（✅ 已落地）

> 权限注解防越权调用，租户隔离防跨租户数据泄露。两者都是安全红线。
>
> 强制度：🔴 必遵。be-rules B1 查 @PreAuthorize / B7 查 COMPANY_ID。

---

## 1. 权限码（接口级鉴权）

### 注解（强制，B1 检测）

```java
@PreAuthorize("@pms.hasPermission('mdm_feature_category_query_page')")
@PostMapping("queryPage")
public ApiResult<...> queryPage(...) { ... }
```

- **每个 Controller 接口方法必须加** `@PreAuthorize`（B1 error）
- 注解里的 `@pms` 是 jh4j-cloud 的 `PermissionService` Bean

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

> 全小写下划线，与前端 `SYS_PERMISSION_INFO.md` **严格一致**（前端按钮鉴权用同一字符串）。

### 权限码同步流程（强制）

```
后端新增权限码 → 同步登记到 → ① 前端 SYS_PERMISSION_INFO.md
                            ② 权限中心数据库（SYS_PERMISSION_INFO 表）
                            ③ 角色分配（DBA/运维）
```

> **遗漏任一步**：前端按钮不显示 / 角色无权限 / 接口 403。生成代码时在完成摘要提示"以下权限码需同步：xxx"。

## 2. 公开接口（豁免鉴权）

```java
@Anonymous                        // jh4j-cloud 内置注解，豁免 token 校验
@GetMapping("public/health")
public ApiResult<?> health() { ... }
```

- 类或方法加 `@Anonymous`，**并在注释说明开放原因**
- 公开接口必须做：**限流 / 验证码 / IP 白名单** 任一（防刷）
- 公开接口**禁止**返回敏感数据（用户列表、内部配置等）

## 3. 当前登录用户获取

```java
LoginUser user = SecurityUtils.getLoginUser();
String userNo     = user.getUserNo();      // 工号
String companyId  = user.getCompanyId();   // 租户ID
String userName   = user.getUserName();    // 姓名
```

> **禁止**从请求参数接收 userId/companyId（用户可伪造），必须从 SecurityUtils 取。

## 4. 租户隔离（COMPANY_ID，数据级鉴权）

### 4.1 建表强制（与 standards/12 联动）

所有业务表**必含** `COMPANY_ID` 字段（mdm-service 29 处 XML 全部显式映射）。

### 4.2 SELECT 必须带租户过滤

```xml
<!-- ✅ 标准：显式 COMPANY_ID 条件 -->
<select id="queryPage" resultType="...PageVO">
    SELECT <include refid="BaseColumns"/>
    FROM MDM_FEATURE_CATEGORY t
    <where>
        AND t.IS_DELETE = 1
        AND t.COMPANY_ID = #{param.companyId}          <!-- 租户过滤 -->
        <if test="param.categoryCode != null ...">
    </where>
</select>
```

> **所有单表 SELECT 必须** `AND COMPANY_ID = #{currentCompanyId}`（除超管查全部、平台级数据）。
> be-rules B7 启发式检测：SELECT 无 COMPANY_ID 且无 JOIN → 提示。

### 4.3 写操作自动填充

审计字段填充器（`EntityUtil.setCreateProp` / `setUpdateProp`）自动从 SecurityUtils 获取 companyId 写入：

```java
entity.setId(IdWorker.getIdStr());
EntityUtil.setCreateProp(entity);   // ✅ 自动填 createUserNo/createDateTime/companyId
baseMapper.insert(entity);
```

> 不要手动 `entity.setCompanyId(...)`（用填充器统一，防遗漏）。

### 4.4 真实写法（mdm-service BaseColumns 标准模式）

mdm-service 的 BaseColumns 显式映射 COMPANY_ID（29 处统一模式）：

```xml
<sql id="BaseColumns">
    t.ID, t.CATEGORY_CODE,
    t.COMPANY_ID AS companyId,           <!-- 必映射 -->
    t.IS_DELETE, t.CREATE_USER_NO, ...
</sql>
```

## 5. 数据权限（行级，进阶）

- 行级数据权限走 jh4j-cloud 的数据权限拦截器（基于角色 + 部门 + 自定义规则）
- SQL 中预留 `${dataScope}` 占位（由拦截器注入 WHERE 条件）
- 字段级权限：敏感字段（如薪资）通过 VO 按角色过滤

## 6. 越权检查清单（audit 用）

| 检查项 | 风险 | 检测方式 |
|--------|:---:|---------|
| Controller 接口缺 @PreAuthorize | 🔴 | B1 regex |
| SELECT 缺 COMPANY_ID | 🔴 | B7 regex |
| 从请求参数取 userId/companyId | 🔴 | 人工/AI |
| 公开接口返回敏感数据 | 🔴 | 人工 |
| 权限码未同步前端 SYS_PERMISSION_INFO | 🟡 | AI 比对 |
| 硬编码用户判断（`if (userId == 1)`）| 🔴 | regex/AI |

## 7. 禁止事项

| 禁止 | 原因 |
|------|------|
| Controller 不加 @PreAuthorize 直接发布 | 任何人可调（B1）|
| SQL 漏 COMPANY_ID 条件 | 跨租户数据泄露（B7）|
| 从请求参数取 userId/companyId | 用户可伪造 |
| 业务代码硬编码用户 ID | 越权风险 |
| 公开接口不做限流 | 被刷 |

## 8. 正反例

```java
✅ @PreAuthorize("@pms.hasPermission('mdm_feature_category_save')")
   @PostMapping("save")
   public ApiResult<String> save(@RequestBody @Validated DTO dto) {
       LoginUser user = SecurityUtils.getLoginUser();   // 从上下文取
       return ApiResult.success("", service.save(dto));
   }

❌ @PostMapping("save")                                  // 缺 @PreAuthorize（B1）
   public ApiResult<String> save(@RequestBody DTO dto,
                                  @RequestParam String userId) {  // 从参数取用户（可伪造）
```

```xml
✅ <where> AND t.IS_DELETE = 1 AND t.COMPANY_ID = #{param.companyId} </where>

❌ <where> AND t.IS_DELETE = 1 </where>                  <!-- 缺 COMPANY_ID（B7）-->
```

## 变更记录
- 2026-07-17 v0.4 补厚（权限码同步流程 + COMPANY_ID 完整模板 + 真实 BaseColumns 模式 + 越权检查清单 + 正反例）
- 2026-05-14 v0.0.1 骨架
