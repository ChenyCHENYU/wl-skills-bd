# 02 · 项目包结构与分层（✅ 已落地）

> 团队基线：参考 `mdm-service` (jh4j-cloud 体系)；共性结构与 `CLAUDE规范文档/后端` (HZERO) 一致。

---

## 多模块工程标准

业务服务（如 `xxx-service`）通常拆为 3 个 Maven 模块：

```
xxx-service/                           父 POM
├── pom.xml
├── xxx-api/                           对外契约层
│   └── src/main/java/com/{co}/{prod}/api/
│       └── query/                     Query 对象
├── xxx-entity/                        领域模型 / 共享类型
│   └── src/main/java/com/{co}/{prod}/api/
│       ├── annotation/                业务自定义注解
│       ├── bo/                        业务对象
│       ├── constants/                 常量类
│       ├── dto/                       请求 / 响应 DTO（按业务子域分包）
│       ├── enums/                     枚举
│       ├── entity/                    数据库实体
│       ├── eo/                        Excel 对象（可选）
│       └── vo/                        视图对象
└── xxx-service/                       业务实现层
    └── src/main/java/com/{co}/{prod}/
        ├── annotation/                Service 层自定义注解
        ├── aspect/                    AOP 切面
        ├── config/                    配置类（Swagger / RouteExtraData 等）
        ├── controller/                REST 控制器（按业务子域分包）
        ├── feign/                     OpenFeign 客户端
        ├── listener/                  消息 / 事件监听
        ├── mapper/                    MyBatis Mapper 接口（按业务子域分包）
        ├── service/                   业务 Service 接口 + impl
        ├── task/                      定时任务
        └── utils/                     工具类
    └── src/main/resources/
        ├── mapper/                    MyBatis XML 映射
        └── application.yml
```

> **小项目变种**：单模块工程允许把 `api/entity` 直接合并到 `xxx-service`，但**包路径**保持一致。

---

## 分层职责（严格禁止跨层）

```
Controller → Service(impl) → Mapper → XML
```

| 层                    | 职责                                                      | 禁止事项                                |
| --------------------- | --------------------------------------------------------- | --------------------------------------- |
| `controller/`         | 接收请求、参数预处理、调用 Service、返回 `ApiResult`      | 禁止写业务逻辑、禁止直接调用 Mapper     |
| `service/`            | 业务编排、事务控制、调用 Mapper                            | 禁止直接写 SQL 字符串                   |
| `service/*ServiceImpl` | 实现业务方法；可继承 `JhServiceImpl<Mapper, Entity>`     | 禁止跨服务直接 new 调用，必须 @Autowired |
| `mapper/*Mapper.java` | MyBatis 接口（继承 `JhBaseMapper<T>`），含 `@Param`        | 禁止写业务逻辑                          |
| `mapper/*.xml`        | SQL 语句                                                   | 禁止 `SELECT *`、禁止业务判断           |
| `api/entity/`         | 数据模型，含 MyBatis-Plus 注解 `@TableName / @TableField` | 禁止业务逻辑、禁止 Spring 注解          |
| `api/dto/`            | 跨层传输对象                                              | 不映射数据库                            |
| `api/vo/`             | 出参视图对象                                              | 不接受请求                              |
| `api/query/`          | 复杂查询条件                                              | 不映射数据库                            |
| `feign/`              | OpenFeign 客户端                                          | 业务降级写在 `fallback/` 子包           |
| `aspect/`             | AOP 切面                                                  | 不写业务实现                            |
| `listener/`           | 消息 / 事件                                                | 业务逻辑下沉到 Service                  |
| `task/`               | 定时任务调度                                              | 业务逻辑下沉到 Service                  |

---

## 包命名规范

- 根包：全小写、无下划线（`com.jhict.mdm` / `com.xisc.industry`）
- 业务子域：小写单词（`feature` / `modelAttributeMap` / `qualityRules`）
- **业务子域命名允许驼峰子包**（如 `modelAttributeMap`）但要避免下划线
- 禁止使用 `common2` / `util2` / `test`（测试除外）

---

## 与外部参考的差异

| 维度                | 团队基线（mdm-service）        | CLAUDE 规范（外部参考，不集成）              |
| ------------------- | ------------------------------ | -------------------------------------------- |
| DDD 分层            | 不强调（`api/app/domain/infra` 不使用） | 严格 DDD：`api/app/domain/infra`             |
| Repository 接口     | 不使用，直接 Mapper             | 必须有 `domain/repository/` + `infra/repository/impl/` |
| 路径风格            | 驼峰（`mdmFeatureCategory`）    | kebab-case（`/v1/{orgId}/cy-contents`）      |
| 租户字段            | `companyId` / `tenantId` 不强 | `tenantId` + `@PathVariable Long organizationId` |

> **取舍**：本规范以 **mdm-service 三层结构** 为团队基线，不引入 DDD 四层。理由：(1) 工程已成型；(2) MyBatis-Plus 已经覆盖大多数 Repository 需求；(3) 引入 DDD 四层会大量增加样板代码。

---

## 变更记录

- 2026-05-14 v0.0.1 初始化
