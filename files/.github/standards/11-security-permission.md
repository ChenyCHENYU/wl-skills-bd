# 11 · 权限与租户隔离（🟡 骨架）

## 权限码

- 注解：`@PreAuthorize("@pms.hasPermission('xxx_yyy_zzz')")`
- 命名：`{module}_{resource}_{action}`，全小写下划线
  - `mdm_feature_category_query_page`
  - `mdm_feature_category_save`
  - `mdm_feature_category_update_by_id`
  - `mdm_feature_category_delete_by_id`
- 权限码必须同步到 **前端 `SYS_PERMISSION_INFO.md`** 与 **权限中心数据库**

## 公开接口

- 类或方法加 `@Anonymous`（jh4j-cloud 内置注解），并在注释说明开放原因
- 公开接口必须做：限流 / 验证码 / IP 白名单 任一

## 当前登录用户

```java
LoginUser user = SecurityUtils.getLoginUser();
String userNo = user.getUserNo();
String companyId = user.getCompanyId();
```

## 租户隔离

- 业务表必含 `COMPANY_ID` 字段（参见 [12-database-ddl.md](12-database-ddl.md)）
- **所有 SELECT 必须** `AND COMPANY_ID = #{currentCompanyId}`（除超管查全部）
- 新增 / 更新场景：审计字段填充器自动把 `COMPANY_ID` 写入

## 数据权限

- 行级数据权限走 `@DataScope` 注解（团队工具，待 0.1.x 补完整规范）

## 禁止事项

- 禁止 Controller 不加 `@PreAuthorize` 直接发布
- 禁止业务代码硬编码用户 ID（如 `if (userId == 1) ...`）
- 禁止 SQL 漏 `COMPANY_ID` 条件造成跨租户数据泄露

> TODO（0.1.x）：完整数据权限矩阵 + 角色 / 资源 / 字段三级模型。
