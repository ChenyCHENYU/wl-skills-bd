"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { runBeRules } = require("./be-rules");
const { hashJson } = require("./deterministic");
const {
  buildBaselinePlan,
  collectCoverage,
  evaluateQualityGate,
  loadBaseline,
  loadQualityGate,
} = require("./quality-gate");
const { normalizeRel } = require("./manifest");

function git(projectRoot, args) {
  return spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
}

function lines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function discoverChangedFiles(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  if (Array.isArray(options.changedFiles)) {
    return { ok: true, mode: "explicit", files: [...new Set(options.changedFiles.map(normalizeRel))].sort(), changedLines: options.changedLines || new Map() };
  }
  let args;
  let mode;
  if (options.staged === true) {
    args = ["diff", "--cached", "--name-only", "--diff-filter=ACMR"];
    mode = "staged";
  } else if (options.base) {
    args = ["diff", "--name-only", "--diff-filter=ACMR", `${options.base}...HEAD`];
    mode = "base";
  } else return { ok: true, mode: "full", files: null, changedLines: new Map() };
  const result = git(projectRoot, args);
  if (result.status !== 0) return { ok: false, mode, files: [], changedLines: new Map(), error: String(result.stderr || result.stdout || "git diff failed").trim() };
  const files = [...new Set(lines(result.stdout).map(normalizeRel))].sort();
  const changedLines = discoverChangedLines(projectRoot, options);
  return { ok: true, mode, files, changedLines };
}

function discoverChangedLines(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  if (options.changedLines instanceof Map) return options.changedLines;
  let args;
  if (options.staged === true) args = ["diff", "--cached", "--unified=0", "--diff-filter=ACMR", "--", "*.java"];
  else if (options.base) args = ["diff", "--unified=0", "--diff-filter=ACMR", `${options.base}...HEAD`, "--", "*.java"];
  else return new Map();
  const result = git(projectRoot, args);
  if (result.status !== 0) return new Map();
  const changed = new Map();
  let current = null;
  for (const line of String(result.stdout || "").split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      current = normalizeRel(fileMatch[1]);
      if (!changed.has(current)) changed.set(current, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk || !current) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    for (let index = 0; index < count; index += 1) changed.get(current).add(start + index);
  }
  return changed;
}

