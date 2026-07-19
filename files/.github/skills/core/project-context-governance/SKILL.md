---
name: project-context-governance
description: |
  大型后端工程模块目录与精准上下文治理。用于开发某一模块前建立或刷新该模块的服务、接口、数据库和关系快照，只加载一跳上下游快照，检查重复身份与过期上下文，并为代码生成提供有界 Context Plan。典型触发：模块上下文、查关联服务、生成前去重、刷新项目目录、避免全仓扫描、多人协作防污染。
status: ✅ 已落地
stage: ⓪ 生成前治理
---

# project-context-governance

本 Skill 先确定模块事实边界，再允许契约设计或代码生成。默认只扫描当前模块；关联模块只读一跳快照，绝不因快照缺失扩大全仓扫描。

## Pre-flight

```text
🚀 已触发 project-context-governance
✅ 已读取 standards/index.md 与 standards/27-project-catalog-context.md
✅ 已确认当前 module、任务描述和扫描预算
✅ 已确认 .wl-skills-bd/catalog.config.json 中的模块边界与一跳关系
```

## 执行

首次接入时从 `.wl-skills-bd/catalog.config.example.json` 复制为 `catalog.config.json`，按实际模块填写契约根、源码根、上下游与负责人。

```bash
# 默认路径：仅刷新当前模块
wl-skills-bd catalog plan --module <module>
wl-skills-bd catalog apply --module <module> --plan-hash <hash> --confirm
wl-skills-bd catalog check --module <module>

# 为本次任务选取有界上下文
wl-skills-bd context plan --module <module> --task "<任务>" --keywords "<关键词>" --json
```

只有 CI/初始化/全局治理任务可以显式执行 `catalog plan --full`。不得把 `--full` 当成本地默认，也不得手改自动生成的 Catalog 文档。

## 进入生成的门

以下条件同时满足才可进入 `codegen plan/apply`：

- 当前模块 Catalog 新鲜；
- 全局身份冲突为零；
- Context Plan 明确只扫描当前模块且关联源码扫描为 false；
- 关联快照缺失已经显式记录，不存在把未知事实猜成实现的行为；
- 代码生成计划已绑定 `catalogPreflight.contextHash`。

## 完成摘要

```text
✅ project-context-governance 完成
  - 当前模块 / 实际扫描根
  - 复用的一跳快照 / 缺失快照
  - 服务 / 接口 / 数据库对象 / 关系数量
  - 重复身份诊断
  - selectedFiles / selectedBytes / contextHash
  - 下一步：契约设计或 codegen plan
```
