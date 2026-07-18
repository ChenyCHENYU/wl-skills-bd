# 02 · 项目包结构与分层（✅ 已落地）

> 团队基线：jh4j-cloud 体系（Spring Boot + MyBatis-Plus）；共性结构参考官方/社区最佳实践。

---

## 业务中心 × 工程包名映射（团队开发要求）

> 依据《项目开发手册》§"工程及包名称约定" / §"工程目录具体划分" / §"业务模块端口划分" / §"数据库划分"。新建工程或新模块时（service-codegen / entity-codegen），**根包、端口、数据库归属必须按下表对齐**，不得套用单一样例。

| 业务中心   | 后端工程      | 后端包名            | 前端工程        | 端口范围 | 数据库集群 |
| ---------- | ------------- | ------------------- | --------------- | -------- | ---------- |
| 销售管理   | `wl-sale`     | `com.jhict.sale`    | `wl-ui-sale`    | 10000~10099 | cx（产销）|
| 质量管理   | `wl-quality`  | `com.jhict.quality` | `wl-ui-quality` | 10100~10199 | cx（产销）|
| 生产订单   | `wl-produce`  | `com.jhict.produce` | `wl-ui-produce` | 10200~10299 | cx（产销）|
| 成本管理   | `wl-cost`     | `com.jhict.cost`    | `wl-ui-cost`    | 10300~10339 | cx（产销）|
| 安全       | `wl-safe`     | `com.jhict.safe`    | `wl-ui-safe`    | 10400~10499 | non_cx（非产销）|
| 设备管理   | `wl-equipment`| `com.jhict.equipment`| `wl-ui-equipment`| 10500~10599 | iot |
| 环保管理   | `wl-env`      | `com.jhict.env`     | `wl-ui-env`     | 10600~10699 | non_cx |
| 计量物流   | `wl-logistics`| `com.jhict.logistics`| `wl-ui-logistics`| 10700~10799 | non_cx |
| 能源管理   | `wl-energy`   | `com.jhict.energy`  | `wl-ui-energy`  | 10800~10899 | non_cx |
| 主数据(MDM)| `mdm-service` | `com.jhict.mdm`     | —               | 专用 | pt（平台）|

### 数据库集群归属（与 standards/24 §3.3 联动）

| 集群 | 库 | 用户 | 业务中心 |
|---|---|---|---|
| **cx**（产销）| `hx_cxdb1` | `cxuser` | sale/quality/produce/cost |
| **non_cx**（非产销）| `hx_non_cxdb2` | `nonuser` | safe/env/logistics/energy |
| **pt**（平台）| `hx_ptdb` | `ptuser` | mdm/平台基础 |

> 手册标注"待定/作业计划/物料实绩/仓储管理/冷精管理/废钢闭环"的业务中心，按定稿后补登本表，编号顺序预留。冷精属 cx，废钢属 non_cx。

> **AI 约束**：service-codegen 在新工程生成代码前，**先核对工程根包 + 端口 + 数据库归属**（读父 `pom.xml` 的 `groupId`、bootstrap.yml 的 `server.port`、datasource profile），按本表确认业务域，发现不一致记违规并提示修正。

### 工程目录角色（团队全局）

| 目录         | 角色                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `wl-apis`    | **所有 api 及 api 涉及的 DTO**、平台开放工程（网关等）、业务基础实体类、通用 Service 基类、基础业务组件、跨服务业务校验工具、通用注解 |
| `wl-common`  | 公共服务工程                                                                                           |
| `wl-xxx`     | 各业务中心后端工程                                                                                     |
| `wl-ui-xxx`  | 各业务中心前端工程                                                                                     |

> **依赖与构建顺序（有跨域 api 依赖时）**：本地先 `install wl-apis`，再打包/启动；部署时流水线先发布 `wl-apis`，再发布业务模块。**单服务特例**：独立建仓服务（如 mdm-service）自带 `-entity/-api`，援引手册"单服务可不依赖 wl-apis"豁免。

