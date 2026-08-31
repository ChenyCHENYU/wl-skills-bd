# 规则 → 执行器覆盖矩阵

> 机器单一数据源是 `files/.wl-skills-bd/rules/catalog.json`。本文件解释覆盖关系；`lint-skills` 会校验阻断约定必须存在确定性执行器。

## 执行器

| 编号 | 实现 | 默认门禁 | 说明 |
|---|---|:---:|---|
| B1~B31 | `lib/be-rule-plan.js` + `scan-context.js` + `be-rules.js` | 按 severity | 规则前置短路、最小文件读取、执行/缓存证据、Controller 端点及 SARIF/Markdown/JSON；B31 复用两级缓存 Source Index |
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
| standards/11/28 | 使用 `@PreAuthorize` 但未启用方法安全 | regex B24 | error | 是 |
| standards/09/11/28 | 敏感字段进入 Lombok `toString` | regex B25 | error | 是 |
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
| standards/12 | DDL 可执行性与恢复策略 | contract + Source Index + db-drift | 生成但不执行；缺表/缺列/无源变更由离线对账阻断，DBA/CD 仍是执行卡口 |
| standards/28 | SLO、恢复、威胁模型、授权、压测、运行手册和数据评审 | assurance contract + evidence refs + external review | 缺声明/文件阻断完成；证据真实性由安全/DBA/SRE/业务评审 |
| standards/30 | 新增/历史问题、平台接线、通用边界与供应链 | review + project policy executors | 项目显式策略决定阻断；未配置不激活，partial 不冒充 full |

## 项目策略门

| 配置 | 确定性执行器 | 无配置行为 | 写入边界 |
|---|---|---|---|
| `quality-gate.json` | `quality-gate.js` / `review.js` | 使用 new-only、完整规则覆盖基线 | baseline 必须 planHash/确认/事务写 |
| `integration-adapters.json` | `integration-adapter.js` | `not-configured`，不猜 SDK、不产生 findings | 只按项目 recipe 新建文件，不覆盖现有封装 |
| `quality-assertions.json` | `policy-assertions.js` | 不激活项目断言 | 仅 evidenceRefs 内单次字面替换，复验失败回滚 |
| `supply-chain.json` | `supply-chain.js` | 只输出 POM 事实清单，不阻断 | 只读，不自动升级依赖/BOM/仓库 |

## 自动修复边界

内置只有 B3/B5 标为 `safe-conditional`：满足安全前置条件才进入计划，否则降级人工。项目断言可声明精确 `safeReplacement`，但目标必须在 evidenceRefs 内且 before 恰好出现一次；0 次/多次匹配、写前漂移或复验失败均不保留修改。J5 可通过项目自己的 Spotless apply 格式化，但 `wl-skills-bd safe-fix` 不替业务工程自动执行它。其余规则不允许无确认批量修改。

## 维护规则

1. 新增阻断规范时，同一变更必须增加 catalog 规则、执行器和回归测试；
2. J6/J7 必须保留 `gate=false`，不得在文档中描述成默认硬门；
3. 规则严重度、修复级别和标题以 catalog 为准；
4. 每次发版执行 `npm run verify` 与 Java 8 的 `npm run verify:quality-maven`。
5. `npm run eval:quality` 必须阻断 precision/recall、P95、规则短路比例、MCP/Catalog/Review 摘要 token/字节预算回退。

## 变更记录

- 2026-07-18 v0.8.0：同步 B1~B12 严重度、安全修复白名单和 J8 JaCoCo。
- 2026-07-18 v0.12.0：同步 B1~B23、完成度门和跨包契约校验。
- 2026-07-18 v0.13.0：任务路由复用 B1~B23 子集；路由只读，写入统一进入既有安全链。
- 2026-07-19 v0.17.0：同步 B24/B25、production assurance 证据门和实际生成源码质量门。
- 2026-08-24 v0.21.0：加入规则前置执行计划、共享 ScanContext、两级缓存与准确率/性能/token 回退门禁。
- 2026-08-31 v0.23.0：加入契约分类、字段影响、集成闭环与 Catalog 摘要/token 回退门禁。
- 2026-08-31 v0.24.0：加入变更审查、项目平台适配、显式边界/供应链策略与分级精确修复。
- 2026-07-17 v0.6.0：补 B12 与设计级规则。
