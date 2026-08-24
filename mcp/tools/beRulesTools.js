"use strict";

/**
 * beRulesTools — MCP 工具：包装 lib/be-rules.js。
 * 默认只返回摘要；需要定位时显式选择 compact/full，避免把大段源码/问题重复
 * 塞进模型上下文。staged/changed 模式会明确返回 partial 覆盖状态。
 */

const fs = require("fs");
const { spawnSync } = require("child_process");
const ruleCatalog = require("../../files/.wl-skills-bd/rules/catalog.json");
const { runBeRules } = require("../../lib/be-rules");
const { normalizeRel, resolveWithin } = require("../../lib/manifest");
const { projectRoot } = require("../project-root");

const RULE_DESC = Object.fromEntries(
  ruleCatalog.rules
    .filter((rule) => /^B\d+$/.test(rule.id))
    .map((rule) => [rule.id, rule.title]),
);

function stagedFiles(target) {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: target,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return (result.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function issueView(value, detail) {
  if (detail === "full") return value;
  return {
    rule: value.rule,
    severity: value.severity,
    file: value.file,
    line: value.line,
    col: value.col,
    message: value.message,
    fingerprint: value.fingerprint,
  };
}

function appendLimited(lines, value, maxBytes) {
  const candidate = [...lines, value].join("\n");
  if (Buffer.byteLength(candidate, "utf8") > maxBytes) return false;
  lines.push(value);
  return true;
}

function handleValidate(args = {}) {
  const target = projectRoot();
  let scanRoot;
  try {
    scanRoot = args.path ? resolveWithin(target, args.path) : target;
  } catch (error) {
    return { text: `❌ ${error.message}`, isError: true, structuredContent: { ok: false, error: "path-outside-project" } };
  }
  if (!fs.existsSync(scanRoot)) {
    return {
      text: `❌ 扫描路径不存在：${scanRoot}`,
      isError: true,
      structuredContent: { ok: false, error: "path-not-found" },
    };
  }

  const relScan = args.path ? normalizeRel(args.path) : undefined;
  const changed = Array.isArray(args.changed) && args.changed.length > 0
    ? args.changed.map((value) => normalizeRel(value))
    : args.staged === true
      ? stagedFiles(target)
      : undefined;
  const detail = args.detail || "summary";
  const maxItems = Math.max(1, Math.min(Number(args.maxItems) || 20, 500));
  const maxBytes = Math.max(4096, Math.min(Number(args.maxBytes) || 20000, 200000));
  const result = runBeRules(target, {
    scanRel: relScan,
    quick: args.quick === true,
    stagedFiles: changed,
    rules: Array.isArray(args.rules) ? args.rules : undefined,
  });
  const { endpoints, issues, suppressed, stats, coverage } = result;

  // 按规则分组：摘要只保留计数，compact/full 才携带有限问题明细。
  const byRule = {};
  for (const item of issues) {
    if (!byRule[item.rule]) byRule[item.rule] = [];
    byRule[item.rule].push(item);
  }

  const lines = [`扫描：${scanRoot}；模式=${coverage.mode}；覆盖=${coverage.status}`, ""];
  if (coverage.skippedRules.length > 0) {
    lines.push(`未评估规则：${coverage.skippedRules.map((item) => item.rule).join(", ")}（请用 full 扫描补齐）`);
    lines.push("");
  }
  for (const rule of Object.keys(byRule).sort()) {
    const list = byRule[rule];
    const sev = list[0].severity;
    const icon = sev === "error" ? "🔴" : "🟡";
    lines.push(`${icon} ${rule} (${list.length} 项) [${sev}] — ${RULE_DESC[rule] || ""}`);
    if (detail !== "summary") {
      const show = list.slice(0, maxItems);
      for (const item of show) {
        const loc = item.line ? `:${item.line}` : "";
        if (!appendLimited(lines, `   ${item.file}${loc} ${detail === "full" ? `— ${item.message}` : ""}`, maxBytes)) break;
      }
      if (list.length > show.length) appendLimited(lines, `   ... 还有 ${list.length - show.length} 项`, maxBytes);
    }
  }
  lines.push("");
  lines.push(`汇总：🔴 ${stats.error} | 🟡 ${stats.warn} | 共 ${stats.total} 项；端点 ${endpoints.length}；抑制 ${suppressed.length}`);
  if (Buffer.byteLength(lines.join("\n"), "utf8") > maxBytes) {
    while (lines.length > 1 && Buffer.byteLength(lines.join("\n"), "utf8") > maxBytes) lines.splice(lines.length - 2, 1);
    lines.splice(lines.length - 1, 0, "… 输出已按 maxBytes 截断，请调大 maxBytes 或使用 detail=summary");
  }

  const returnedIssues = detail === "summary" ? [] : issues.slice(0, maxItems).map((value) => issueView(value, detail));
  const structuredContent = {
    ok: stats.error === 0,
    status: result.status,
    coverage,
    evaluatedRules: result.evaluatedRules,
    skippedRules: result.skippedRules,
    error: stats.error,
    warn: stats.warn,
    total: stats.total,
    byRule: stats.byRule,
    endpoints: detail === "full" ? endpoints : endpoints.slice(0, maxItems),
    issues: returnedIssues,
    issueCount: issues.length,
    truncated: returnedIssues.length < issues.length,
    suppressed: suppressed.length,
  };

  if (issues.length === 0) {
    const state = coverage.status === "complete" ? "✅ 未发现 B1~B31 违规" : "✅ 未发现已评估规则违规";
    return {
      text: `${state}；已盘点 ${endpoints.length} 个 Controller 端点。\n${lines.slice(1).join("\n")}\n注：架构、格式和缺陷仍需配合 ArchUnit/Checkstyle/PMD/SpotBugs/Spotless。`,
      structuredContent,
    };
  }

  return {
    text: lines.join("\n"),
    structuredContent,
    isError: stats.error > 0,
  };
}

module.exports = {
  handleValidate,
  RULE_DESC,
};
