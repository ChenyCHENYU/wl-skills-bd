# Agent Instructions — wl-skills-bd

完整规则见 `.github/copilot-instructions.md`；场景路由见 `.github/skills/_registry.md`，规范门控见 `.github/standards/index.md`。

## 强制约束

1. Java 8 / Spring Boot 2 / jh4j-cloud 3.1 / MyBatis-Plus；新代码使用 OpenAPI 3。
2. Controller → Service → Mapper，禁止 Controller 直调 Mapper。
3. 租户来自 AuthUtil；SQL 必须显式 COMPANY_ID，除非存在 doctor 可验证的统一拦截器证据。
4. 软删 1=有效/0=删除；更新使用 id/revision 乐观锁，详情返回 revision。
5. DDL、数据写入、权限发布和破坏性 API 变更必须展示差异并等待人工确认；MCP 不执行数据库写入。
6. codegen 使用机器契约，先 plan 后 apply；apply 必须携带相同 planHash 与显式确认。
7. 最终验证执行 B1~B23 与 `mvn verify -Pwl-quality`（J1~J5/J8）；J6/J7 不得冒充默认硬门。
8. 修复器只自动处理安全白名单 B3/B5，写后强制复扫；不得猜权限、SQL、租户、异常或业务文档。
9. 每个生成/修复步骤后运行对应验证；error 未清零不得宣称完成。
10. **Redis 操作（v0.10）**：必须带 TTL；分布式锁用 Redisson RLock（长任务 watchdog 自动续期）；禁用 KEYS \*/FLUSHDB/FLUSHALL；禁用 JdkSerializationRedisSerializer。
11. **敏感写（v0.10）**：业务代码禁物理删除/TRUNCATE/DROP；Mapper XML 的 update/delete 必带 WHERE；saveBatch ≤ 1000；批量更新大表按主键游标分批。
12. **生产护栏（v0.10/v0.11）**：生产环境 codegen/safe-fix/permissions apply 默认阻断；敏感操作须二次确认。
13. **稳定性（v0.11）**：事务内禁发 MQ/HTTP；HttpUtil/RestTemplate 必须超时；新代码用 OpenAPI 3（Swagger 2 存量允许保留，同类混用禁止）；Service 注入依赖 ≤ 10。
14. **多环境（v0.11）**：5 环境矩阵（dev/sit/uat/pre/prod）；5 级分支（master/pre/uat/slt/dev + dev-{模块}-{工号}）；业务中心×端口×数据库集群（cx/non_cx/pt）映射固化。
15. **独立协同（v0.12）**：bd 不依赖 design/kit；所有包遵循 `jh4j3-openapi3@1.0` 与 `wl-api-contract`。发布前双方 completion confirmed，执行 `contract diff --strict`。
16. **业务保护区（v0.12）**：export/relation/非确定性命令只在 `<wl-custom>` 区补实现和测试；不得删除或嵌套标记，保护区外漂移按冲突处理。
17. **任务路由（v0.13）**：`task` 只读；接口/字段/业务命令增量必须更新契约并走 codegen planHash/confirm/rollback，禁止字符串拼接式旁路 patch。

## 快速命令

```bash
wl-skills-bd doctor                        # 含环境体检（bootstrap/profile/dbcluster）
wl-skills-bd codegen validate wl-contract.json
wl-skills-bd codegen plan wl-contract.json --json
wl-skills-bd codegen apply wl-contract.json --plan-hash <hash> --confirm   # 可加 --require-complete
wl-skills-bd contract diff wl-contract.json --frontend <api.md> --openapi <openapi.json> --permissions <permissions.json> --strict
wl-skills-bd db preview wl-contract.json
wl-skills-bd permissions export wl-contract.json
wl-skills-bd validate . --strict           # B1~B23
```

MCP 提供 12 个等价工具；写工具的 confirm 只能在用户评审预览后传递。生产环境额外需要 `allowProductionWrites=true`。
