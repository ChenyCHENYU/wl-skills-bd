"use strict";

const pkg = require("../package.json");
const fs = require("fs");
const path = require("path");
const router = require("./task-router");
const observation = require("./task-observability.cjs");

function options(projectRoot, extra = {}) {
  return { projectRoot, packageName: pkg.name, packageVersion: pkg.version, storageDir: ".wl-skills-bd/runs", targets: [], ruleFiles: [".wl-skills-bd/rules/catalog.json"].filter((item) => fs.existsSync(path.join(projectRoot, item))), configFiles: [".wl-skills-bd/contracts/wl-delivery-profile.v1.json", ".wl-skills-bd/config.json", ".wl-skills-bd/profile.local.json"].filter((item) => fs.existsSync(path.join(projectRoot, item))), ...extra };
}

function task(projectRoot, input, extra = {}) {
  const routed = router.classifyTask(input, extra.type, { targets: extra.targets || [] });
  const selected = routed.task;
  const preflight = selected ? router.buildPreflightEvidence(selected, projectRoot) : null;
  const missing = preflight ? [...preflight.skills, ...preflight.standards].filter((item) => item.state === "missing") : [];
  const skillFiles = preflight ? preflight.skills.filter((item) => item.file).map((item) => item.file) : [];
  const gaps = routed.status === "gap" ? [{ kind: "skill", reason: routed.reasons.join(", "), suggestion: "为该后端任务补充有明确输入、负向边界和验证器的 Skill/规则；待评审后安装，禁止自动生效" }] : [];
  if (missing.length) gaps.push({ kind: "asset", reason: "required-canonical-files-missing", suggestion: "修复本包安装缺失后重新判定，不借用其他包同名规则" });
  if (selected && selected.id === "extract-business-doc") gaps.push({ kind: "check", reason: "skeleton-skill-without-semantic-executor", suggestion: "补充业务文档来源与语义核验流程；当前抽取结论由人工确认" });
  const missingContract = Boolean(selected?.requiresContract && !fs.existsSync(path.join(projectRoot, "wl-contract.json")));
  const requiredChecks = selected ? [...selected.rules, ...selected.javaGates] : [];
  if (selected && !requiredChecks.length) requiredChecks.push(selected.id === "project-context" ? "catalog-context-boundary" : selected.id === "config-op" ? "config-doctor" : "business-document-review");
  const decisionStatus = gaps.length ? "gap" : missingContract ? "needs-context" : routed.status;
  const decision = {
    recordVersion: 1,
    applicable: decisionStatus === "needs-context" ? null : decisionStatus !== "not-applicable",
    status: decisionStatus,
    routingStatus: routed.status,
    reasons: [...routed.reasons, ...(missing.length ? ["required-canonical-files-missing"] : []), ...(missingContract ? ["required-contract-input-not-created"] : [])],
    selectedSkills: selected ? selected.skills : [],
    requiredFiles: [...skillFiles, ...(preflight ? preflight.standards.filter((item) => item.file).map((item) => item.file) : [])],
    requiredRules: selected ? selected.rules.length ? selected.rules : requiredChecks : [],
    baselineRules: routed.status === "baseline" && selected ? selected.rules : [],
    ruleDetails: selected ? requiredChecks.map((id) => { const rule = require("../files/.wl-skills-bd/rules/catalog.json").rules.find((entry) => entry.id === id); return { id, name: rule?.title || `${selected.name}工作流约束（${id}）`, source: rule ? ".wl-skills-bd/rules/catalog.json" : skillFiles[0] || null }; }) : [],
    missingInputs: [...missing.map((item) => item.name || item.id), ...(missingContract ? ["wl-contract.json"] : [])],
    selectionEvidence: "deterministic-routing",
    hostDiscovery: "unverified",
    contentLoaded: "unverified",
    candidates: routed.candidates,
    applicableRules: selected ? selected.rules : [],
    requiredChecks,
    gaps,
    unverified: ["host-discovery", "model-selected-skill", "model-read-canonical-files", "planned-actions-not-executed", ...requiredChecks],
  };
  const state = extra.persist === false ? {} : observation.startTask({ ...options(projectRoot, { ...extra, targets: extra.targets || [] }), task: input || `task-type:${extra.type}`, decision });
  return observation.attachNotice({ ok: !["gap", "ambiguous"].includes(decision.status), ready: Boolean(preflight && preflight.ready && !gaps.length && !missingContract), ...state, decision, ...(selected ? { taskId: selected.id, taskName: selected.name, mode: selected.mode, requiresContract: selected.requiresContract, rules: selected.rules, javaGates: selected.javaGates, skills: selected.skills, standards: selected.standards, steps: selected.steps, tools: selected.tools, pipeline: { ...router.buildTaskPipeline(selected), executionStatus: "planned", nodes: router.buildTaskPipeline(selected).nodes.map((node) => ({ ...node, state: "planned" })) }, preflight } : {}), executionStatus: "not-executed" }, options(projectRoot, { originalTargets: extra.targets || [] }));
}

