---
name: wl-skills-bd
description: Java 后端开发、接口和字段变更、修复审计、测试生成、MQ/HTTP 集成、模块上下文、业务文档和数据环境安全的 WL 后端任务入口；每次相关任务先判定路由及规则覆盖。
---

# WL 后端任务入口

此入口仅帮助宿主发现本包；业务约束以项目 `.wl-skills-bd/capabilities.json`、`.github/skills/_registry.md` 和所选 canonical `SKILL.md` 为准，按需读取，避免复制业务规则。

1. 每次任务先执行 `wl-skills-bd task --input "<完整任务>" --target . --json` 或 MCP `wls_be_task`，记录实际返回的 `runId`、判定、候选、适用规则和未验证项。
2. `matched` 或 `baseline` 只代表任务判定，按返回路径读取 canonical Skill 和标准。`ambiguous` 先消除意图歧义，`gap` 明示缺口并保留规则建议，`not-applicable` 表示本包不适用。
3. task 只生成计划，文件哈希仅证明文件快照；模型对读取或执行的陈述标为“模型声明”。所有代码/配置写入继续使用已有 planHash、确认与回滚链。
4. 执行 `validate --run-id <runId> --json` 或 MCP `wls_be_validate` 获取真实检查回执；Java/Maven 门和运行验证必须另有实际证据。用 `status --run-id <runId> --json` 核对检查覆盖与新鲜度，用 `doctor --host codex --json` 检查入口可用性。

同一用户任务跨已安装且适用的包复用同一 `--run-id <id>` 或 `WL_TASK_RUN_ID`；本包仍可独立使用，无需安装其他 WL 包。
