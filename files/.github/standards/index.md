# Backend Standards 规范门控（懒加载入口）

> **版本**：v0.17.1  **维护者**：agile-team
> **加载策略**：AI 按当前任务类型，**只读取相关条目**，不全量加载。

---

## 28 条后端规范清单

| 编号 | 文件                          | 主题                          | 强制度        | 状态     |
| ---- | ----------------------------- | ----------------------------- | ------------- | -------- |
| 01   | `01-toolchain.md`             | JDK / Maven / Lombok 前置检测 + 数据库类型探测 | 🔴 阻断       | ✅ 已落地 |
| 02   | `02-project-structure.md`     | 包结构 + 分层 + 禁止跨层 + 单目录粒度 + 业务中心×端口×数据库集群映射 | 🔴 必遵 | ✅ 已落地 |
| 03   | `03-naming.md`                | 类 / 方法 / 字段 / 路径命名   | 🔴 必遵       | ✅ 已落地 |
| 04   | `04-controller.md`            | Controller 模板 + 权限 + 返回 | 🔴 必遵       | ✅ 已落地 |
| 05   | `05-service.md`               | Service 接口 + 实现 + 状态变更 + 业务命令四段式 | 🔴 必遵 | ✅ 已落地 |
| 06   | `06-mapper-xml.md`            | 禁 SELECT \* + 动态 + 分页 + 全表写禁令 | 🔴 必遵 | ✅ 已落地 |
| 07   | `07-entity-dto-vo.md`         | Entity / DTO / VO / Query     | 🔴 必遵       | ✅ 已落地 |
| 08   | `08-exception.md`             | ServiceAssert + ServiceException + 业务码字典 + 全局Advice | 🔴 必遵 | ✅ 已落地 |
| 09   | `09-logging.md`               | SLF4J 占位符 + 脱敏正则 + traceId + 级别决策 | 🔴 必遵 | ✅ 已落地 |
| 10   | `10-transaction.md`           | @Transactional + 回滚矩阵 + 传播场景 + self-injection | 🔴 必遵 | ✅ 已落地 |
| 11   | `11-security-permission.md`   | 权限码 + 同步流程 + COMPANY_ID 租户过滤 + 越权清单 + 二次确认 | 🔴 必遵 | ✅ 已落地 |
| 12   | `12-database-ddl.md`          | 建表 + 索引 + 序列 + 命名 + 物理库归属 + 数据库集群 + 生产审批流程 | 🔴 必遵 + 阻断 | ✅ 已落地 |
| 13   | `13-api-doc-swagger.md`       | OpenAPI 3 + Knife4j + Swagger 2 迁移 + Apifox 集成 | 🔴 必遵 | ✅ 已落地 |
| 14   | `14-test-coverage.md`         | JUnit 5 测试分层 + JaCoCo 类级覆盖率门禁 | 🔴 必遵 | ✅ 已落地 |
| 15   | `15-code-quality.md`          | 编程质量（过时方法/常量/枚举注释/大括号/字符串常量/switch-break 等 14 条） | 🔴 必遵 | ✅ 已落地 |
| 16   | `16-performance.md`           | 性能优化（BeanUtils/集合容量/正则预编译/StringBuilder 等 5 条） | 🔴 必遵 | ✅ 已落地 |
| 17   | `17-bug-prevention.md`        | 漏洞防护（BigDecimal/equals/float精度/NPE/ThreadLocal/SimpleDateFormat 等 16 条） | 🔴 必遵 | ✅ 已落地 |
| 18   | `18-git-commit.md`            | Git 提交信息格式（不包分支治理） | 🔴 必遵 | ✅ 已落地 |
| 19   | `19-design.md`                | 设计规约（SOLID + 封装决策 + 长度红线 + 设计模式 + 反模式） | 🔴 必遵 | ✅ 已落地 |
| 20   | `20-redis-cache.md`           | Redis/缓存：Key 命名/TTL 强制/Redisson 锁/三大问题/大 Key/序列化/禁令 | 🔴 必遵 | ✅ 已落地 |
| 21   | `21-sensitive-write.md`       | 敏感写：批量分批/物理删禁令/幂等/跨库/灰度/生产只读/二次确认/审计 | 🔴 必遵 | ✅ 已落地 |
| 22   | `22-resilience.md`            | 限流熔断：Feign 超时/重试/熔断/舱壁/限流/降级 | 🔴 必遵 | ✅ 已落地 |
| 23   | `23-scheduled-task.md`        | 定时任务：@Scheduled/@SchedulerLock/幂等/超时/重试/监控 | 🔴 必遵 | ✅ 已落地 |
| 24   | `24-multi-env.md`             | 多环境：profile/nacos/datasource/生产护栏 | 🔴 必遵 | ✅ 已落地 |
| 25   | `25-config-layering.md`       | 配置分层与多环境管理：三层分层/环境差异矩阵/体检/迁移/排查 | 🔴 必遵 | ✅ 已落地 |
| 26   | `26-task-driven.md`           | 任务驱动与精准触发：只读路由/8 种任务类型/规则子集/统一安全写链 | 🔴 必遵 | ✅ 已落地 |
| 27   | `27-project-catalog-context.md` | 项目目录与精准上下文：模块增量扫描/一跳快照/去重/生成前置门禁 | 🔴 必遵 | ✅ 已落地 |
| 28   | `28-production-assurance.md` | 生产保障：SLO/RTO/RPO、安全、数据治理、并发一致性、微服务韧性与交付证据 | 🔴 生产必遵 | ✅ 已落地 |

