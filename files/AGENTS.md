# Agent Instructions — wl-skills-bd

完整规则见 `.github/copilot-instructions.md`；场景路由见 `.github/skills/_registry.md`，规范门控见 `.github/standards/index.md`。

## 强制约束

1. Java 8 / Spring Boot 2 / jh4j-cloud 3.1 / MyBatis-Plus；新代码使用 OpenAPI 3。
2. Controller → Service → Mapper，禁止 Controller 直调 Mapper。
3. 租户来自 AuthUtil；SQL 必须显式 COMPANY_ID，除非存在 doctor 可验证的统一拦截器证据。
4. 软删列和值以“受管 profile + 未受管 profile.local”合并结果为唯一事实源（默认 1=有效/0=删除）；禁止直接编辑 `profiles/*.json`。Entity、Service、Mapper、DDL、rules.local 与 MyBatis-Plus 运行值必须一致。受管更新/软删使用 `ID + COMPANY_ID + 有效标记 + REVISION` 显式原子 SQL，详情返回 revision。
5. DDL、数据写入、权限发布和破坏性 API 变更必须展示差异并等待人工确认；MCP 不执行数据库写入。
6. codegen 使用机器契约，先 plan 后 apply；apply 必须携带相同 planHash 与显式确认。
7. 最终验证执行 B1~B25 与 `mvn verify -Pwl-quality`（J1~J5/J8）；J6/J7 不得冒充默认硬门。
8. 生产契约必须满足 standards/28：SLO/RTO/RPO、安全、数据治理、一致性、韧性与六类证据缺一不可；外部评审不得由工具伪造。
8. 修复器只自动处理安全白名单 B3/B5，写后强制复扫；不得猜权限、SQL、租户、异常或业务文档。
9. 每个生成/修复步骤后运行对应验证；error 未清零不得宣称完成。
10. **Redis 操作（v0.10）**：必须带 TTL；分布式锁用 Redisson RLock（长任务 watchdog 自动续期）；禁用 KEYS \*/FLUSHDB/FLUSHALL；禁用 JdkSerializationRedisSerializer。
11. **敏感写（v0.10）**：业务代码禁物理删除/TRUNCATE/DROP；Mapper XML 的 update/delete 必带 WHERE；saveBatch ≤ 1000；批量更新大表按主键游标分批。
12. **受保护环境护栏（v0.14）**：pre/prod/production 的 codegen/safe-fix/config/permissions apply 默认阻断；所有工程写入必须 preview→planHash→confirm→原子写→复验→可回滚。
13. **稳定性（v0.11）**：事务内禁发 MQ/HTTP；HttpUtil/RestTemplate 必须超时；新代码用 OpenAPI 3（Swagger 2 存量允许保留，同类混用禁止）；Service 注入依赖 ≤ 10。
14. **多环境（v0.11/v0.14）**：5 环境矩阵（dev/sit/uat/pre/prod）；业务中心×端口×数据库集群（cx/non_cx/pt）映射固化。分支与合并链由团队单独管控，bd 不介入。
15. **独立协同（v0.12）**：bd 不依赖 design/kit；所有包遵循 `jh4j3-openapi3@1.0` 与 `wl-api-contract`。发布前双方 completion confirmed，执行 `contract diff --strict`。
16. **业务保护区（v0.12）**：export/relation/非确定性命令只在 `<wl-custom>` 区补实现和测试；不得删除或嵌套标记，保护区外漂移按冲突处理。
17. **任务路由（v0.13）**：`task` 只读；接口/字段/业务命令增量必须更新契约并走 codegen planHash/confirm/rollback，禁止字符串拼接式旁路 patch。
18. **数据库变更（v0.14）**：ALTER 必须分 expand/contract；contract drop 需 approvalRef；Flyway 版本不可变，校验 SQL 只允许无副作用 SELECT，工具永不执行数据库写入。
19. **模块上下文（v0.15）**：启用 Catalog 后，默认只扫描当前模块；关联模块只读一跳快照和关系/关键词命中的契约，不扫描其源码目录。当前目录过期、全局身份冲突或 codegen 上下文哈希漂移时必须阻断。

## 快速命令

```bash
wl-skills-bd doctor                        # 含环境体检（bootstrap/profile/dbcluster）
wl-skills-bd catalog check --module <module>
wl-skills-bd context plan --module <module> --task "<任务>" --json
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm   # 可加 --require-complete
wl-skills-bd contract diff wl-contract.json --frontend <api.md> --openapi <openapi.json> --permissions <permissions.json> --strict
wl-skills-bd db preview wl-contract.json
wl-skills-bd permissions export wl-contract.json
wl-skills-bd validate . --strict           # B1~B25
wl-skills-bd test gen wl-contract.json    # 行为契约测试（测行为不测镜像）
wl-skills-bd test scenarios wl-contract.json
```

MCP 提供 16 个等价工具；写工具的 confirm 只能在用户评审预览后传递。pre/prod/production 额外需要 `allowProductionWrites=true`。
