"use strict";

// 自有 CLI 的值参数事实；公开 protocol 子命令仍由其原协议解析器处理。
const VALUE_OPTIONS = new Set([
  "approval-ref", "assertions", "base", "binding", "by", "column", "contract-id", "cursor", "customer",
  "database", "datasource", "datasource-type", "db-cluster", "ddl-plan-hash", "entity", "executed-at",
  "expires-at", "field", "file", "format", "from", "frontend", "host", "input", "keywords", "kit-api-md",
  "kitApiMd", "limit", "max-bytes", "max-files", "max-hops", "max-tokens", "message", "migration-hash",
  "module", "note", "openapi", "output", "permissions", "plan-hash", "port", "prefix", "probe-timeout",
  "profile", "project", "range", "recipe", "root-package", "rules", "run-id", "section", "snapshot",
  "source-ref", "table", "target", "target-file", "task", "to", "type", "var",
].map((name) => `--${name}`));

function normalizeArguments(args) {
  const result = [];
  const seen = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const separator = arg.indexOf("=");
    const flag = separator < 0 ? arg : arg.slice(0, separator);
    if (!VALUE_OPTIONS.has(flag)) { result.push(arg); continue; }
    const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
    if (typeof value !== "string" || !value.trim() || value.startsWith("--")) throw new Error(`${flag} 缺少参数`);
    if (flag !== "--var" && seen.has(flag) && seen.get(flag) !== value) throw new Error(`${flag} 有相互冲突的参数`);
    seen.set(flag, value);
    result.push(flag, value);
  }
  return result;
}

function commandPositionals(args, valueOptions, flags, maximum = Infinity) {
  const result = [];
  const values = new Set(valueOptions);
  const switches = new Set(flags);
  for (let index = 0; index < args.length; index += 1) {
    if (values.has(args[index])) { index += 1; continue; }
    if (switches.has(args[index])) continue;
    if (args[index].startsWith("-")) throw new Error(`未知选项：${args[index]}`);
    result.push(args[index]);
  }
  if (result.length > maximum) throw new Error(`只支持 ${maximum} 个目标位置参数；请分别检查多个目标`);
  return result;
}

module.exports = { VALUE_OPTIONS, normalizeArguments, commandPositionals };
