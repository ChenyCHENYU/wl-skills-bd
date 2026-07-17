# Backend Standards 规范门控（懒加载入口）

> **版本**：v0.7.0  **维护者**：CHENY（工号 409322）
> **加载策略**：AI 按当前任务类型，**只读取相关条目**，不全量加载。

---

## 19 条后端规范清单

| 编号 | 文件                          | 主题                          | 强制度        | 状态     |
| ---- | ----------------------------- | ----------------------------- | ------------- | -------- |
| 01   | `01-toolchain.md`             | JDK / Maven / Lombok 前置检测 + 数据库类型探测 | 🔴 阻断       | ✅ 已落地 |
| 02   | `02-project-structure.md`     | 包结构 + 分层 + 禁止跨层 + 单目录粒度 + 业务中心包名映射 | 🔴 必遵 | ✅ 已落地 |
| 03   | `03-naming.md`                | 类 / 方法 / 字段 / 路径命名   | 🔴 必遵       | ✅ 已落地 |
| 04   | `04-controller.md`            | Controller 模板 + 权限 + 返回 | 🔴 必遵       | ✅ 已落地 |
| 05   | `05-service.md`               | Service 接口 + 实现 + 状态变更 | 🔴 必遵      | ✅ 已落地 |
| 06   | `06-mapper-xml.md`            | 禁 SELECT \* + 动态 + 分页    | 🔴 必遵       | ✅ 已落地 |
| 07   | `07-entity-dto-vo.md`         | Entity / DTO / VO / Query     | 🔴 必遵       | ✅ 已落地 |
| 08   | `08-exception.md`             | ServiceAssert + ServiceException + 业务码字典 + 全局Advice | 🔴 必遵 | ✅ 已落地 |
| 09   | `09-logging.md`               | SLF4J 占位符 + 脱敏正则 + traceId + 级别决策 | 🔴 必遵 | ✅ 已落地 |
| 10   | `10-transaction.md`           | @Transactional + 回滚矩阵 + 传播场景 + self-injection | 🔴 必遵 | ✅ 已落地 |
| 11   | `11-security-permission.md`   | 权限码 + 同步流程 + COMPANY_ID 租户过滤 + 越权清单 | 🔴 必遵 | ✅ 已落地 |
| 12   | `12-database-ddl.md`          | 建表 + 索引 + 序列 + 命名 + 物理库归属 | 🔴 必遵 + 阻断 | ✅ 已落地 |
| 13   | `13-api-doc-swagger.md`       | OpenAPI 3 + Knife4j（@Tag/@Operation/@Schema，按模块分组） | 🔴 必遵 | ✅ 已落地 |
| 14   | `14-test-coverage.md`         | 单测覆盖红线 + Mock 规范      | 🟡 建议       | 🟡 骨架 |
| 15   | `15-code-quality.md`          | 编程质量（过时方法/常量/枚举注释/大括号/字符串常量/switch-break 等 14 条） | 🔴 必遵 | ✅ 已落地 |
| 16   | `16-performance.md`           | 性能优化（BeanUtils/集合容量/正则预编译/StringBuilder 等 5 条） | 🔴 必遵 | ✅ 已落地 |
| 17   | `17-bug-prevention.md`        | 漏洞防护（BigDecimal/equals/float精度/NPE/ThreadLocal/SimpleDateFormat 等 16 条） | 🔴 必遵 | ✅ 已落地 |
| 18   | `18-git-commit.md`            | Git 提交信息格式（类型code + 模块名 + 功能点） | 🔴 必遵 | ✅ 已落地 |
| 19   | `19-design.md`                | 设计规约（SOLID + 封装决策 + 长度红线 + 设计模式 + 反模式） | 🔴 必遵 | ✅ 已落地 |

---

## 任务类型 → 必读规范映射

> AI 按用户意图选取下方匹配的「任务类型」，**仅加载该类型对应的规范文件**。

### 任务类型 A：基于 api.md 生成完整服务（service-codegen）

```
必读：01 / 02 / 04 / 05 / 06 / 07 / 11 / 13
按需：08（含状态机时） / 09（含定时任务时） / 10（含跨表事务时）
性能与质量：15 / 16 / 17（代码生成阶段一并对照）
```

### 任务类型 B：仅生成 Entity / DTO / VO（entity-codegen）

```
必读：02 / 03 / 07 / 12（含字段映射）
按需：13（Swagger 注解） / 17（POJO 漏洞规则：wrapper类型/is前缀/equals）
```

### 任务类型 C：生成 Mapper XML（mapper-xml-gen）

```
必读：06 / 02
按需：12（如 XML 涉及新表）
```

### 任务类型 D：DDL 与数据迁移（db-migration）

```
必读：12（含 §0.5 物理库归属选库） / 11（租户字段强制） / 02（领域包对齐）
```

### 任务类型 E：后端规范审计（convention-audit-be）

```
必读：全部 19 条（审计需要完整对照，含 18 Git 提交规范 + 19 设计规约）
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

> **不要** 一次性读取全部 19 条。错误示范：`✅ 已读取 standards/01 ~ standards/19`。

---

## 规范变更管理

- 新增规范条目：编号顺序追加，不复用废弃编号
- 修改既有规范：在文件末尾追加 `## 变更记录` 章节
- 整体破坏性变更：升级 `version`，根 `CHANGELOG.md` 同步标注
