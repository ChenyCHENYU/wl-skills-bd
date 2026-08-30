# Claude Code Instructions — wl-skills-bd

先读取 `.github/copilot-instructions.md`。按 `.github/skills/_registry.md` 选择 Skill，并按 `.github/standards/index.md` 懒加载本次必要规范。

核心流程：已评审需求/数据库设计 → `docs/db-spec` → `wl-contract.json` → codegen plan → 用户评审 planHash → apply → `wl-api-contract` strict diff → B1~B31 → `mvn verify -Pwl-quality`。数据库表必须优先复用文档基线，扩展有依据且字段末尾追加（standards/29）。生产契约还必须满足 standards/28 的证据链；design/kit 都不是 bd 的硬依赖。

存量契约先 `contract inspect` 分流；只有 crud 可 codegen。字段变更先用限定模块的 `impact field` 核对容量、所有权、迁移链和源码证据；跨系统集成用 `integration inspect/audit` 校验逻辑 ID、载荷版本、重试/确认/死信/重放与错误码，不靠全仓阅读或主观推断。

禁止：Controller 直调 Mapper、请求传 companyId、遗漏租户谓词、物理删除替代团队软删、UpdateDTO 无 revision、详情不返回 revision、自动执行 DDL/数据写、猜权限码、盲改 `${}`、未经确认调用 MCP 写工具。

自动修复仅限满足严格前置条件的 B3/B5；其他问题提供证据和人工方案。所有修复后必须复扫。

精准规则必须在扫描前短路并保留 execution/coverage；quick/staged 是 partial。MCP 默认 summary 与有界 response，超预算用 cursor 续取。任务按标准 Pipeline 编排，写节点必须确认且不得自动重试。

详细流程：

- `.github/guides/codegen-workflow.md`
- `.github/guides/frontend-backend-contract.md`
- `.github/guides/mcp-workflow.md`
- `.github/skills/_pipeline.md`
