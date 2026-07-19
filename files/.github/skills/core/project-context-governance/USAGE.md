<!--
document-meta:
  purpose: 提供 project-context-governance 的最小接入顺序、常见场景与边界说明
  audience: backend-developers-and-ai-agents
  source-of-truth: standards/27-project-catalog-context.md
  maintained-by: wl-skills-bd
-->

# project-context-governance 使用说明

## 开发一个模块

```bash
wl-skills-bd catalog check --module order
wl-skills-bd context plan --module order --task "增加订单取消接口" --keywords "状态机,退款" --json
```

如果目录过期，只刷新 `order`：

```bash
wl-skills-bd catalog plan --module order
wl-skills-bd catalog apply --module order --plan-hash <hash> --confirm
```

输出中的 `scannedModules` 应只有 `order`。`customer`、`billing` 等关系模块只能出现在 `loadedSnapshotModules`，并且 `linkedSourceDirectoriesScanned` 必须为 `false`。

`selection.files` 的规则：

- 当前模块 Catalog 和模块文档始终是事实入口；
- 当前模块源码按任务关键词和契约身份排序；
- 关联模块整份目录和文档不进入选择结果；
- 只有契约关系或任务关键词命中的关联契约可以进入结果。

## 首次建立项目目录

首次可以由治理流水线显式执行一次 `catalog plan --full`，也可以由各模块负责人分别刷新自己的模块。之后日常开发全部使用模块模式，不为“保险”重复全量扫描。

## 快照缺失

工具只告警，不扫描对方源码。需要对方负责人刷新快照，或在当前任务中明确把缺失关系作为待确认项；不能用猜测补全对方接口或表结构。

## 常见问题

- Catalog 文档能手改吗？不能；它带 `editable: false` 注释头，事实应在契约或配置修正。
- 为什么生成前被阻断？当前模块源码哈希与快照不一致，或存在全局 API、权限、服务、表写、迁移版本冲突。
- 能加载两跳依赖吗？不能。两跳容易把无关模块带入上下文；需要更远事实时，应显式转为新的目标模块/任务。
- 其他模块刚刷新，为什么当前 codegen 没失效？只有与当前契约相关的关联切片哈希进入生成计划，无关资源变化不会制造计划漂移。
