# 03 · 命名规范（✅ 已落地）

> 基于《后端代码规范》+ Java 官方命名约定 + 团队基线整合，17 条规则。

## 类命名（PascalCase）

| 类型            | 格式                       | 示例                          |
| --------------- | -------------------------- | ----------------------------- |
| Controller      | `XxxController`            | `MdmFeatureCategoryController` |
| Service 接口    | `XxxService`               | `MdmFeatureCategoryService`    |
| Service 实现    | `XxxServiceImpl`           | `MdmFeatureCategoryServiceImpl` |
| Mapper          | `XxxMapper`                | `MdmFeatureCategoryMapper`     |
| Entity          | 业务名无后缀                | `MdmFeatureCategory`           |
| 请求 DTO        | `XxxRequestDTO` / `XxxDTO` | `MdmFeatureCategoryPageDTO`    |
| 响应 VO         | `XxxVO`                    | `MdmFeatureCategoryPageVO`     |
| Query 对象      | `XxxQuery`                 | `DemoQuery`                    |
| 常量类          | `XxxConstants`             | `ServiceConstants`             |
| 枚举类          | `XxxEnum`                  | `WhetherEnum`                  |

## 方法命名（camelCase）

| 场景      | 命名                        |
| --------- | --------------------------- |
| 分页查询  | `queryXxxPage(page, dto)`   |
| 主键查询  | `getById(id)`               |
| 列表查询  | `listXxx(query)`            |
| 新增      | `save(dto)` / `saveData(list)` |
| 更新      | `updateById(dto)`           |
| 删除      | `deleteById(id)` / `removeBatch` |
| 状态变更  | 业务动词 + 名词，如 `submitForReview` / `approve` / `offline` |
| 私有辅助  | 语义动词短语，如 `resolveVersion` / `requireOwned` |

## 路径命名

- 类路径：`@RequestMapping("mdmFeatureCategory")`（驼峰，**团队基线**）
- 方法路径：`queryPage` / `getById/{id}` / `save` / `updateById` / `deleteById/{id}`
- **与外部 CLAUDE 规范的 kebab-case `/v1/{organizationId}/cy-xxs` 不一致**；以团队基线为准

## 字段命名

- Java 字段：camelCase（`categoryCode` / `createDateTime`）
- 数据库字段：UPPER_SNAKE_CASE（`CATEGORY_CODE` / `CREATE_DATE_TIME`）
- Mapper XML 字段映射：`SELECT CATEGORY_CODE as categoryCode`（建议使用 MyBatis-Plus 自动映射，禁止用别名维护）

## 常量命名

```java
public static final String STATUS_DRAFT = "0";
public static final String STATUS_PUBLISHED = "3";
```

## 枚举命名

```java
public enum WhetherEnum {
    YES(1, "是"),
    NO(0, "否");
}
```

> R11 枚举字段必须有 Javadoc 注释 → 见 `15-code-quality.md#R11`

---

## R01 · 包命名（全小写，点分隔，单数形式）

```java
// ❌
package org.exAmple;
package com.jhict.mdm.controllers;   // controllers 复数

// ✅
package com.jhict.mdm.controller;
package com.jhict.mdm.entity;
```

---

## R02 · 抽象类必须以 Abstract 开头

```java
// ❌
abstract class BaseService<T> { }

// ✅
abstract class AbstractBaseService<T> { }
```

---

## R04 · 异常类必须以 Exception 结尾，非异常类禁止用此后缀

```java
// ❌
public class BizValidate extends RuntimeException { }  // 缺 Exception 后缀
public class OrderException { }                         // 不是异常类但用了 Exception 后缀

// ✅
public class BizValidateException extends RuntimeException { }
public class OrderStatus { }
```

---

## R05 · Controller CRUD 方法命名（团队统一）

| 操作 | 方法名 | 禁止 |
|------|--------|------|
| 查询 | `getByXxx` / `list` / `queryPage` | `select*` / `find*` |
| 新增 | `save` | `add*` / `insert*` / `create*` |
| 修改 | `update` / `updateXxx` | `edit*` / `modify*` |
| 删除 | `remove` / `removeXxx` | `delete*`（Service 层可用）|

URL 层级最多 3 层：`@GetMapping("mdmFeatureCategory/queryPage")`

---

## R06 · 测试类必须以 Test 结尾（或 IT 结尾表示集成测试）

```java
// ❌
class FeatureCategoryCheck { @Test void verify() { } }

// ✅
class MdmFeatureCategoryServiceTest { @Test void save_shouldPersist() { } }
class MdmFeatureCategoryIT { @Test void endToEnd() { } }
```

---

## R07 · 数组类型 [] 跟在类型后，不跟在方法名后

```java
// ❌
public int getIds()[] { ... }

// ✅
public int[] getIds() { ... }
public int[][] getMatrix() { ... }
```

---

## 变更记录

- 2026-05-17 v0.0.2 补充 R01-R07（基于《后端代码规范》PDF）
- 2026-05-14 v0.0.1 骨架
