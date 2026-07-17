# 12 · 数据库 DDL 与建表规范（✅ 已落地）

> **数据库双模说明**：
> - **主流业务项目 → MySQL**（`jh4j-cloud-starter-mysql-resource-service`，使用 MySQL 语法）
> - **mdm-service 等主数据项目 → Oracle**（`${DATASOURCE:oracle}`，使用 Oracle 方言）
> - **AI 触发本规范前必须先确认目标工程的数据库类型**：检查 `pom.xml` 引入的 starter 或 `bootstrap.yml` 的 `DATASOURCE` 变量。
>
> 所有 DDL 必须有 **CREATE + 回滚** 配对脚本，经 `db-migration` Skill 人工确认后方可执行。

---

## 0. AI 前置确认（必须）

```
📋 目标工程数据库类型确认
   pom.xml 含 jh4j-cloud-starter-mysql-resource-service  → MySQL → 使用 §A
   pom.xml 含 jh4j-cloud-starter-oracle-resource-service
   或 bootstrap.yml DATASOURCE=oracle                    → Oracle → 使用 §B
   两者都有                                               → 询问用户当前运行环境
```

---

## 0.5 数据库物理库归属（选库依据 · 团队开发要求）

> 依据《项目开发手册》§"数据库划分"。`db-migration` 生成 DDL / 回填脚本前，**除确认方言(MySQL/Oracle)外，还必须确认落库归属**，否则建表/审计建议会给错库。

### 三大物理库与用户映射

| 物理库          | 用途     | 数据库用户  | 语义                     |
| --------------- | -------- | ----------- | ------------------------ |
| `hx_cxdb1`      | 产销库   | `cxuser`    | 产销业务数据             |
| `hx_non_cxdb2`  | 非产销库 | `nonuser`   | 非产销业务数据           |
| `hx_ptdb`       | 平台库   | `ptuser`    | 平台底座数据             |

### 业务模块 → 物理库归属表

| 业务模块               | 库归类               | 落库 / 用户               |
| ---------------------- | -------------------- | ------------------------- |
| 生产管理               | 业务（产销）         | `hx_cxdb1` / `cxuser`     |
| 成本管理               | 业务（产销）         | `hx_cxdb1` / `cxuser`     |
| 品质管控               | 业务（产销）         | `hx_cxdb1` / `cxuser`     |
| 营销管理               | 业务（产销）         | `hx_cxdb1` / `cxuser`     |
| 冷精管理               | 业务（产销）         | `hx_cxdb1` / `cxuser`     |
| 物流管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 计量管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 安全管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 安防管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 能源管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 环保管理               | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 废钢闭环管理           | 业务（非产销）       | `hx_non_cxdb2` / `nonuser`|
| 设备管理               | 基础管理，数据先进 IOT | IOT 链路（非上述三库）   |
| 数据治理               | 独立（不考虑）       | —                         |
| 开发与数据平台         | 独立（不考虑）       | —                         |
| 炼钢智能化 / 轧钢智能化 | 独立（不考虑）       | —                         |
| **MDM（主数据）**      | **独立 Oracle 部署** | **特例**：见 §0.5 末尾    |

### MDM 特例（独立 Oracle）

`mdm-service` 作为主数据底座，**不落上述三大 MySQL 库**，而走独立 Oracle（`${DATASOURCE:oracle}`）。`db-migration` 触发 MDM 时：
- 方言用 §B（Oracle）；
- 库归属按"独立 Oracle 实例"处理，**不在三库归属表内套用**。

### db-migration 选库决策（Pre-flight 必填）

生成建表 SQL 前，AI 必须在 `reports/DDL_PREVIEW_*.md` 顶部声明：

```
📋 选库决策
   业务模块：{生产管理|成本管理|...|MDM}
   方言：    {MySQL|Oracle}
   落库：    {hx_cxdb1|hx_non_cxdb2|hx_ptdb|独立 Oracle}
   数据库用户：{cxuser|nonuser|ptuser|mdm 专用}
   依据：    本标准 §0.5 业务模块 → 物理库归属表
```

> 命中"独立（不考虑）"的模块，`db-migration` 返回阻断：该业务域不纳入建表范围。

---

## 1. 通用规则（MySQL / Oracle 均适用）

