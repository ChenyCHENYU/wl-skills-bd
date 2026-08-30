"use strict";

/**
 * beRulesTools — MCP 工具：包装 lib/be-rules.js
 *
 * 暴露 wls_be_validate（扫描工程输出当前 B 规则偏差与可选 Controller 端点清单）。
 * 对标 kit 的 mcp/tools/projectTools.js，但后端无需网关，只读扫描。
 */

const fs = require("fs");
const ruleCatalog = require("../../files/.wl-skills-bd/rules/catalog.json");
const capabilities = require("../../files/.wl-skills-bd/capabilities.json");
const { runBeRules } = require("../../lib/be-rules");
const { normalizeRel, resolveWithin } = require("../../lib/manifest");
const { projectRoot } = require("../project-root");

const RULE_DESC = Object.fromEntries(
  ruleCatalog.rules
    .filter((rule) => /^B\d+$/.test(rule.id))
    .map((rule) => [rule.id, rule.title]),
);

function handleValidate(args) {
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

  const scanned = runBeRules(target, {
    scanRel: relScan,
    quick: args.quick === true,
    rules: args.rules,
  });
  const issues = args.severity ? scanned.issues.filter((issue) => issue.severity === args.severity) : scanned.issues;
  const maxIssues = args.maxIssues === undefined ? 50 : args.maxIssues;
  const visibleIssues = issues.slice(0, maxIssues);
  const stats = {
    error: issues.filter((issue) => issue.severity === "error").length,
    warn: issues.filter((issue) => issue.severity === "warn").length,
    info: issues.filter((issue) => issue.severity === "info").length,
    total: issues.length,
    suppressed: scanned.suppressed.length,
    byRule: issues.reduce((result, issue) => {
      result[issue.rule] = (result[issue.rule] || 0) + 1;
      return result;
    }, {}),
  };
  const endpoints = scanned.endpoints;
  const suppressed = scanned.suppressed;

  if (issues.length === 0) {
    return {
      text: `✅ 未发现 ${capabilities.backendRules.displayRange} 违规；已盘点 ${endpoints.length} 个 Controller 端点。\n注：架构、格式和缺陷仍需配合 ArchUnit/Checkstyle/PMD/SpotBugs/Spotless。`,
      structuredContent: {
        ok: true,
        ...stats,
        endpointCount: endpoints.length,
        ...(args.includeEndpoints === true ? { endpoints } : {}),
        issues: [],
      },
    };
  }

  // 按规则分组（精简输出，避免 token 爆炸）
  const byRule = {};
  for (const i of visibleIssues) {
    if (!byRule[i.rule]) byRule[i.rule] = [];
    byRule[i.rule].push(i);
  }

  const lines = [`扫描：${scanRoot}`, ""];
  for (const rule of Object.keys(byRule).sort()) {
    const list = byRule[rule];
    const sev = list[0].severity;
    const icon = sev === "error" ? "🔴" : "🟡";
    lines.push(`${icon} ${rule} (${list.length} 项) [${sev}] — ${RULE_DESC[rule] || ""}`);
    const show = list.slice(0, 10);
    for (const i of show) {
      const loc = i.line ? `:${i.line}` : "";
      lines.push(`   ${i.file}${loc}`);
    }
    if (list.length > 10) lines.push(`   ... 还有 ${list.length - 10} 项`);
  }
  lines.push("");
  lines.push(`汇总：🔴 ${stats.error} | 🟡 ${stats.warn} | 共 ${stats.total} 项`);

  return {
    text: lines.join("\n"),
    structuredContent: {
      ok: stats.error === 0,
      error: stats.error,
      warn: stats.warn,
      total: stats.total,
      byRule: stats.byRule,
      endpointCount: endpoints.length,
      ...(args.includeEndpoints === true ? { endpoints } : {}),
      issues: visibleIssues,
      returnedIssues: visibleIssues.length,
      truncated: visibleIssues.length < issues.length,
      suppressed: suppressed.length,
    },
    isError: stats.error > 0,
  };
}

module.exports = {
  handleValidate,
  RULE_DESC,
};
