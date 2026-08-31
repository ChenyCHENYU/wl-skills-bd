---
name: integration-adapter-be
description: |
  将项目或平台已有的 MQ/HTTP/集成封装接入机器契约、质量门和受控实现链。
  适用于“接入 MQ”“适配平台消息封装”“检查 Producer/Consumer 接线”“集成质量门”；不替平台选择 SDK、Topic、ACK 或幂等语义。
metadata:
  status: "✅ 已落地"
  stage: "⑦ 集成适配"
  risk: "🟡 中风险（项目模板只新增文件）"
---

# integration-adapter-be

目标是验证并衔接项目真实封装，不建立第二套 MQ SDK 或平台规范。

## Pre-flight

```text
🚀 已触发 integration-adapter-be
✅ 已读取 standards/22-resilience.md 与 standards/30-change-review-integration-adapter.md
✅ 已确认项目维护的 integration-adapters.json 和目标 binding
✅ 已区分环境可用、内部 Inbox/Outbox、实际 Transport 和运行证据
⚠️ 未配置适配描述符时只报告 not-configured，不猜平台 API
```

## 只读检查

```bash
wl-skills-bd integration adapters --module <module> --json
wl-skills-bd review run --base origin/main --module <module> --json
wl-skills-bd review run --module <module> --json
```

按项目描述符核对契约 integrationId、依赖、配置、Producer/Consumer、测试及项目要求的能力标记，输出 `declared → dependency → configured → wired → tested → runtime-evidenced` 成熟度。

## 受控实现

只有描述符提供项目内模板和 recipe 时才能生成：

```bash
wl-skills-bd integration plan --binding <id> --recipe <id> --var className=X --json
wl-skills-bd integration apply --binding <id> --recipe <id> --var className=X \
  --plan-hash <hash> --confirm
```

实现层只新增文件；目标已存在、变量缺失、模板越界、计划漂移或受保护环境未授权时零写入。生成后重新执行适配检查和项目编译/测试；业务 Handler、Topic、Group、消息字段与幂等算法仍由评审契约提供。

## 完成条件

- 描述符和 binding 通过机器校验；
- 项目要求的阶段/能力均有精确证据；
- 生成文件来自项目模板且未覆盖存量实现；
- 增量 review 明确标记 partial，交付前 full review、Maven 测试和运行证据如实记录；
- 不把“环境存在 MQ”写成“模块已接入”。
