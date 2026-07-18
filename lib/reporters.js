"use strict";

const pkg = require("../package.json");
const catalog = require("../files/.wl-skills-bd/rules/catalog.json");

function toJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function sarifLevel(severity) {
  return { error: "error", warn: "warning", info: "note" }[severity] || "error";
}

function toSarif(result) {
  const used = new Set(result.issues.map((value) => value.rule));
  const definitions = catalog.rules.filter((rule) => used.has(rule.id)).map((rule) => ({
    id: rule.id,
    name: rule.title,
    shortDescription: { text: rule.title },
    helpUri: `https://gitee.com/ycyplus163/wl-skills-bd/blob/main/files/.github/standards/${rule.source[0]}`,
    defaultConfiguration: { level: sarifLevel(rule.severity) },
    properties: { sourceStandards: rule.source, scope: rule.scope },
  }));
  if (used.has("WLS_CONFIG")) definitions.push({
    id: "WLS_CONFIG",
    name: "wl-skills-bd 配置错误",
    shortDescription: { text: "扫描配置或路径不合法" },
    defaultConfiguration: { level: "error" },
  });
  return `${JSON.stringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: pkg.name, version: pkg.version, informationUri: "https://gitee.com/ycyplus163/wl-skills-bd", rules: definitions } },
      automationDetails: { id: "wl-skills-bd/validate" },
      results: result.issues.map((value) => ({
        ruleId: value.rule,
        level: sarifLevel(value.severity),
        message: { text: value.message },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: value.file.replace(/\\/g, "/"), uriBaseId: "%SRCROOT%" },
          region: { startLine: Math.max(1, value.line), startColumn: Math.max(1, value.col), endLine: Math.max(1, value.endLine || value.line) },
        } }],
        partialFingerprints: { primaryLocationLineHash: value.fingerprint },
        properties: { severity: value.severity, standard: value.standard },
      })),
      invocations: [{ executionSuccessful: result.stats.error === 0 }],
    }],
  }, null, 2)}\n`;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function toMarkdown(result) {
  const lines = [
    "# wl-skills-bd 后端规则报告",
    "",
    `- 扫描根目录：\`${result.targetDir}\``,
    `- 结果：error=${result.stats.error}，warn=${result.stats.warn}，info=${result.stats.info}，suppressed=${result.stats.suppressed}`,
    `- 耗时：${result.durationMs} ms`,
    "",
    "| 级别 | 规则 | 文件 | 行 | 说明 |",
    "|---|---|---|---:|---|",
  ];
  if (result.issues.length === 0) lines.push("| — | — | — | — | 未发现违规 |");
  for (const value of result.issues) {
    lines.push(`| ${value.severity} | ${value.rule} | \`${escapeCell(value.file)}\` | ${value.line} | ${escapeCell(value.message)} |`);
  }
  if (result.suppressed.length > 0) {
    lines.push("", "## 已批准抑制", "", "| 规则 | 文件 | 行 | 原因 |", "|---|---|---:|---|");
    for (const value of result.suppressed) lines.push(`| ${value.rule} | \`${escapeCell(value.file)}\` | ${value.line} | ${escapeCell(value.suppressionReason)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function toText(result) {
  const lines = result.issues.map((value) => `${value.severity.toUpperCase()} ${value.rule} ${value.file}:${value.line}:${value.col} ${value.message}`);
  lines.push(`error=${result.stats.error} warn=${result.stats.warn} info=${result.stats.info} suppressed=${result.stats.suppressed} total=${result.stats.total}`);
  return `${lines.join("\n")}\n`;
}

function formatReport(result, format) {
  if (format === "json") return toJson(result);
  if (format === "sarif") return toSarif(result);
  if (format === "markdown") return toMarkdown(result);
  if (format === "text") return toText(result);
  throw new Error(`不支持的报告格式：${format}`);
}

module.exports = { formatReport, toJson, toMarkdown, toSarif, toText };
