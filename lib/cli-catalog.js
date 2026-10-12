"use strict";

/**
 * CLI 公共目录与分发描述单源。这里只描述已有入口；任务判定、业务校验和写入授权
 * 仍由对应 command 函数执行。新增命令必须声明实际 handler、参数和副作用。
 */
const TARGET_JSON = "[--target <dir>] [--json]";
const CONFIRM = "[--plan-hash <hash> --confirm] [--allow-production-writes]";

function command(name, handler, args, summary, write, sideEffects, extra = {}) {
  return Object.freeze({ name, handler, args, summary, execution: "programmatic", write, sideEffects, ...extra });
}

const COMMAND_CATALOG = Object.freeze([
  command("init", "commandInstall", `${TARGET_JSON} [--dry-run] [--force] ${CONFIRM}`, "预览安装受管资产；确认计划后写入", "gated", "确认后写受管文件、manifest 和备份；默认只预览", { passCommand: true }),
  command("update", "commandInstall", `${TARGET_JSON} [--dry-run] [--force] ${CONFIRM}`, "按 manifest 增量升级并保护本地修改", "gated", "确认后事务化更新受管文件；冲突默认零写入", { passCommand: true }),
  command("diff", "commandInstall", TARGET_JSON, "查看包内容、manifest 与当前项目差异", "readonly", "无写入", { passCommand: true }),
  command("clean", "commandClean", `${TARGET_JSON} [--dry-run] ${CONFIRM}`, "预览卸载未被修改的受管文件", "gated", "确认后删除本包未修改受管文件；保留修改和备份"),
  command("check", "commandCheck", TARGET_JSON, "检查 manifest 和安装漂移", "readonly", "无写入；不执行 Maven 质量门"),
  command("validate", "commandValidate", `[path] ${TARGET_JSON} [--rules <B1,B2>] [--run-id <id>] [--strict] [--quick] [--staged] [--format <text|json|sarif|markdown>] [--output <file>]`, "执行 B1~B32 规则、端点及数据库事实源审计", "recorded", "写本包 runs 校验回执；--output 可写项目内报告；不修改业务源码"),
  command("doctor", "commandDoctor", `${TARGET_JSON} [--host <name>]`, "环境/JDK/质量门/租户/契约/配置体检；--host 为宿主诊断", "readonly", "无写入"),
  command("codegen", "commandCodegen", `<validate|plan|apply> <contract-file> ${TARGET_JSON} [--force] [--questions-reviewed] [--require-complete] [--plan-hash <hash> --confirm]`, "契约驱动代码生成与业务疑点核对", "gated", "validate/plan 只读；apply 按 planHash 确认写生成源码与清单"),
  command("contract", "commandContract", `<seed|inspect|migrate|show|diff> [contract-file] ${TARGET_JSON} [--table <table>] [--database <type>] [--profile <id>] [--root-package <package>] [--module <id>] [--entity <name>] [--contract-id <id>] [--format <json|markdown>] [--output <file>] [--frontend <file>] [--openapi <file>] [--permissions <file>] [--kit-api-md <file>] [--strict] [--allow-unresolved] ${CONFIRM}`, "契约种子、校验、迁移、展示及协作差异核对", "gated", "seed/inspect/diff 默认只读；migrate 确认后写契约；show --output 写项目内文件"),
  command("db", "commandDb", `<preview|review|drift|executed|ledger|snapshot-template> [contract-file] ${TARGET_JSON} [--snapshot <file>] [--database <type>] [--prefix <table-prefix>] [--output <file>] [--table <table>] [--column <column>] [--ddl-plan-hash <hash>] [--migration-hash <hash>] [--approval-ref <ref>] [--source-ref <ref>] [--executed-at <ISO>] [--expires-at <ISO>] [--by <name>] [--note <text>] ${CONFIRM}`, "DDL 预览、字段三方对账、漂移与执行台账", "gated", "不执行 DDL；--output 可写报告；executed 确认后写执行台账"),
  command("permissions", "commandPermissions", `export <contract-file> ${TARGET_JSON} [--output <file>] ${CONFIRM}`, "导出 kit SYS_PERMISSION_INFO 权限码片段", "gated", "默认预览；确认后写项目内输出文件"),
  command("catalog", "commandCatalog", `<plan|apply|show|check|rules> ${TARGET_JSON} [--module <id>] [--section <name>] [--limit <n>] [--cursor <n>] [--full] ${CONFIRM}`, "模块目录与规则注册完整性核对", "gated", "plan/show/check/rules 只读；apply 确认后写目录快照"),
  command("context", "commandContext", `plan ${TARGET_JSON} [--module <id>] [--task <text>] [--keywords <text>] [--max-files <n>] [--max-bytes <n>] [--max-tokens <n>] [--max-hops <n>]`, "精准上下文：当前模块及一跳快照", "readonly", "无写入；不扫描关联模块源码"),
  command("impact", "commandImpact", `field --module <id> --field <name> ${TARGET_JSON} [--table <table>] [--limit <n>] [--cursor <n>]`, "字段影响：契约、存储、迁移与源码证据", "readonly", "无写入"),
  command("integration", "commandIntegration", `<inspect|audit|adapters|plan|apply> [contract-file] ${TARGET_JSON} [--module <id>] [--binding <id>] [--recipe <id>] [--var <key=value>] ${CONFIRM}`, "业务集成治理与平台适配器计划", "gated", "inspect/audit/adapters/plan 只读；apply 确认后写适配源码；不是宿主协议入口"),
  command("review", "commandReview", `<run|baseline [plan|apply]> ${TARGET_JSON} [--base <ref>] [--module <id>] [--rules <B1,B2>] [--run-id <id>] [--staged] [--quick] [--limit <n>] ${CONFIRM}`, "变更审查及受控基线登记", "gated", "run 写校验回执但不改源码；baseline plan 只读、apply 确认后写基线"),
  command("commit", "commandCommit", `<validate|check|doctor> ${TARGET_JSON} [--file <file>] [--message <text>] [--range <git-range>]`, "提交消息、提交范围及本地钩子诊断", "readonly", "无写入"),
  command("fix", "commandFix", `<advise|plan|apply|policy [plan|apply]> [path] ${TARGET_JSON} [--rules <B1,B2>] [--module <id>] [--assertions <ids>] ${CONFIRM}`, "分级修复建议、计划与确定性写链", "gated", "advise/plan 只读；apply 确认后写白名单修复并复扫"),
  command("config", "commandConfig", `<init|migrate|doctor|fix> ${TARGET_JSON} [--project <name>] [--module <id>] [--port <n>] [--datasource-type <oracle|mysql>] [--db-cluster <cx|non_cx|pt>] [--customer <name>] [--overwrite] [--to <customer>] [--from <customer>] [--plan|--apply] [--dry-run] [--probe] [--probe-timeout <ms>] ${CONFIRM}`, "配置分层、环境迁移、体检与安全修复", "gated", "init/migrate/fix 默认预览、确认后写配置；doctor 默认只读，--probe 额外探测 DB/Redis/Nacos TCP"),
  command("troubleshoot", "commandTroubleshoot", `"<keyword>" | --list`, "错误关键字到诊断步骤", "readonly", "无写入"),
  command("task", "commandTask", `["<task>" | --input <task> | --type <id>] ${TARGET_JSON} [--target-file <file>] [--run-id <id>] [--list]`, "判定并持久化 Skill/规则计划；--list 只读", "recorded", "task 写本包 runs 计划/preflight；尚未执行业务动作；--list 不记录"),
  command("route", "commandTask", `["<task>" | --input <task> | --type <id>] ${TARGET_JSON} [--target-file <file>] [--run-id <id>] [--list]`, "只读任务判定与计划说明", "readonly", "无写入；不记录 run", { trailingArguments: [false] }),
  command("explain", "commandTask", `["<task>" | --input <task> | --type <id>] ${TARGET_JSON} [--target-file <file>] [--run-id <id>] [--list]`, "只读解释判定、候选和未验证项", "readonly", "无写入；不记录 run", { trailingArguments: [false] }),
  command("status", "commandStatus", `${TARGET_JSON} [--run-id <id>]`, "读取本包任务回执、检查结果与新鲜度", "readonly", "无写入"),
  command("doctor-host", "commandDoctor", `${TARGET_JSON} [--host <name>]`, "静态宿主入口诊断；不证明宿主已加载", "readonly", "无写入", { trailingArguments: [true] }),
  command("test", "commandTest", `<gen|scenarios> <contract-file> ${TARGET_JSON} [--output <file>] ${CONFIRM}`, "行为契约测试生成及场景清单", "gated", "默认输出内容；gen --output 确认后写测试文件"),
  command("capabilities", "commandCapabilities", `[--section <name>] [--json]`, "输出技能、MCP 与同源 CLI 能力清单", "readonly", "无写入"),
  command("protocol", "commandProtocol", `describe --json | request --input-file <request.json> --json`, "公开集成协议：能力目录、任务及受控 execute", "operation-defined", "describe 只读；request 按所选操作公开 sideEffects 执行", { rawArguments: true }),
  command("mcp", "commandMcp", "", "启动 stdio MCP Server", "launcher", "启动服务；实际工具写入遵循各工具声明"),
  command("help", "help", "", "输出帮助和参数说明", "readonly", "无写入", { aliases: ["--help", "-h"], rawArguments: true }),
  command("version", "commandVersion", "", "输出包版本", "readonly", "无写入", { aliases: ["--version", "-v"], rawArguments: true }),
]);