### 表与字段命名

- 表名：全大写 + 下划线，含模块前缀（`MDM_` / `CY_` / `HR_`），与 Java 包前缀一致
- 字段名：全大写 + 下划线（`CATEGORY_CODE` / `CREATE_DATE_TIME`）
- 标志位：`IS_XXX`（Integer 1/0）；时间：`XXX_DATE_TIME`；外键：`{REF_TABLE}_ID`

### 业务表必备字段（7 件套）

| 字段               | Java 类型        | 用途                       |
| ------------------ | ---------------- | -------------------------- |
| `ID`               | `String`         | 主键（雪花 ID）            |
| `COMPANY_ID`       | `String`         | 租户隔离                   |
| `IS_DELETE`        | `Integer`        | 软删除：1=有效, 0=删除     |
| `REVISION`         | `Integer`        | 乐观锁版本号               |
| `CREATE_USER_NO`   | `String`         | 创建人工号                 |
| `CREATE_DATE_TIME` | `LocalDateTime`  | 创建时间                   |
| `UPDATE_USER_NO`   | `String`         | 更新人工号                 |
| `UPDATE_DATE_TIME` | `LocalDateTime`  | 更新时间                   |

> 由 `EntityUtil.fillCreateData / fillUpdateData` + MyBatis-Plus `FieldFill` 自动维护，**禁止业务代码裸写**。

### 主键生成（通用）

**业务侧雪花 ID（团队统一基线）**：`IdWorker.getId()`，Java 侧生成 String 类型，**与数据库类型无关，Oracle / MySQL 均适用**。不依赖 DB 序列或 AUTO_INCREMENT。

### 索引规则（通用）

| 索引名              | 字段                                  |
| ------------------- | ------------------------------------- |
| `IDX_{T}_COMPANY`   | `COMPANY_ID`                          |
| `IDX_{T}_DELETE`    | `IS_DELETE`                           |
| `UK_{T}_xxxx`       | 业务唯一键（**必须含 `IS_DELETE`**）  |
| `IDX_{T}_PARENT`    | 树形结构的 `PARENT_ID`                |

> **唯一索引必须把 `IS_DELETE` 纳入**，否则软删除后无法重复新增同名记录。

---

## §A. MySQL 语法模板（主流业务项目）

### 建表示例

