# 规则 → 执行器覆盖矩阵

> 机器单一数据源是 `files/.wl-skills-bd/rules/catalog.json`。本文件解释覆盖关系；`lint-skills` 会校验阻断约定必须存在确定性执行器。

## 执行器

| 编号 | 实现 | 默认门禁 | 说明 |
|---|---|:---:|---|
| B1~B23 | `lib/be-rules.js` | 按 severity | 即时、证据化、可输出 SARIF/Markdown/JSON |
| J1 | ArchUnit | 是 | 分层依赖 |
| J2 | Checkstyle | 是 | 命名、Javadoc、import、规模 |
| J3 | PMD 7 | 是 | 缺陷、复杂度、性能 |
| J4 | SpotBugs | 是 | 字节码缺陷 |
| J5 | Spotless | 是 | 格式漂移 |
| J6 | P3C 2.1.1 / PMD 6 | 否 | 存量审计；与 PMD 7 隔离 |
| J7 | Knife4j/OpenAPI | 否 | 运行时文档能力，不是静态检查 |
| J8 | JaCoCo | 是 | Service/Controller 类级覆盖率 |

## 阻断覆盖

| 约定来源 | 规则 | 执行器 | 级别 | 阻断 |
|---|---|---|---|:---:|
| standards/02 | Controller 不得依赖 Mapper/Repository | J1 | error | 是 |
| standards/03/15 | 命名、import、Javadoc 和规模 | J2 | error | 是 |
| standards/04/11 | 接口缺权限或公开声明 | regex B1 | error | 是 |
| standards/05/10 | 写用例缺事务边界 | regex B5 | error | 是 |
| standards/06 | 可执行 SQL 使用 `SELECT *` | regex B3 | error | 是 |
| standards/06/11 | MyBatis 未登记文本替换 | regex B4 | error | 是 |
| standards/06/11 | SQL 缺租户谓词或验证过的统一拦截器 | regex B7 | error | 是 |
| standards/15/19 | 方法超过 80 行 | regex B10 / J3 | error | 是 |
| standards/15/19 | 圈复杂度超过 10 | regex B11 / J3 | error | 是 |
| standards/20 | Redis 无 TTL、自实现锁、危险命令 | regex B13~B15 | error | 是 |
| standards/21 | 物理删除或无 WHERE 写 | regex B17~B18 | error | 是 |
| standards/10/22 | 事务内 MQ/HTTP | regex B20 | error | 是 |
| standards/15/16/17 | 缺陷、资源、复杂度、性能 | J3 | error | 是 |
| standards/17 | 字节码缺陷 | J4 | error | 是 |
| standards/15 | 格式漂移 | J5 | error | 是 |
| standards/14 | Service/Controller 覆盖率红线 | J8 | error | 是 |

## 非阻断或人工判断

| 来源 | 规则 | 执行器 | 当前处理 |
|---|---|---|---|
| standards/04/13 | 缺 OpenAPI Operation | B2/J7 | warning + 契约核对 |
| standards/02 | 单目录文件超过 20 | B6 | warning |
| standards/08 | 抛裸通用异常 | B8 | warning |
| standards/19 | 类超过 500 行 | B9 | warning，需领域拆分判断 |
| standards/15/19 | 业务或接口方法缺 Javadoc | B12/J2 | warning/门禁组合 |
| standards/20/21 | Redis 序列化、超大批次 | B16/B19 | warning |
| standards/22 | HTTP 无超时、Swagger 混用、巨型 Service | B21~B23 | warning/error 按证据 |
| standards/03/15/16/17/19 | P3C 存量规则 | J6 | 单独执行、非阻断 |
| standards/07 | DTO/VO 业务字段边界 | Schema + 模板 + review | 业务语义仍需人工确认 |
| standards/09/10 | 敏感日志、事务内远程调用 | review | 静态工具不能完整证明语义安全 |
| standards/12 | DDL 可执行性与恢复策略 | contract + review | 生成但不执行，DBA/CD 卡口 |

## 自动修复边界

只有 B3/B5 标为 `safe-conditional`：满足安全前置条件才进入计划，否则降级人工。J5 可通过项目自己的 Spotless apply 格式化，但 `wl-skills-bd safe-fix` 不替业务工程自动执行它。其余规则不允许无确认批量修改。

## 维护规则

1. 新增阻断规范时，同一变更必须增加 catalog 规则、执行器和回归测试；
2. J6/J7 必须保留 `gate=false`，不得在文档中描述成默认硬门；
3. 规则严重度、修复级别和标题以 catalog 为准；
4. 每次发版执行 `npm run verify` 与 Java 8 的 `npm run verify:quality-maven`。

## 变更记录

- 2026-07-18 v0.8.0：同步 B1~B12 严重度、安全修复白名单和 J8 JaCoCo。
- 2026-07-18 v0.12.0：同步 B1~B23、完成度门和跨包契约校验。
- 2026-07-18 v0.13.0：任务路由复用 B1~B23 子集；路由只读，写入统一进入既有安全链。
- 2026-07-17 v0.6.0：补 B12 与设计级规则。
