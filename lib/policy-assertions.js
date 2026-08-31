"use strict";

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { hashJson } = require("./deterministic");
const { hashBuffer, hashFile, normalizeRel, resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

const CONFIG_REL = ".wl-skills-bd/quality-assertions.json";

function finding(code, message, overrides = {}) {
  const value = {
    rule: code, code, severity: "error", file: CONFIG_REL, line: 1, col: 1,
    message, standard: "quality-assertion", source: "quality-assertion", ...overrides,
  };
  value.fingerprint = value.fingerprint || hashJson({ rule: value.rule, assertionId: value.assertionId || null, file: value.file, message: value.message });
  return value;
}

function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }

function strings(value, pointer, diagnostics, options = {}) {
  if (value === undefined && options.optional) return [];
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) {
    diagnostics.push(finding("QA_CONFIG", `${pointer} 必须是${options.allowEmpty ? "" : "非空"}字符串数组`));
    return [];
  }
  return [...new Set(value)];
}

function validateReplacement(raw, pointer, diagnostics, evidenceRefs) {
  if (!isObject(raw)) { diagnostics.push(finding("QA_CONFIG", `${pointer} 必须是对象`)); return null; }
  const allowed = new Set(["file", "before", "after", "expectedOccurrences"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(finding("QA_CONFIG", `${pointer} 不支持 ${key}`));
  if (typeof raw.file !== "string" || !raw.file.trim()) diagnostics.push(finding("QA_CONFIG", `${pointer}.file 必填`));
  if (typeof raw.before !== "string" || !raw.before.length) diagnostics.push(finding("QA_CONFIG", `${pointer}.before 必须是非空精确文本`));
  if (typeof raw.after !== "string") diagnostics.push(finding("QA_CONFIG", `${pointer}.after 必须是字符串`));
  if (typeof raw.before === "string" && typeof raw.after === "string" && raw.before === raw.after) diagnostics.push(finding("QA_CONFIG", `${pointer}.before/after 不得相同`));
  if ((typeof raw.before === "string" && raw.before.includes("\0")) || (typeof raw.after === "string" && raw.after.includes("\0"))) diagnostics.push(finding("QA_CONFIG", `${pointer} 不得包含 NUL 字节`));
  if (raw.expectedOccurrences !== undefined && raw.expectedOccurrences !== 1) diagnostics.push(finding("QA_CONFIG", `${pointer}.expectedOccurrences 只允许 1`));
  const file = typeof raw.file === "string" ? normalizeRel(raw.file) : null;
  if (file && (file.startsWith("../") || path.isAbsolute(file))) diagnostics.push(finding("QA_CONFIG", `${pointer}.file 必须是项目内相对路径`));
  if (file && !evidenceRefs.includes(file)) diagnostics.push(finding("QA_CONFIG", `${pointer}.file 必须同时登记在 evidenceRefs`));
  return { file, before: raw.before, after: raw.after, expectedOccurrences: 1 };
}

function validateAssertion(raw, index, diagnostics) {
  const pointer = `assertions[${index}]`;
  if (!isObject(raw)) { diagnostics.push(finding("QA_CONFIG", `${pointer} 必须是对象`)); return null; }
  const allowed = new Set(["id", "module", "description", "evidenceRefs", "activateAnyOf", "requireAnyOf", "forbidAnyOf", "severity", "message", "owner", "sourceRef", "safeReplacements"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(finding("QA_CONFIG", `${pointer} 不支持 ${key}`));
  if (typeof raw.id !== "string" || !/^[A-Z][A-Z0-9_-]{2,63}$/.test(raw.id)) diagnostics.push(finding("QA_CONFIG", `${pointer}.id 必须是稳定的大写 ID`));
  for (const key of ["module", "description", "message", "owner", "sourceRef"]) if (typeof raw[key] !== "string" || !raw[key].trim()) diagnostics.push(finding("QA_CONFIG", `${pointer}.${key} 必填`));
  const evidenceRefs = strings(raw.evidenceRefs, `${pointer}.evidenceRefs`, diagnostics).map(normalizeRel);
  for (const [refIndex, rel] of evidenceRefs.entries()) {
    if (!rel || rel.startsWith("../") || path.isAbsolute(rel)) diagnostics.push(finding("QA_CONFIG", `${pointer}.evidenceRefs[${refIndex}] 必须是项目内相对路径`));
  }
  const activateAnyOf = strings(raw.activateAnyOf, `${pointer}.activateAnyOf`, diagnostics, { optional: true, allowEmpty: true });
  const requireAnyOf = strings(raw.requireAnyOf, `${pointer}.requireAnyOf`, diagnostics, { optional: true, allowEmpty: true });
  const forbidAnyOf = strings(raw.forbidAnyOf, `${pointer}.forbidAnyOf`, diagnostics, { optional: true, allowEmpty: true });
  if (requireAnyOf.length === 0 && forbidAnyOf.length === 0) diagnostics.push(finding("QA_CONFIG", `${pointer} 至少声明 requireAnyOf/forbidAnyOf 之一`));
  const severity = raw.severity || "error";
  if (!["error", "warn", "info"].includes(severity)) diagnostics.push(finding("QA_CONFIG", `${pointer}.severity 只允许 error/warn/info`));
  const safeReplacements = [];
  if (raw.safeReplacements !== undefined) {
    if (!Array.isArray(raw.safeReplacements)) diagnostics.push(finding("QA_CONFIG", `${pointer}.safeReplacements 必须是数组`));
    else raw.safeReplacements.forEach((item, replacementIndex) => {
      const replacement = validateReplacement(item, `${pointer}.safeReplacements[${replacementIndex}]`, diagnostics, evidenceRefs);
      if (replacement) safeReplacements.push(replacement);
    });
  }
  return { id: raw.id, module: raw.module, description: raw.description, evidenceRefs, activateAnyOf, requireAnyOf, forbidAnyOf, severity: ["error", "warn", "info"].includes(severity) ? severity : "error", message: raw.message, owner: raw.owner, sourceRef: raw.sourceRef, safeReplacements };
}

function validateConfig(raw) {
  const diagnostics = [];
  if (!isObject(raw)) return { ok: false, assertions: [], diagnostics: [finding("QA_CONFIG", "质量断言配置根节点必须是对象")] };
  const allowed = new Set(["schemaVersion", "assertions"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(finding("QA_CONFIG", `不支持配置项 ${key}`));
  if (raw.schemaVersion !== 1) diagnostics.push(finding("QA_CONFIG", "只支持 schemaVersion=1"));
  if (!Array.isArray(raw.assertions)) diagnostics.push(finding("QA_CONFIG", "assertions 必须是数组"));
  const assertions = Array.isArray(raw.assertions) ? raw.assertions.map((item, index) => validateAssertion(item, index, diagnostics)).filter(Boolean) : [];
  const seen = new Set();
  for (const item of assertions) { if (!item.id || seen.has(item.id)) diagnostics.push(finding("QA_CONFIG", `assertion id 重复或为空：${item.id || "<empty>"}`)); seen.add(item.id); }
  return { ok: diagnostics.length === 0, assertions, diagnostics };
}

function loadConfig(projectRootInput) {
  const file = path.join(path.resolve(projectRootInput), CONFIG_REL);
  if (!fs.existsSync(file)) return { ok: true, configured: false, assertions: [], diagnostics: [] };
  try { const raw = JSON.parse(fs.readFileSync(file, "utf8")); return { configured: true, raw, ...validateConfig(raw) }; }
  catch (error) { return { ok: false, configured: true, assertions: [], diagnostics: [finding("QA_CONFIG", `JSON 无法解析：${error.message}`)] }; }
}

function readEvidence(projectRoot, assertion) {
  const files = [];
  const missing = [];
  for (const rel of assertion.evidenceRefs) {
    try {
      const file = resolveWithin(projectRoot, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) missing.push(rel);
      else files.push({ rel, content: fs.readFileSync(file, "utf8") });
    } catch { missing.push(rel); }
  }
  return { files, missing, content: files.map((item) => item.content).join("\n") };
}

function affected(assertion, changedFiles) {
  if (!Array.isArray(changedFiles)) return true;
  const changed = new Set(changedFiles.map(normalizeRel));
  return changed.has(CONFIG_REL) || assertion.evidenceRefs.some((item) => changed.has(item));
}

function inspectOne(projectRoot, assertion) {
  const evidence = readEvidence(projectRoot, assertion);
  const activated = assertion.activateAnyOf.length === 0 || assertion.activateAnyOf.some((item) => evidence.content.includes(item));
  const requiredMatched = assertion.requireAnyOf.filter((item) => evidence.content.includes(item));
  const forbiddenMatched = assertion.forbidAnyOf.filter((item) => evidence.content.includes(item));
  const base = { severity: assertion.severity, assertionId: assertion.id, owner: assertion.owner, sourceRef: assertion.sourceRef, remediation: assertion.safeReplacements.length > 0 ? "auto-safe" : "manual-required" };
  const findings = [];
  if (evidence.missing.length > 0) findings.push(finding("QA_EVIDENCE_MISSING", `${assertion.id} 缺少证据文件：${evidence.missing.join(", ")}`, { ...base, file: evidence.missing[0] }));
  if (activated && assertion.requireAnyOf.length > 0 && requiredMatched.length === 0) findings.push(finding("QA_REQUIRED_EVIDENCE", `${assertion.id}: ${assertion.message}`, { ...base, file: assertion.evidenceRefs[0] }));
  if (activated && forbiddenMatched.length > 0) findings.push(finding("QA_FORBIDDEN_EVIDENCE", `${assertion.id}: ${assertion.message}`, { ...base, file: assertion.evidenceRefs[0] }));
  return { id: assertion.id, module: assertion.module, activated, passed: findings.length === 0, requiredMatched, forbiddenMatched, evidence: { files: evidence.files.map((item) => item.rel), missing: evidence.missing }, remediation: base.remediation, findings };
}

function inspectPolicyAssertions(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadConfig(projectRoot);
  if (!loaded.configured) return { schemaVersion: 1, ok: true, configured: false, state: "not-configured", assertions: [], findings: [], summary: { evaluated: 0, errors: 0, warnings: 0, autoSafe: 0 } };
  if (!loaded.ok) return { schemaVersion: 1, ok: false, configured: true, state: "invalid-config", assertions: [], findings: loaded.diagnostics, summary: { evaluated: 0, errors: loaded.diagnostics.length, warnings: 0, autoSafe: 0 } };
  const selected = loaded.assertions.filter((item) => (!options.module || item.module === options.module) && affected(item, options.changedFiles));
  const assertions = selected.map((item) => inspectOne(projectRoot, item));
  const findings = assertions.flatMap((item) => item.findings);
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return { schemaVersion: 1, ok: errors === 0, configured: true, state: findings.length > 0 ? "issues" : "passed", configHash: hashJson(loaded.raw), assertions, findings, summary: { evaluated: assertions.length, errors, warnings, autoSafe: assertions.filter((item) => !item.passed && item.remediation === "auto-safe").length } };
}

function count(content, value) {
  let total = 0; let cursor = 0;
  while (value && (cursor = content.indexOf(value, cursor)) >= 0) { total += 1; cursor += value.length; }
  return total;
}

function buildAssertionFixPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const loaded = loadConfig(projectRoot);
  if (!loaded.configured) return { ok: false, reason: "assertion-config-missing", actions: [] };
  if (!loaded.ok) return { ok: false, reason: "assertion-config-invalid", errors: loaded.diagnostics, actions: [] };
  const requested = Array.isArray(options.assertionIds) && options.assertionIds.length > 0 ? [...new Set(options.assertionIds)] : loaded.assertions.map((item) => item.id);
  const unknown = requested.filter((id) => !loaded.assertions.some((item) => item.id === id));
  if (unknown.length > 0) return { ok: false, reason: "assertion-not-found", unknown, actions: [] };
  const inspection = inspectPolicyAssertions(projectRoot, { module: options.module });
  const failing = new Set(inspection.assertions.filter((item) => !item.passed).map((item) => item.id));
  const manual = [];
  const byFile = new Map();
  for (const assertion of loaded.assertions.filter((item) => requested.includes(item.id) && failing.has(item.id))) {
    if (assertion.safeReplacements.length === 0) { manual.push({ assertionId: assertion.id, reason: "未声明项目批准的精确 safeReplacement" }); continue; }
    for (const replacement of assertion.safeReplacements) { if (!byFile.has(replacement.file)) byFile.set(replacement.file, []); byFile.get(replacement.file).push({ assertionId: assertion.id, ...replacement }); }
  }
  const actions = [];
  for (const [rel, replacements] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let file;
    try { file = resolveWithin(projectRoot, rel); } catch (error) { manual.push(...replacements.map((item) => ({ assertionId: item.assertionId, reason: error.message }))); continue; }
    if (!fs.existsSync(file)) { manual.push(...replacements.map((item) => ({ assertionId: item.assertionId, reason: `文件不存在：${rel}` }))); continue; }
    const before = fs.readFileSync(file, "utf8"); let after = before; const edits = []; let safe = true;
    for (const replacement of replacements) {
      const occurrences = count(after, replacement.before);
      if (occurrences !== 1) { manual.push({ assertionId: replacement.assertionId, reason: `${rel} 期望精确命中 1 次，实际 ${occurrences} 次` }); safe = false; continue; }
      after = after.replace(replacement.before, replacement.after); edits.push({ assertionId: replacement.assertionId, before: replacement.before, after: replacement.after });
    }
    if (!safe) {
      for (const edit of edits) manual.push({ assertionId: edit.assertionId, reason: `${rel} 与同文件不安全替换保持原子零写入` });
    } else if (after !== before) actions.push({ rel, file, beforeHash: hashBuffer(Buffer.from(before, "utf8")), afterHash: hashBuffer(Buffer.from(after, "utf8")), content: after, edits });
  }
  const planHash = hashJson({ generatorVersion: pkg.version, configHash: hashJson(loaded.raw), assertions: requested.sort(), actions: actions.map((item) => ({ rel: item.rel, beforeHash: item.beforeHash, afterHash: item.afterHash, assertions: item.edits.map((edit) => edit.assertionId) })), manual });
  return { ok: true, projectRoot, module: options.module || null, assertionIds: requested.sort(), actions, manual, before: inspection, planHash };
}

function publicAssertionFixPlan(plan) {
  if (!plan.ok) return plan;
  return { ok: true, mode: "preview", state: plan.actions.length > 0 ? "ready" : "manual-required", planHash: plan.planHash, assertionIds: plan.assertionIds, actions: plan.actions.map((item) => ({ rel: item.rel, beforeHash: item.beforeHash, afterHash: item.afterHash, edits: item.edits.map((edit) => ({ assertionId: edit.assertionId })) })), manual: plan.manual, safety: { exactMatchOnly: true, expectedOccurrences: 1, backup: true, reinspection: true, rollbackOnFailure: true } };
}

function applyAssertionFixPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, reason: plan.reason, applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  const guarded = guardResult(plan.projectRoot, options); if (guarded) return guarded;
  const fresh = buildAssertionFixPlan(plan.projectRoot, { assertionIds: plan.assertionIds, module: plan.module });
  if (!fresh.ok || fresh.planHash !== plan.planHash) return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  if (fresh.actions.length === 0) return { ok: false, reason: "nothing-safe-to-apply", manual: fresh.manual, applied: [] };
  for (const action of fresh.actions) if (!fs.existsSync(action.file) || hashFile(action.file) !== action.beforeHash) return { ok: false, reason: "plan-changed", applied: [] };
  const backupId = fresh.planHash.slice(0, 16); const backups = [];
  try {
    for (const action of fresh.actions) { const backup = resolveWithin(fresh.projectRoot, `.wl-skills-bd/.state/assertion-fix-backups/${backupId}/${action.rel}`); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(action.file, backup); backups.push({ source: action.file, backup }); }
    for (const action of fresh.actions) writeTextAtomic(action.file, action.content, { projectRoot: fresh.projectRoot });
    const after = inspectPolicyAssertions(fresh.projectRoot, { module: fresh.module });
    const remaining = after.assertions.filter((item) => fresh.assertionIds.includes(item.id) && !item.passed);
    const beforeFingerprints = new Set(fresh.before.findings.map((item) => item.fingerprint));
    const regressions = after.findings.filter((item) => !beforeFingerprints.has(item.fingerprint) && !remaining.some((value) => value.id === item.assertionId));
    if (remaining.length > 0 || regressions.length > 0) throw new Error(`复验未闭环：remaining=${remaining.length}, regressions=${regressions.length}`);
    return { ok: true, state: "completed", planHash: fresh.planHash, backupId, applied: fresh.actions.map((item) => ({ rel: item.rel, edits: item.edits.map((edit) => edit.assertionId) })), closure: { remaining: 0, regressions: 0, reinspection: after.summary } };
  } catch (error) {
    let rollbackError = null;
    for (const item of backups) try { fs.copyFileSync(item.backup, item.source); } catch (cause) { rollbackError = cause.message; }
    return { ok: false, reason: rollbackError ? "verification-failed-rollback-failed" : "verification-failed-rolled-back", message: error.message, rollbackError, applied: [] };
  }
}

module.exports = { CONFIG_REL, applyAssertionFixPlan, buildAssertionFixPlan, inspectPolicyAssertions, loadConfig, publicAssertionFixPlan, validateConfig };
