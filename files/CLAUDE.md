# Claude Code Instructions — wl-skills-bd

先读取 `.github/copilot-instructions.md`。按 `.github/skills/_registry.md` 选择 Skill，并按 `.github/standards/index.md` 懒加载本次必要规范。

核心流程：已评审需求/可选上游契约 → `wl-contract.json` → codegen plan → 用户评审 planHash → apply → `wl-api-contract` strict diff → B1~B23 → `mvn verify -Pwl-quality`。design/kit 都不是 bd 的硬依赖。

禁止：Controller 直调 Mapper、请求传 companyId、遗漏租户谓词、物理删除替代团队软删、UpdateDTO 无 revision、详情不返回 revision、自动执行 DDL/数据写、猜权限码、盲改 `${}`、未经确认调用 MCP 写工具。

自动修复仅限满足严格前置条件的 B3/B5；其他问题提供证据和人工方案。所有修复后必须复扫。

详细流程：

- `.github/guides/codegen-workflow.md`
- `.github/guides/frontend-backend-contract.md`
- `.github/guides/mcp-workflow.md`
- `.github/skills/_pipeline.md`
