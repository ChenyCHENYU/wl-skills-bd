"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson, stableJson } = require("./deterministic");
const { applyFilePlan, buildFilePlan, publicFilePlan } = require("./file-transaction");
const { normalizeRel, resolveWithin } = require("./manifest");

const CONFIG_REL = ".wl-skills-bd/quality-gate.json";
const DEFAULT_BASELINE_REL = ".wl-skills-bd/review-baseline.json";
const SEVERITIES = new Set(["error", "warn", "info"]);

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  baselineMode: "new-only",
  baselineFile: DEFAULT_BASELINE_REL,
  blockSeverities: ["error"],
  requireCompleteRuleCoverage: true,
  warningBudget: null,
  coverage: {
    required: false,
    reportPaths: [],
    minimumLine: null,
    minimumChangedLine: null,
  },
  exemptions: [],
});

function finding(code, message, overrides = {}) {
  const value = {
    rule: code,
    code,
    severity: "error",
    file: CONFIG_REL,
    line: 1,
    col: 1,
    message,
    standard: "quality-gate",
    ...overrides,
  };
  value.fingerprint = value.fingerprint || hashJson({
    rule: value.rule,
    file: value.file,
    line: value.line,
    message: value.message,
  });
  return value;
}

function cloneDefaults() {
  return {
    ...DEFAULT_CONFIG,
    blockSeverities: [...DEFAULT_CONFIG.blockSeverities],
    coverage: { ...DEFAULT_CONFIG.coverage, reportPaths: [] },
    exemptions: [],
  };
}

function readJsonFile(file, rel, diagnostics) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    diagnostics.push(finding("QG_CONFIG", `JSON 无法解析：${error.message}`, { file: rel }));
    return null;
  }
}

function finiteRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateConfig(raw, diagnostics) {
  const config = cloneDefaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push(finding("QG_CONFIG", "质量门配置根节点必须是对象"));
    return config;
  }
  const allowed = new Set([
    "schemaVersion", "baselineMode", "baselineFile", "blockSeverities",
    "requireCompleteRuleCoverage", "warningBudget", "coverage", "exemptions",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) diagnostics.push(finding("QG_CONFIG", `不支持配置项 ${key}`));
  }
  if (raw.schemaVersion !== 1) diagnostics.push(finding("QG_CONFIG", "只支持 schemaVersion=1"));
  if (raw.baselineMode !== undefined) {
    if (!["new-only", "all"].includes(raw.baselineMode)) diagnostics.push(finding("QG_CONFIG", "baselineMode 只允许 new-only/all"));
    else config.baselineMode = raw.baselineMode;
  }
  if (raw.baselineFile !== undefined) {
    if (typeof raw.baselineFile !== "string" || !raw.baselineFile.trim()) diagnostics.push(finding("QG_CONFIG", "baselineFile 必须是项目内相对路径"));
    else {
      try {
        config.baselineFile = normalizeRel(raw.baselineFile);
        if (!config.baselineFile || config.baselineFile.startsWith("../") || path.isAbsolute(config.baselineFile)) throw new Error("路径越界");
      } catch (error) {
        diagnostics.push(finding("QG_CONFIG", `baselineFile 非法：${error.message}`));
      }
    }
  }
  if (raw.blockSeverities !== undefined) {
    if (!Array.isArray(raw.blockSeverities) || raw.blockSeverities.length === 0
      || raw.blockSeverities.some((item) => !SEVERITIES.has(item))) {
      diagnostics.push(finding("QG_CONFIG", "blockSeverities 必须是非空的 error/warn/info 数组"));
    } else config.blockSeverities = [...new Set(raw.blockSeverities)];
  }
  if (raw.requireCompleteRuleCoverage !== undefined) {
    if (typeof raw.requireCompleteRuleCoverage !== "boolean") diagnostics.push(finding("QG_CONFIG", "requireCompleteRuleCoverage 必须是 boolean"));
    else config.requireCompleteRuleCoverage = raw.requireCompleteRuleCoverage;
  }
  if (raw.warningBudget !== undefined && raw.warningBudget !== null) {
    if (!Number.isInteger(raw.warningBudget) || raw.warningBudget < 0) diagnostics.push(finding("QG_CONFIG", "warningBudget 必须是非负整数或 null"));
    else config.warningBudget = raw.warningBudget;
  }
  if (raw.coverage !== undefined) {
    if (!raw.coverage || typeof raw.coverage !== "object" || Array.isArray(raw.coverage)) {
      diagnostics.push(finding("QG_CONFIG", "coverage 必须是对象"));
    } else {
      const coverageAllowed = new Set(["required", "reportPaths", "minimumLine", "minimumChangedLine"]);
      for (const key of Object.keys(raw.coverage)) if (!coverageAllowed.has(key)) diagnostics.push(finding("QG_CONFIG", `不支持 coverage.${key}`));
      if (raw.coverage.required !== undefined && typeof raw.coverage.required !== "boolean") diagnostics.push(finding("QG_CONFIG", "coverage.required 必须是 boolean"));
      else if (raw.coverage.required !== undefined) config.coverage.required = raw.coverage.required;
      if (raw.coverage.reportPaths !== undefined) {
        if (!Array.isArray(raw.coverage.reportPaths) || raw.coverage.reportPaths.some((item) => typeof item !== "string" || !item.trim())) {
          diagnostics.push(finding("QG_CONFIG", "coverage.reportPaths 必须是相对路径字符串数组"));
        } else config.coverage.reportPaths = [...new Set(raw.coverage.reportPaths.map(normalizeRel))];
      }
      for (const key of ["minimumLine", "minimumChangedLine"]) {
        if (raw.coverage[key] !== undefined && raw.coverage[key] !== null) {
          if (!finiteRatio(raw.coverage[key])) diagnostics.push(finding("QG_CONFIG", `coverage.${key} 必须在 0~1 之间`));
          else config.coverage[key] = raw.coverage[key];
        }
      }
    }
  }
  if (raw.exemptions !== undefined) {
    if (!Array.isArray(raw.exemptions)) diagnostics.push(finding("QG_CONFIG", "exemptions 必须是数组"));
    else raw.exemptions.forEach((item, index) => {
      const pointer = `exemptions[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        diagnostics.push(finding("QG_CONFIG", `${pointer} 必须是对象`));
        return;
      }
      const required = ["fingerprint", "owner", "reason", "approvalRef", "expiresAt"];
      if (required.some((key) => typeof item[key] !== "string" || !item[key].trim())) {
        diagnostics.push(finding("QG_CONFIG", `${pointer} 必须提供 fingerprint/owner/reason/approvalRef/expiresAt`));
        return;
      }
      const expiresAt = Date.parse(item.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        diagnostics.push(finding("QG_CONFIG", `${pointer}.expiresAt 不是合法 ISO 日期`));
        return;
      }
      config.exemptions.push({
        fingerprint: item.fingerprint,
        owner: item.owner,
        reason: item.reason,
        approvalRef: item.approvalRef,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    });
  }
  return config;
}

function loadQualityGate(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  const diagnostics = [];
  const file = path.join(projectRoot, CONFIG_REL);
  if (!fs.existsSync(file)) return { ok: true, source: "defaults", file: CONFIG_REL, config: cloneDefaults(), diagnostics };
  const raw = readJsonFile(file, CONFIG_REL, diagnostics);
  const config = raw ? validateConfig(raw, diagnostics) : cloneDefaults();
  return { ok: diagnostics.length === 0, source: "project", file: CONFIG_REL, config, diagnostics };
}

function loadBaseline(projectRoot, config) {
  const diagnostics = [];
  let file;
  try {
    file = resolveWithin(projectRoot, config.baselineFile);
  } catch (error) {
    diagnostics.push(finding("QG_BASELINE", error.message, { file: config.baselineFile }));
    return { ok: false, exists: false, fingerprints: new Set(), diagnostics };
  }
  if (!fs.existsSync(file)) return { ok: true, exists: false, fingerprints: new Set(), diagnostics };
  const raw = readJsonFile(file, config.baselineFile, diagnostics);
  if (!raw) return { ok: false, exists: true, fingerprints: new Set(), diagnostics };
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.findings)) {
    diagnostics.push(finding("QG_BASELINE", "基线只支持 schemaVersion=1 且 findings 必须是数组", { file: config.baselineFile }));
    return { ok: false, exists: true, fingerprints: new Set(), diagnostics };
  }
  const fingerprints = new Set();
  for (const item of raw.findings) {
    if (!item || typeof item.fingerprint !== "string" || !item.fingerprint) {
      diagnostics.push(finding("QG_BASELINE", "基线 findings 存在空 fingerprint", { file: config.baselineFile }));
      continue;
    }
    fingerprints.add(item.fingerprint);
  }
  return { ok: diagnostics.length === 0, exists: true, raw, fingerprints, diagnostics };
}

function parseJacocoXml(content) {
  const sources = new Map();
  for (const packageMatch of content.matchAll(/<package\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g)) {
    const packageName = packageMatch[1];
    for (const sourceMatch of packageMatch[2].matchAll(/<sourcefile\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g)) {
      const rel = normalizeRel(path.posix.join(packageName, sourceMatch[1]));
      const lines = new Map();
      for (const lineMatch of sourceMatch[2].matchAll(/<line\b([^>]*)\/?\s*>/g)) {
        const attrs = Object.fromEntries([...lineMatch[1].matchAll(/(\w+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
        if (attrs.nr) lines.set(Number(attrs.nr), Number(attrs.ci || 0) > 0);
      }
      sources.set(rel, lines);
    }
  }
  const counters = [...content.matchAll(/<counter\b([^>]*)\/?\s*>/g)]
    .map((match) => Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map((item) => [item[1], item[2]])))
    .filter((attrs) => attrs.type === "LINE");
  const last = counters[counters.length - 1];
  const missed = last ? Number(last.missed || 0) : 0;
  const covered = last ? Number(last.covered || 0) : 0;
  return { sources, line: { covered, missed, ratio: covered + missed > 0 ? covered / (covered + missed) : null } };
}

function collectCoverage(projectRootInput, config, changedLines = new Map()) {
  const projectRoot = path.resolve(projectRootInput);
  const reports = [];
  const diagnostics = [];
  const sourceLines = new Map();
  const sourceCandidates = new Map();
  let covered = 0;
  let missed = 0;
  for (const rel of config.coverage.reportPaths) {
    let file;
    try {
      file = resolveWithin(projectRoot, rel);
    } catch (error) {
      diagnostics.push(finding("QG_COVERAGE", error.message, { file: rel }));
      continue;
    }
    if (!fs.existsSync(file)) {
      diagnostics.push(finding("QG_COVERAGE", `JaCoCo XML 不存在：${rel}`, { file: rel, severity: config.coverage.required ? "error" : "warn" }));
      continue;
    }
    const parsed = parseJacocoXml(fs.readFileSync(file, "utf8"));
    reports.push(rel);
    covered += parsed.line.covered;
    missed += parsed.line.missed;
    const normalizedReport = normalizeRel(rel);
    const targetMarker = "/target/";
    const targetIndex = `/${normalizedReport}`.lastIndexOf(targetMarker);
    const modulePrefix = targetIndex < 0 ? "" : `/${normalizedReport}`.slice(1, targetIndex);
    for (const [source, lines] of parsed.sources) {
      const projectSource = normalizeRel(path.posix.join(modulePrefix, "src/main/java", source));
      sourceLines.set(projectSource, lines);
      if (!sourceCandidates.has(source)) sourceCandidates.set(source, []);
      sourceCandidates.get(source).push(lines);
    }
  }
  let changedCovered = 0;
  let changedMissed = 0;
  const unresolvedChangedSources = [];
  for (const [file, lines] of changedLines) {
    const marker = "/src/main/java/";
    const projectFile = normalizeRel(file);
    const normalized = `/${projectFile}`;
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const source = normalized.slice(index + marker.length);
    const candidates = sourceCandidates.get(source) || [];
    const measured = sourceLines.get(projectFile) || (candidates.length === 1 ? candidates[0] : null);
    if (!measured) {
      unresolvedChangedSources.push({ file: projectFile, candidates: candidates.length });
      continue;
    }
    for (const line of lines) {
      if (!measured.has(line)) continue;
      if (measured.get(line)) changedCovered += 1;
      else changedMissed += 1;
    }
  }
  for (const item of unresolvedChangedSources) {
    diagnostics.push(finding("QG_CHANGED_SOURCE_UNRESOLVED", item.candidates > 1
      ? `变更源码在多个 JaCoCo 报告中同名且无法归属：${item.file}`
      : `JaCoCo 报告未覆盖变更源码：${item.file}`, {
      file: item.file,
      severity: config.coverage.required || typeof config.coverage.minimumChangedLine === "number" ? "error" : "warn",
    }));
  }
  const total = covered + missed;
  const changedTotal = changedCovered + changedMissed;
  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    reports,
    line: { covered, missed, ratio: total > 0 ? covered / total : null },
    changedLine: { covered: changedCovered, missed: changedMissed, ratio: changedTotal > 0 ? changedCovered / changedTotal : null },
    diagnostics,
  };
}

function evaluateQualityGate(input) {
  const now = input.now ? new Date(input.now) : new Date();
  const config = input.config;
  const baseline = input.baseline || { exists: false, fingerprints: new Set(), diagnostics: [] };
  const coverage = input.coverage || { reports: [], line: { ratio: null }, changedLine: { ratio: null }, diagnostics: [] };
  const allFindings = [...(input.findings || []), ...(input.configDiagnostics || []), ...(baseline.diagnostics || []), ...(coverage.diagnostics || [])];
  const activeExemptions = new Map();
  const expired = [];
  for (const item of config.exemptions) {
    if (Date.parse(item.expiresAt) <= now.getTime()) expired.push(item);
    else activeExemptions.set(item.fingerprint, item);
  }
  for (const item of expired) {
    allFindings.push(finding("QG_EXEMPTION_EXPIRED", `质量门豁免已过期：${item.approvalRef}（${item.owner}）`, { fingerprint: hashJson({ code: "QG_EXEMPTION_EXPIRED", approvalRef: item.approvalRef, expiresAt: item.expiresAt }) }));
  }
  const suppressed = [];
  const existing = [];
  const fresh = [];
  for (const item of allFindings) {
    const exemption = activeExemptions.get(item.fingerprint);
    if (exemption) suppressed.push({ ...item, exemption });
    else if (config.baselineMode === "new-only" && baseline.fingerprints.has(item.fingerprint)) existing.push(item);
    else fresh.push(item);
  }
  const blockers = fresh.filter((item) => config.blockSeverities.includes(item.severity));
  const gateReasons = [];
  if (config.requireCompleteRuleCoverage && input.ruleCoverage && input.ruleCoverage.status !== "complete") {
    gateReasons.push({ code: "QG_RULE_COVERAGE", message: `规则覆盖不完整：${input.ruleCoverage.mode || "partial"}` });
  }
  const freshWarnings = fresh.filter((item) => item.severity === "warn").length;
  if (config.warningBudget !== null && freshWarnings > config.warningBudget) {
    gateReasons.push({ code: "QG_WARNING_BUDGET", message: `新增 warning ${freshWarnings} 超过预算 ${config.warningBudget}` });
  }
  if (config.coverage.required && coverage.reports.length === 0) gateReasons.push({ code: "QG_COVERAGE_REQUIRED", message: "未找到必需的 JaCoCo XML" });
  if (config.coverage.minimumLine !== null && (coverage.line.ratio === null || coverage.line.ratio < config.coverage.minimumLine)) {
    gateReasons.push({ code: "QG_LINE_COVERAGE", message: `行覆盖率 ${coverage.line.ratio === null ? "unknown" : coverage.line.ratio.toFixed(4)} 低于 ${config.coverage.minimumLine}` });
  }
  if (config.coverage.minimumChangedLine !== null && (coverage.changedLine.ratio === null || coverage.changedLine.ratio < config.coverage.minimumChangedLine)) {
    gateReasons.push({ code: "QG_CHANGED_COVERAGE", message: `变更行覆盖率 ${coverage.changedLine.ratio === null ? "unknown" : coverage.changedLine.ratio.toFixed(4)} 低于 ${config.coverage.minimumChangedLine}` });
  }
  return {
    ok: blockers.length === 0 && gateReasons.length === 0,
    decision: blockers.length === 0 && gateReasons.length === 0 ? (fresh.length > 0 ? "warn" : "pass") : "block",
    blockers,
    fresh,
    existing,
    suppressed,
    gateReasons,
    coverage,
    summary: {
      total: allFindings.length,
      fresh: fresh.length,
      existing: existing.length,
      suppressed: suppressed.length,
      blockers: blockers.length,
      expiredExemptions: expired.length,
    },
  };
}

function baselineDocument(findings, metadata = {}) {
  const rows = [...new Map((findings || []).filter((item) => item.fingerprint).map((item) => [item.fingerprint, {
    fingerprint: item.fingerprint,
    rule: item.rule || item.code,
    severity: item.severity,
    file: item.file,
  }])).values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  return {
    schemaVersion: 1,
    sourceCommit: metadata.sourceCommit || null,
    scope: metadata.scope || "full",
    findings: rows,
  };
}

function buildBaselinePlan(projectRootInput, findings, config, metadata = {}) {
  const content = stableJson(baselineDocument(findings, metadata));
  return buildFilePlan(projectRootInput, config.baselineFile, content, {
    kind: "review-baseline",
    metadata: { findings: (findings || []).length, sourceCommit: metadata.sourceCommit || null },
  });
}

module.exports = {
  CONFIG_REL,
  DEFAULT_BASELINE_REL,
  DEFAULT_CONFIG,
  applyBaselinePlan: applyFilePlan,
  baselineDocument,
  buildBaselinePlan,
  collectCoverage,
  evaluateQualityGate,
  finding,
  loadBaseline,
  loadQualityGate,
  parseJacocoXml,
  publicBaselinePlan: publicFilePlan,
  validateConfig,
};