---

## 任务类型 → 必读规范映射

> AI 按用户意图选取下方匹配的「任务类型」，**仅加载该类型对应的规范文件**。

### 任务类型 A：基于 api.md 生成完整服务（service-codegen）

```
生成前必读：27（当前模块目录与一跳上下文）
必读：01 / 02 / 04 / 05 / 06 / 07 / 11 / 13
按需：08（含状态机时） / 09（含定时任务时） / 10（含跨表事务时） / 20（含 Redis/缓存时） / 21（含批量/物理删/幂等时） / 22（含外部调用时） / 23（含定时任务时） / 24（多环境/生产护栏） / 28（生产级或核心链路）
性能与质量：15 / 16 / 17（代码生成阶段一并对照）
```

### 任务类型 B：仅生成 Entity / DTO / VO（entity-codegen）

```
必读：02 / 03 / 07 / 12（含字段映射）
按需：13（OpenAPI 3 注解） / 17（POJO 漏洞规则：wrapper类型/is前缀/equals）
```

### 任务类型 C：生成 Mapper XML（mapper-xml-gen）

```
必读：06 / 02
按需：12（如 XML 涉及新表）/ 21（如含批量写）
```

### 任务类型 D：DDL 与数据迁移（db-migration）

```
必读：12（含 §0.5 物理库归属选库 + §8.5 生产审批流程） / 11（租户字段强制） / 02（领域包对齐）/ 21（敏感写护栏）
```

### 任务类型 E：后端规范审计（convention-audit-be）

```
必读：当前任务路由命中的 standards 子集；全量审计时读 01~28
必跑：B1~B25 + J1~J5/J8；J6/J7 仅作可选能力，不冒充硬门
生产审计：必须核对 28 的 assurance 声明、六类证据和外部评审边界
```

### 任务类型 F：接口契约审查（api-design-be）

```
必读：03 / 04 / 11 / 13
按需：07（涉及响应结构改造时）
```

### 任务类型 G：测试生成（unit-test-gen）

```
必读：14 / 05（Service 测试切片） / 04（Controller 测试入参）
```

### 任务类型 H：异常 / 日志 / 事务专项审计

```
必读：08 / 09 / 10
```

### 任务类型 I：数据安全与稳定性审计（v0.10）

```
必读：20（Redis/缓存） / 21（敏感写） / 22（限流熔断） / 23（定时任务） / 24（多环境护栏） / 11（二次确认） / 12（生产审批） / 28（生产证据）
```

> 不得以“全面”为由加载全部规范；只加载任务映射、当前模块与一跳关系所需条目。

---

## 加载方式（Pre-flight 声明示例）

```
✅ 已读取 standards/index.md             → 规范门控，匹配任务类型 A
✅ 已读取 standards/02-project-structure.md  → 包结构 + 分层
✅ 已读取 standards/04-controller.md         → Controller 模板 + 权限
✅ 已读取 standards/05-service.md            → Service 状态变更模板
✅ 已读取 standards/06-mapper-xml.md         → 禁 SELECT *、动态条件、分页
✅ 已读取 standards/11-security-permission.md → @pms.hasPermission 规范
```

### 任务类型 J：配置与环境管理（v0.12）

```
必读：25（配置分层） / 24（多环境隔离）
工具：config doctor/init/migrate/fix + troubleshoot
```

### 任务类型 K：任务驱动精准触发（v0.13）

```
工具：wl-skills-bd task "<自然语言>" 或 --type <id>
必读：26（任务驱动）+ 对应任务的 standards 子集（task-router 自动路由）
```

### 任务类型 L：项目目录与模块上下文（v0.15）

```
工具：catalog plan/apply/check + context plan
必读：27（模块增量扫描、一跳快照、去重和 codegen 前置门禁）
```

> **不要** 一次性读取全部 28 条。错误示范：`✅ 已读取 standards/01 ~ standards/28`。

---

## 规范变更管理

- 新增规范条目：编号顺序追加，不复用废弃编号
- 修改既有规范：在文件末尾追加 `## 变更记录` 章节
- 整体破坏性变更：升级 `version`，根 `CHANGELOG.md` 同步标注