```sql
CREATE TABLE `feature_category` (
  `id`                VARCHAR(64)      NOT NULL          COMMENT '主键',
  `category_code`     VARCHAR(64)      NOT NULL          COMMENT '分类编码',
  `category_name`     VARCHAR(200)     NOT NULL          COMMENT '分类名称',
  `parent_id`         VARCHAR(64)                        COMMENT '父级 ID',
  -- 7 件套
  `company_id`        VARCHAR(64)                        COMMENT '租户 ID',
  `is_delete`         TINYINT          NOT NULL DEFAULT 1 COMMENT '软删除：1=有效, 0=删除',
  `revision`          INT              NOT NULL DEFAULT 1 COMMENT '乐观锁',
  `create_user_no`    VARCHAR(64)                        COMMENT '创建人工号',
  `create_date_time`  DATETIME                           COMMENT '创建时间',
  `update_user_no`    VARCHAR(64)                        COMMENT '更新人工号',
  `update_date_time`  DATETIME                           COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_feature_category_code` (`category_code`, `company_id`, `is_delete`),
  KEY `idx_feature_category_company` (`company_id`),
  KEY `idx_feature_category_delete` (`is_delete`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='特征量分类';
```

### MySQL 字段类型映射

| Java 类型              | MySQL 类型          | 备注                    |
| ---------------------- | ------------------- | ----------------------- |
| `String`（主键/编码）  | `VARCHAR(64)`       |                         |
| `String`（名称）       | `VARCHAR(200)`      |                         |
| `String`（描述）       | `VARCHAR(2000)`     |                         |
| `String`（超长）       | `TEXT` / `LONGTEXT` | 富文本 / JSON           |
| `Integer`              | `INT`               |                         |
| `Long`                 | `BIGINT`            |                         |
| `Boolean`              | `TINYINT DEFAULT 0` | 1=是 0=否               |
| `BigDecimal`（金额）   | `DECIMAL(20,2)`     |                         |
| `BigDecimal`（比率）   | `DECIMAL(10,4)`     |                         |
| `LocalDate`            | `DATE`              |                         |
| `LocalDateTime`        | `DATETIME`          |                         |

### MySQL 特定规则

- 字符集：**必须 `utf8mb4`**，禁用 `utf8`（会截断 emoji）
- 引擎：**InnoDB**（支持事务）
- 表/字段命名：小写 + 下划线（MyBatis-Plus `mapUnderscoreToCamelCase` 自动映射 Java camelCase）
- 分页：`LIMIT #{offset}, #{size}`（MyBatis-Plus 内置分页拦截器自动生成，无需手写）
- 模糊查询：`CONCAT('%', #{x}, '%')`（三参数 CONCAT）
- 回滚脚本：`DROP TABLE IF EXISTS feature_category;`
- 注释：`COMMENT '...'` 直接写在字段后，无需单独 `COMMENT ON`

---

## §B. Oracle 语法模板（mdm-service 等主数据项目）

> ⚠️ 仅当 `pom.xml` 含 `jh4j-cloud-starter-oracle-resource-service` 或 `bootstrap.yml` 有 `DATASOURCE=oracle` 时使用。

### 建表示例

```sql
CREATE TABLE MDM_FEATURE_CATEGORY (
    ID                VARCHAR2(64 CHAR)  NOT NULL,
    CATEGORY_CODE     VARCHAR2(64 CHAR)  NOT NULL,
    CATEGORY_NAME     VARCHAR2(200 CHAR) NOT NULL,
    PARENT_ID         VARCHAR2(64 CHAR),
    -- 7 件套
    COMPANY_ID        VARCHAR2(64 CHAR),
    IS_DELETE         NUMBER(1)          DEFAULT 1 NOT NULL,
    REVISION          NUMBER(10)         DEFAULT 1 NOT NULL,
    CREATE_USER_NO    VARCHAR2(64 CHAR),
    CREATE_DATE_TIME  TIMESTAMP(6),
    UPDATE_USER_NO    VARCHAR2(64 CHAR),
    UPDATE_DATE_TIME  TIMESTAMP(6),
    CONSTRAINT PK_MDM_FEATURE_CATEGORY PRIMARY KEY (ID)
);

-- Oracle 注释单独写（不支持行内 COMMENT）
COMMENT ON TABLE  MDM_FEATURE_CATEGORY                   IS '特征量分类';
COMMENT ON COLUMN MDM_FEATURE_CATEGORY.ID                IS '主键';
COMMENT ON COLUMN MDM_FEATURE_CATEGORY.CATEGORY_CODE     IS '分类编码';
COMMENT ON COLUMN MDM_FEATURE_CATEGORY.IS_DELETE         IS '是否有效：1=有效, 0=删除';
-- 每列必须有 COMMENT

CREATE INDEX        IDX_MDM_FEATURE_CATEGORY_COMPANY ON MDM_FEATURE_CATEGORY (COMPANY_ID);
CREATE INDEX        IDX_MDM_FEATURE_CATEGORY_DELETE  ON MDM_FEATURE_CATEGORY (IS_DELETE);
CREATE UNIQUE INDEX UK_MDM_FEATURE_CATEGORY_CODE     ON MDM_FEATURE_CATEGORY (CATEGORY_CODE, COMPANY_ID, IS_DELETE);
```

### Oracle 字段类型映射

| Java 类型             | Oracle 类型           | 备注                          |
| --------------------- | --------------------- | ----------------------------- |
| `String`（主键/编码） | `VARCHAR2(64 CHAR)`   | CHAR 语义，避免多字节截断     |
| `String`（名称）      | `VARCHAR2(200 CHAR)`  |                               |
| `String`（描述）      | `VARCHAR2(2000 CHAR)` |                               |
| `String`（超长）      | `CLOB`                | 富文本 / JSON                 |
| `Integer`             | `NUMBER(10)`          |                               |
| `Long`                | `NUMBER(20)`          |                               |
| `Boolean`             | `NUMBER(1) DEFAULT 0` | 1=是 0=否                     |
| `BigDecimal`（金额）  | `NUMBER(20,2)`        |                               |
| `BigDecimal`（比率）  | `NUMBER(10,4)`        |                               |
| `LocalDate`           | `DATE`                |                               |
| `LocalDateTime`       | `TIMESTAMP(6)`        |                               |

### Oracle 特定规则

- 表/字段命名：**全大写 + 下划线**（Oracle 默认大写存储）
- `VARCHAR2` 必须用 **`CHAR` 语义**，否则 UTF-8 中文占 3 字节导致被截断
- 注释：`COMMENT ON TABLE` / `COMMENT ON COLUMN` **每列必填**（不支持行内 COMMENT）
- 分页：`ROWNUM` 子查询包裹（`WHERE ROWNUM <= N`），**不用 LIMIT**
- 模糊查询：`CONCAT(CONCAT('%', #{x}), '%')`（Oracle CONCAT 仅支持 2 个参数）
- 排序 NULL 值：`ORDER BY xxx DESC NULLS LAST`
- 回滚脚本：`DROP TABLE MDM_FEATURE_CATEGORY;`（Oracle 无 IF EXISTS）

---

## DDL 与回滚脚本（通用）

**禁止裸跑 DDL**。必须提供配对脚本：

```
db/migration/
├── V20260514_001__create_feature_category.sql    (正向 DDL)
└── V20260514_001__rollback.sql                   (反向 DROP / ALTER)
```

Flyway / Liquibase 遵循其文件命名规则。

---

## 写库前置确认（🔴 红线）

`db-migration` Skill 生成 DDL 后，**AI 不允许直接执行**，必须：

1. 输出 `reports/DDL_PREVIEW_yyyymmdd.md`（含目标数据库类型 + 正向 + 回滚 SQL）
2. 等待人工评审确认
3. 由人工 / CD 流水线执行

---

## 变更记录

- 2026-07-17 v0.0.5 新增 §0.5 数据库物理库归属（对齐手册§"数据库划分"，闭环 db-migration 选库）
- 2026-05-14 v0.0.1 落地（基于 mdm-service 真实代码，Oracle 语法）
- 2026-05-15 v0.0.1+ 拆分为 §A MySQL（主流项目）和 §B Oracle（mdm-service 等主数据项目）


---

## 1. 表命名

- 全大写 + 下划线：`MDM_FEATURE_CATEGORY` / `CY_CONTENT`
- 模块前缀（如 `MDM_` / `CY_` / `HR_`）必须与对应 Java 包前缀一致
- 复数不使用（与 HZERO kebab-case 路径不同，DB 用单数）

---

## 2. 字段命名

- 全大写 + 下划线：`CATEGORY_CODE` / `CREATE_DATE_TIME`
- 标志位：`IS_XXX` 或 `XXX_FLAG`（Integer 1/0）
- 时间字段：`XXX_DATE_TIME` / `XXX_DATE`
- 外键：`{REF_TABLE}_ID`（如 `PARENT_ID`、`CATEGORY_ID`）

---

## 3. 业务表必备字段（7 件套）

```sql
CREATE TABLE MDM_FEATURE_CATEGORY (
    ID                VARCHAR2(64 CHAR)  NOT NULL,
    -- 业务字段 ...
    CATEGORY_CODE     VARCHAR2(64 CHAR)  NOT NULL,
    CATEGORY_NAME     VARCHAR2(200 CHAR) NOT NULL,

    -- 必备 7 件套（团队基线）
    COMPANY_ID        VARCHAR2(64 CHAR),                           -- 租户隔离
    IS_DELETE         NUMBER(1)         DEFAULT 1 NOT NULL,        -- 软删除：1=有效, 0=删除
    REVISION          NUMBER(10)        DEFAULT 1 NOT NULL,        -- 乐观锁
    CREATE_USER_NO    VARCHAR2(64 CHAR),
    CREATE_DATE_TIME  TIMESTAMP(6),
    UPDATE_USER_NO    VARCHAR2(64 CHAR),
    UPDATE_DATE_TIME  TIMESTAMP(6),

    CONSTRAINT PK_MDM_FEATURE_CATEGORY PRIMARY KEY (ID)
);

COMMENT ON TABLE MDM_FEATURE_CATEGORY IS '特征量分类';
COMMENT ON COLUMN MDM_FEATURE_CATEGORY.CATEGORY_CODE IS '分类编码';
COMMENT ON COLUMN MDM_FEATURE_CATEGORY.IS_DELETE IS '是否有效：1=有效, 0=删除';
-- ... 每列必须有 COMMENT

-- 必建索引
CREATE INDEX IDX_MDM_FEATURE_CATEGORY_COMPANY ON MDM_FEATURE_CATEGORY (COMPANY_ID);
CREATE INDEX IDX_MDM_FEATURE_CATEGORY_DELETE ON MDM_FEATURE_CATEGORY (IS_DELETE);
CREATE UNIQUE INDEX UK_MDM_FEATURE_CATEGORY_CODE ON MDM_FEATURE_CATEGORY (CATEGORY_CODE, COMPANY_ID, IS_DELETE);
```

> **与 CLAUDE / HZERO 体系的差异**：HZERO 强制 `OBJECT_VERSION_NUMBER` / `TENANT_ID` / `CREATION_DATE`（5 件套），由 `AuditDomain` 自动维护。本团队基线用 `REVISION` + `COMPANY_ID` + `CREATE_DATE_TIME`（命名风格不同），由 `EntityUtil` / MyBatis-Plus `@Version` + `FieldFill` 维护。

---

## 4. 字段类型规则

| Java                  | Oracle                   | 备注                        |
| --------------------- | ------------------------ | --------------------------- |
| `String`（短）        | `VARCHAR2(64 CHAR)`      | 主键 / 编码                 |
| `String`（中）        | `VARCHAR2(200 CHAR)`     | 名称                        |
| `String`（长）        | `VARCHAR2(2000 CHAR)`    | 描述                        |
| `String`（超长）      | `CLOB`                   | 富文本 / JSON               |
| `Integer`             | `NUMBER(10)`             |                             |
| `Long`                | `NUMBER(20)`             |                             |
| `BigDecimal`（金额）  | `NUMBER(20,2)`           |                             |
| `BigDecimal`（比率）  | `NUMBER(10,4)`           |                             |
| `Boolean`             | `NUMBER(1) DEFAULT 0`    | 1=是 0=否                   |
| `LocalDate`           | `DATE`                   |                             |
| `LocalDateTime`       | `TIMESTAMP(6)`           |                             |

**统一规则**：所有 `VARCHAR2` 用 **`CHAR` 语义**，避免 UTF-8 占用 3 字节导致字段不够。

---

## 5. 主键生成方式

- **业务侧雪花 ID（团队基线，推荐）**：`IdWorker.getId()`，Java 侧生成 String 类型主键
  - 优点：分布式友好、与 jh4j-cloud 内置 MyBatis-Plus 自然衔接
- **Oracle 序列 + 触发器（外部 HZERO 风格，不推荐）**：`{TABLE}_S` + `TRI_{TABLE}_BI`

---

## 6. 索引规则

| 必建索引       | 字段                                |
| -------------- | ----------------------------------- |
| `IDX_{T}_COMPANY` | `COMPANY_ID`                      |
| `IDX_{T}_DELETE`  | `IS_DELETE`                       |
| `UK_{T}_xxxx`     | 业务唯一键（含 `COMPANY_ID`+`IS_DELETE`） |
| `IDX_{T}_PARENT`  | 树形结构的 `PARENT_ID`            |

> **唯一索引必须把 `IS_DELETE` 纳入**，否则软删除后无法重复新增同名记录。

---

## 7. DDL 与回滚脚本

**禁止裸跑 DDL**。必须提供：

```
db/migration/
├── V20260514_001__create_mdm_feature_category.sql       (CREATE)
└── V20260514_001__rollback.sql                          (DROP / 反向 ALTER)
```

或使用 Flyway / Liquibase 时遵循其文件命名规则。

---

## 8. 写库前置确认（🔴 红线）

DDL / 数据回填脚本由 `db-migration` Skill 生成。**AI 不允许直接执行**，必须：

1. 输出 `reports/DDL_PREVIEW_yyyymmdd.md`，包含正向与回滚 SQL
2. 等待用户在工作台 / 评审平台确认
3. 由人工 / CD 流水线执行；AI 仅做生成与回归审计

---

## 变更记录

- 2026-05-14 v0.0.1 落地（基于团队基线 + CLAUDE §"Oracle 建表规范"共性）
