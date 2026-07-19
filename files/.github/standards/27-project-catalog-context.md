<!--
document-meta:
  purpose: 规定大型后端工程的模块目录、关系快照、精准上下文和生成前置门禁
  audience: backend-developers-ai-agents-and-maintainers
  source-of-truth: .wl-skills-bd/catalog.config.json
  maintained-by: wl-skills-bd
-->

# 27 · 项目目录与精准上下文规范

## 1. 目标与边界

Catalog 负责回答“有多少模块、服务、接口、数据库对象，谁拥有它们、如何关联、是否重复”。它不是第二份源码，也不要求每次读取全仓。

默认开发模式必须指定当前模块。只有显式的 CI/治理任务才允许 `--full`。任何工具不得因为关联快照缺失而偷偷回退为全仓源码扫描。

## 2. 三层事实

| 层 | 位置 | 责任 |
|---|---|---|
| 配置 | `.wl-skills-bd/catalog.config.json` | 模块边界、契约根、源码根、上游、下游、负责人、提交策略 |
| 机器快照 | `.wl-skills-bd/catalog/modules/*.json` | 模块资源、服务、接口、库表、关系、源码证据与哈希 |
| 人读文档 | `docs/backend/modules/*.md` | 当前模块事实入口；带用途、受众、范围、来源、哈希和不可手改注释头 |

项目级 `project-catalog.json` 与 `docs/backend/INDEX.md` 只汇总模块快照，不重扫模块源码。人读文档由工具生成，修改事实应回到契约或配置。

## 3. 模块增量刷新

```bash
wl-skills-bd catalog plan --module order
wl-skills-bd catalog apply --module order --plan-hash <hash> --confirm
wl-skills-bd catalog check --module order
```

模块模式只遍历当前模块配置的 `contractRoots` 与 `sourceRoots`；其他模块只读取固定快照文件。计划包含扫描模块、复用模块、缺失快照、操作哈希和 `planHash`。确认前重新计划；发生漂移、冲突或写入失败时整批零写入/回滚。

```bash
# 仅限 CI、初始化或全局治理
wl-skills-bd catalog plan --full
```

## 4. 一跳上下文

```bash
wl-skills-bd context plan --module order --task "增加订单创建接口" --keywords "幂等,客户" --json
```

上下文选择规则：

1. 当前模块目录 JSON 与模块文档是事实入口。
2. 当前模块源码按任务关键词、契约和资源身份排序，在文件数/字节预算内选择。
3. 最多加载显式登记的一跳上游/下游快照。
4. 关联模块不遍历源码目录；只有关系命中的契约文件可进入候选。
5. 输出必须声明 `scannedModules`、`loadedSnapshotModules`、`linkedSourceDirectoriesScanned=false` 和 `contextHash`。
6. 当前模块目录过期时阻断生成，先刷新当前模块；关联快照缺失只告警，不扩大扫描范围。

默认预算为 40 个文件、512 KiB、1 跳，可在安全上限内收紧。禁止为了“保险”把 `maxHops` 扩大到 2 以上。

## 5. 去重与污染阻断

以下身份在已有快照范围内必须唯一：契约 ID、Service/Controller/Mapper 全限定名、HTTP method+外部路径、权限码、库集群+引擎+表写归属、迁移位置+版本。冲突会阻断 Catalog apply 与后续代码生成。

新代码生成前还必须通过当前模块目录新鲜度检查，并把 Catalog 上下文哈希纳入 codegen `planHash`。这样快照变化会使旧计划失效，避免拿过期上下文写入。

## 6. 协作约定

- 模块负责人维护本模块契约、源码与关系声明，不直接修改其他模块快照。
- 调用方依赖上游公开契约，不复制对方 Controller、Service、Mapper 或表写逻辑。
- 关系发生变化时先更新配置/契约并刷新相关模块，再生成代码。
- 项目 Catalog 支持 kit/design 等包提供可选输入，但 bd 独立使用成熟需求文档时也必须能闭环；不把上游包产物设为硬依赖。

## 变更记录

- 2026-07-19 v1：新增模块增量目录、一跳快照上下文、预算选择、全局身份冲突和 codegen 前置门禁。