function status(projectRoot, extra = {}) { return observation.readStatus(options(projectRoot, extra)); }
function doctorHost(projectRoot, host = "codex") {
  const capabilities = require("../files/.wl-skills-bd/capabilities.json");
  const skillPaths = capabilities.skills.items.map((item) => `${item.installedPath}/SKILL.md`);
  return observation.doctorHost({ ...options(projectRoot), host, entryFiles: host === "claude" ? ["CLAUDE.md"] : host === "copilot" ? [".github/copilot-instructions.md"] : ["AGENTS.md"], skillPaths: [...new Set(skillPaths)], gatewayPath: ".agents/skills/wl-skills-bd/SKILL.md" });
}

function checkTargets(projectRoot, scope) {
  return [scope || ".", ".be-rules-ignore", ".wl-skills-bd/profile.local.json", ".wl-skills-bd/contracts/wl-delivery-profile.v1.json"].filter((relative, index) => index === 0 || fs.existsSync(path.resolve(projectRoot, relative)));
}

function validationStart(projectRoot, extra = {}) {
  return observation.beginExecution({ ...options(projectRoot, { ...extra, ruleFiles: [".wl-skills-bd/rules/catalog.json", ".github/standards/index.md"], configFiles: [".wl-skills-bd/contracts/wl-delivery-profile.v1.json", ".wl-skills-bd/config.json", ".wl-skills-bd/profile.local.json"].filter((item) => fs.existsSync(path.join(projectRoot, item))) }), tool: "backend-rule-validator", readOnlyVerification: true });
}
function reviewFinish(handle, result) {
  const execution = result.ruleCoverage ? { executedRules: result.ruleCoverage.evaluatedRules, skippedRules: result.ruleCoverage.skippedRules } : null;
  const checks = execution ? [...(execution.rules || execution.executedRules || []).map((id) => ({ id, status: (result._allFindings || []).some((item) => item.rule === id && item.severity === "error") ? "fail" : "pass" })), ...(execution.skippedRules || []).map((item) => ({ id: item.rule || item.id || item, status: "skip", reason: item.reason || "not-executed" }))] : [];
  return observation.finishExecution(handle, { exitCode: result.ok ? 0 : 1, validationStatus: result.ok ? "partial" : "failed", checks, checkedFiles: result._checkedFiles || [], summary: { reviewDecision: result.decision || result.reason, javaGates: "unverified", qualityGate: result.qualityGate?.summary || null }, artifacts: [] });
}

function validationFinish(handle, result, exitCode) {
  const executed = result.execution.executedRules;
  const skipped = result.execution.skippedRules;
  return observation.finishExecution(handle, {
    exitCode,
    validationStatus: result.stats.error ? "failed" : result.coverage.status === "complete" ? "passed" : "partial",
    checks: [...executed.map((id) => ({ id, status: result.issues.some((item) => item.rule === id && item.severity === "error") ? "fail" : "pass" })), ...skipped.map((item) => ({ id: item.rule || item.id || item, status: "skip", reason: item.reason || "not-executed" }))],
    checkedFiles: result.execution.checkedFiles || [],
    summary: { ...result.stats, coverage: result.coverage.status, javaGates: "unverified" },
    artifacts: [],
  });
}

module.exports = { checkTargets, reviewFinish, doctorHost, observation, options, status, task, validationFinish, validationStart };