function currentCommit(projectRoot) {
  const result = git(projectRoot, ["rev-parse", "HEAD"]);
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function normalizeFinding(value, source) {
  const normalized = {
    ...value,
    rule: value.rule || value.code || "REVIEW",
    code: value.code || value.rule || "REVIEW",
    severity: value.severity || "error",
    file: value.file || value.path || ".",
    line: Number(value.line || 1),
    col: Number(value.col || 1),
    source,
  };
  normalized.fingerprint = normalized.fingerprint || hashJson({
    rule: normalized.rule,
    file: normalized.file,
    line: normalized.line,
    message: normalized.message,
  });
  return normalized;
}

function stabilizeFindingFingerprints(findings) {
  const ordinals = new Map();
  return findings.map((item) => {
    const key = hashJson({ source: item.source, rule: item.rule, file: item.file, message: item.message });
    const ordinal = (ordinals.get(key) || 0) + 1;
    ordinals.set(key, ordinal);
    return {
      ...item,
      evidenceFingerprint: item.fingerprint,
      fingerprint: hashJson({ source: item.source, rule: item.rule, file: item.file, message: item.message, ordinal }),
    };
  });
}

function compactFinding(value) {
  return {
    rule: value.rule,
    severity: value.severity,
    file: value.file,
    line: value.line,
    message: value.message,
    fingerprint: value.fingerprint,
    source: value.source,
  };
}

function compactModuleEvidence(modules, limit = 20) {
  if (!Array.isArray(modules)) return null;
  const items = modules.map((item) => ({
    id: item.id,
    root: item.root,
    stats: item.stats,
    scan: item.execution ? item.execution.scan : null,
  }));
  items.sort((left, right) => Number((right.stats && right.stats.total) || 0) - Number((left.stats && left.stats.total) || 0));
  return { count: items.length, items: items.slice(0, limit), truncated: items.length > limit };
}

function compactExecution(execution) {
  if (!execution) return null;
  return {
    executedGroups: execution.executedGroups,
    unknownRules: execution.unknownRules,
    scan: execution.scan,
    workspace: execution.workspace,
  };
}

function runReview(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const changes = discoverChangedFiles(projectRoot, options);
  if (!changes.ok) {
    return { ok: false, decision: "block", reason: "change-discovery-failed", error: changes.error, changes };
  }
  const loaded = loadQualityGate(projectRoot);
  const baseline = loadBaseline(projectRoot, loaded.config);
  const beRules = runBeRules(projectRoot, {
    stagedFiles: changes.files === null ? undefined : changes.files,
    module: options.module,
    quick: options.quick === true,
    rules: options.rules,
  });
  const adapters = require("./integration-adapter").inspectIntegrationAdapters(projectRoot, {
    module: options.module,
    changedFiles: changes.files,
  });
  const supplyChain = require("./supply-chain").inspectSupplyChain(projectRoot, { changedFiles: changes.files });
  const assertions = require("./policy-assertions").inspectPolicyAssertions(projectRoot, {
    module: options.module,
    changedFiles: changes.files,
  });
  const findings = stabilizeFindingFingerprints([
    ...beRules.issues.map((item) => normalizeFinding(item, "be-rules")),
    ...adapters.findings.map((item) => normalizeFinding(item, "integration-adapter")),
    ...supplyChain.findings.map((item) => normalizeFinding(item, "supply-chain")),
    ...assertions.findings.map((item) => normalizeFinding(item, "quality-assertion")),
  ]);
  const coverage = collectCoverage(projectRoot, loaded.config, changes.changedLines);
  const gate = evaluateQualityGate({
    findings,
    config: loaded.config,
    configDiagnostics: loaded.diagnostics,
    baseline,
    coverage,
    ruleCoverage: beRules.coverage,
    now: options.now,
  });
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 500));
  const changedFiles = changes.files === null ? null : changes.files.slice(0, limit);
  return {
    schemaVersion: 1,
    ok: gate.ok,
    decision: gate.decision,
    projectRoot,
    commit: currentCommit(projectRoot),
    changes: {
      mode: changes.mode,
      files: changedFiles,
      count: changes.files === null ? null : changes.files.length,
      truncated: changes.files !== null && changes.files.length > limit,
    },
    qualityGate: {
      source: loaded.source,
      baselineMode: loaded.config.baselineMode,
      baselineExists: baseline.exists,
      blockSeverities: loaded.config.blockSeverities,
      summary: gate.summary,
      reasons: gate.gateReasons,
      coverage: gate.coverage,
    },
    ruleCoverage: beRules.coverage,
    findings: gate.fresh.slice(0, limit).map(compactFinding),
    findingCount: gate.fresh.length,
    blockers: gate.blockers.slice(0, limit).map(compactFinding),
    blockerCount: gate.blockers.length,
    existing: gate.existing.slice(0, limit).map(compactFinding),
    existingCount: gate.existing.length,
    suppressed: gate.suppressed.slice(0, limit).map((item) => ({ ...compactFinding(item), exemption: item.exemption })),
    suppressedCount: gate.suppressed.length,
    truncated: gate.fresh.length > limit || gate.blockers.length > limit || gate.existing.length > limit
      || gate.suppressed.length > limit || (changes.files !== null && changes.files.length > limit),
    evidence: {
      beRules: beRules.stats,
      endpoints: beRules.endpoints.length,
      modules: compactModuleEvidence(beRules.modules, limit),
      integrationAdapters: { configured: adapters.configured, readiness: adapters.readiness, summary: adapters.summary },
      supplyChain: { configured: supplyChain.configured, state: supplyChain.state, inventory: supplyChain.inventory, summary: supplyChain.summary },
      qualityAssertions: { configured: assertions.configured, state: assertions.state, summary: assertions.summary },
      execution: compactExecution(beRules.execution),
    },
    _allFindings: [...gate.fresh, ...gate.existing, ...gate.suppressed.map((item) => {
      const { exemption, ...findingValue } = item;
      return findingValue;
    })],
  };
}

function buildReviewBaselinePlan(projectRootInput, options = {}) {
  if (options.module) {
    return { ok: false, reason: "baseline-requires-project-full-review", module: options.module };
  }
  const review = runReview(projectRootInput, {
    ...options,
    changedFiles: undefined,
    changedLines: undefined,
    staged: false,
    base: undefined,
    quick: false,
    rules: undefined,
  });
  if (review.reason) return { ok: false, reason: review.reason, error: review.error };
  const loaded = loadQualityGate(projectRootInput);
  if (!loaded.ok) return { ok: false, reason: "quality-gate-config-invalid", errors: loaded.diagnostics };
  if (!review.ruleCoverage || review.ruleCoverage.status !== "complete") {
    return { ok: false, reason: "baseline-requires-complete-review", ruleCoverage: review.ruleCoverage };
  }
  const infrastructureRules = new Set([
    "QG_CONFIG", "QG_BASELINE", "QG_COVERAGE", "QG_CHANGED_SOURCE_UNRESOLVED",
    "QG_EXEMPTION_EXPIRED", "MQ_ADAPTER_CONFIG", "QA_CONFIG", "SC_CONFIG",
  ]);
  const infrastructureErrors = review._allFindings.filter((item) => item.severity === "error" && infrastructureRules.has(item.rule));
  if (infrastructureErrors.length > 0) {
    return { ok: false, reason: "baseline-infrastructure-invalid", errors: infrastructureErrors.map(compactFinding) };
  }
  const plan = buildBaselinePlan(projectRootInput, review._allFindings, loaded.config, {
    sourceCommit: review.commit,
    scope: "full",
  });
  return { ...plan, reviewSummary: review.qualityGate.summary };
}

function publicReview(value) {
  const { _allFindings, projectRoot, ...result } = value;
  return result;
}

module.exports = {
  buildReviewBaselinePlan,
  compactFinding,
  compactExecution,
  compactModuleEvidence,
  discoverChangedFiles,
  discoverChangedLines,
  normalizeFinding,
  publicReview,
  runReview,
  stabilizeFindingFingerprints,
};