function commandInventory(catalog = COMMAND_CATALOG) {
  return catalog.map(({ handler, passCommand, trailingArguments, rawArguments, ...entry }) => entry);
}

function renderCommandHelp(catalog = COMMAND_CATALOG) {
  return commandInventory(catalog).map((entry) => `  ${entry.name.padEnd(13)} ${entry.summary}\n    ${entry.args || "（无参数）"}\n    副作用：${entry.sideEffects}`).join("\n");
}

function createCommandDispatcher(handlers, catalog = COMMAND_CATALOG) {
  const entries = new Map();
  for (const entry of catalog) {
    if (typeof handlers[entry.handler] !== "function") throw new Error(`CLI 入口未接线：${entry.name} → ${entry.handler}`);
    for (const name of [entry.name, ...(entry.aliases || [])]) {
      if (entries.has(name)) throw new Error(`CLI 入口重复：${name}`);
      entries.set(name, entry);
    }
  }
  return {
    get: (name) => entries.get(name),
    run(name, args) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`未知命令：${name}`);
      const input = entry.passCommand ? [entry.name, args] : [args, ...(entry.trailingArguments || [])];
      return handlers[entry.handler](...input);
    },
  };
}

module.exports = { COMMAND_CATALOG, commandInventory, renderCommandHelp, createCommandDispatcher };