### AI 使用约束

- `service-codegen` / `entity-codegen` 在新工程生成代码前，**先核对工程根包**（读父 `pom.xml` 的 `groupId`），按本表确认业务域，禁止把 `com.jhict.mdm` 套到非 MDM 工程
- 发现包名与业务中心不匹配（如 `wl-sale` 却用了 `com.jhict.mdm`）→ 记为违规并提示修正

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
        ├── service/                   应用 Service；单实现默认直接类，可选 port/impl
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
Controller → Application Service → Mapper → XML
```

| 层                    | 职责                                                      | 禁止事项                                |
| --------------------- | --------------------------------------------------------- | --------------------------------------- |
| `controller/`         | 接收请求、参数预处理、调用 Service、返回 `ApiResult`      | 禁止写业务逻辑、禁止直接调用 Mapper     |
| `service/`            | 业务编排、事务边界；默认 `XxxService extends JhServiceImpl` | 禁止直接写 SQL、禁止跨模块注入 Mapper |
| `service/port/`       | 多实现、策略、远程或跨模块边界的可替换接口（按需）         | 单实现 CRUD 不得为了形式强制建接口 |
| `service/impl/`       | 仅在存在 port/多实现时使用                                 | 禁止同一子域混用直接类与 interface/impl |
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

## 单目录文件粒度（🔴 必遵）

> 依据《项目开发手册》§"业务服务目录划分"。

- 任一业务子域目录下的文件数 **≤ 20**，**10 以内为最佳**
- 超过 20 个即触发"再拆子域"信号：按二级业务语义拆分子包（如 `feature/` 下再分 `category/`、`design/`）
- 审计（`convention-audit-be`）对单目录文件数计数，>20 记为提示项；>30 记为违规
- 依据：避免单目录文件过多导致 AI 检索噪声、人工 review 困难、命名冲突

```
controller/feature/                    ← 8 个文件 ✅
controller/feature/category/           ← 拆分后子域，再控制 ≤20
controller/modelAttributeMap/          ← 8 个文件 ✅
controller/某域/                       ← 35 个文件 ❌ 必须拆子域
```

---

## 包命名规范

- 根包：全小写、无下划线（`com.jhict.mdm` / `com.xisc.industry`）
- 业务子域：小写单词（`feature` / `modelAttributeMap` / `qualityRules`）
- **业务子域命名允许 lowerCamelCase 子包**（如 `modelAttributeMap`）但要避免下划线；Checkstyle 与此口径一致
- 禁止使用 `common2` / `util2` / `test`（测试除外）

---

## 与外部参考的差异

| 维度                | 团队基线（jh4j-cloud 三层）    | CLAUDE 规范（外部参考，不集成）              |
| ------------------- | ------------------------------ | -------------------------------------------- |
| DDD 分层            | 不强调（`api/app/domain/infra` 不使用） | 严格 DDD：`api/app/domain/infra`             |
| Repository 接口     | 简单 CRUD 直接 Mapper；跨模块/多实现才抽 port | 必须有 `domain/repository/` + `infra/repository/impl/` |
| 路径风格            | 驼峰（`mdmFeatureCategory`）    | kebab-case（`/v1/{orgId}/cy-contents`）      |
| 租户字段            | `companyId` / `tenantId` 不强 | `tenantId` + `@PathVariable Long organizationId` |

> **取舍**：本规范采用 **经典三层结构**（Controller/Service/Mapper），不引入 DDD 四层。理由：(1) 与 jh4j-cloud 体系一致；(2) MyBatis-Plus 已覆盖大多数 Repository 需求；(3) 引入 DDD 四层会大量增加样板代码。

---

## 变更记录

- 2026-07-17 v0.0.5 新增"业务中心 × 工程包名映射"（对齐手册，闭环新建工程包名生成）
- 2026-07-17 v0.0.4 补充"单目录文件 ≤20"粒度红线（对齐手册）
- 2026-05-14 v0.0.1 初始化
