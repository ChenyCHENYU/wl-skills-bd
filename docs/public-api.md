# BD 公开 API 与执行边界

本包是独立的 Java 后端工具包。harness 或客户端可通过公开协议调度，退出宿主后仍可直接使用原 CLI/MCP 与同一项目回执。安装、路由、工具调用与业务验证是不同证据，不能互相替代。

## 完整公开面

| 入口 | 兼容性审查对象 | 验证方式与限制 |
|---|---|---|
| `wl-skills-bd` CLI | 已有子命令、合法选项、退出码、JSON 结果、计划确认流程 | 原 CLI 回归、真实 codegen/生命周期夹具；不把新协议覆盖当作所有命令验收 |
| `protocol describe/request` | 协议 v1 信封、动态 Schema、能力与执行器声明、错误语义 | 五个原操作保持兼容，追加 `execute` 和 `executor-invoke-v1`；外部只消费公开结果 |
| 18 个 MCP 工具 | 名称、参数、只读/确认声明、响应预算与游标 | 注册表与 MCP 回归；宿主是否加载、模型是否读取需宿主事件 |
| npm `main:lib/index.js` | 35 个现有命名空间及其导出函数/常量 | 本轮保留全部；完整函数签名与下游调用兼容矩阵仍需单独维护，协议测试不能证明这些全部稳定 |
| 项目资产与数据 | manifest 所有权、旧版正常 update、delivery profile、契约 Schema、生成区域、确认哈希 | 使用隔离存量迁移/冲突/备份回滚/生成正反例；不重置项目配置或认领外来内容 |
| 技能与规范 | Skill 标识、安装路径、读取顺序、规则编号、项目适用范围 | 目录/语料/规则样例审查；业务事实不足必须 gap |

`lib/index.js` 的命名空间为：beRules、codegen、collaboration、commitPolicy、configDoctor、configFix、permissionExport、configInit、configLayering、configProbe、contract、contractCompat、deterministic、doctor、envMatrix、installer、impactAnalysis、integrationAdapter、integrationContract、manifest、projectCatalog、qualityGate、repair、review、reporters、safeFix、supplyChain、taskRouter、taskRuntime、taskObservability、pipeline、policyAssertions、contextPlanner、templateEngine、troubleshoot。已有消费者不应被悄悄移到私有路径；新宿主应优先使用 CLI/MCP 或公开协议。

CLI 命令/别名/参数/副作用和分发 descriptor 共用 `lib/cli-catalog.js`，帮助与公开目录从其生成；新增入口缺少真实 handler 即失败。MCP 的 handler、完整输入 Schema、模式副作用共用真实注册表；`tools/list` 用 `annotations.readOnlyHint` 和 `_meta["wl/sideEffects"]` 暴露，公开协议与安装快照引用同一事实。`recorded` 指本包 runs 记录写入，不能当作项目完全零写入；`gated` 表示可能存在经确认的资产写入，不代表所有调用都写入。目录和 MCP 提示均不授予执行或写入权限。

## 执行所有权

`lib/executors.json` 发布本包允许的只读检查器与完整参数 Schema，`lib/executor-invoke.js` 保存本包 CLI 参数及范围语义。共用辅助层负责协议校验、真实 status 准入、路径边界与子进程生命周期；共用层不定义 BD 的业务规则或 CLI 旗标。宿主不得导入包的私有库，也不复制 `validate --rules` 或 `review run` 的拼接表。

| executorId | parameters | 原执行器与范围 |
|---|---|---|
| `validate` | `targets`（恰好一个路径）、可选 `rules`（B 规则子集） | 原 `validate`；文件/目录在该任务目标内检查，省略 rules 使用计划的 B 规则子集，不默认扫全规则 |
| `review-run` | `targets:["."]` | 需真实任务选中 `convention-audit-be`；原 `review run` 的 B 检查遵守任务子集，仅支持项目根，文件级请求以 `unsupported-executor-range` 拒绝且不启动子进程 |

请求必须明确提供 `operation:"execute"`、`projectRoot`、`runId`、`executorId`、`parameters`。先建立同包同 runId 的真实任务计划，目标与计划一致；解释/计划/禁止检查的任务不通过执行准入。请求文件宜存于项目外，避免其写入改变根目录检查任务的输入快照。

返回结构是原 `status` 加 `executorId`、`execution` 和公开 `integration`。`execution.exitCode` 是原工具退出码：非零业务检查结果仍是完成调用，信封可为 `ok:true`；是否失败、partial、过期，以及哪些文件被检查，以原 status 和实际工具回执为准。启动失败、输出预算超限和不合法准入是协议错误。收到 SIGTERM/SIGINT 立即终止执行器进程树；仅对本次调用中新产生且没有完成回执的真实开始记录，补执行失败、验证未验证的中断终态，checks/checkedFiles 均为空，不能伪造业务结果，也不更改本次调用前已有的开始记录。

## 持续演进

- 新增同一检查器支持的规则或 Skill，更新本包规则/目录/语料与 describe，宿主通过描述发现能力；不在宿主另加 B 规则清单。
- 新增执行器，需在本包同时发布 Schema、授权/副作用声明和执行实现，并验证原 CLI 与公开入口同义；不能只登记目录后宣称可用。
- 改变原 CLI 旗标，在本包修执行映射与旧 CLI 兼容测试；宿主仍发送相同结构化执行请求。
- 不兼容的 Schema、授权或公开 API 变化，必须明确版本边界；未知 Schema、目录加载错误与不支持的执行器应拒绝，不能猜参数或降级成宽泛扫描。

## 成熟度的实际限制

当前已验证生成 Profile 仍只有 `jh4j3-openapi3`（Java 8 / Spring Boot 2 / jh4j-cloud 3.1）。本包能力清单明确 11 项 implemented、1 项 partial、1 项 skeleton；复杂数据库迁移/回填与业务提取缺口不因协议统一而消失。生成、契约安全、生命周期、原 CLI/MCP 与真实 Maven 质量门各自保留验收。语义准确性、线上平台衔接、真实 IDE/模型读取及完整 npm JavaScript API 消费者兼容性仍需独立证据。

进入 1.x 应围绕这些完整公开面承诺兼容性与限制，不能以协议验收或测试数量代替全包成熟度判断。
