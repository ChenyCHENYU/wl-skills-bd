"use strict";

const path = require("path");
const catalog = require("../files/.wl-skills-bd/rules/catalog.json");
const { inspectIntegrationAdapters } = require("./integration-adapter");
const { inspectPolicyAssertions, buildAssertionFixPlan, publicAssertionFixPlan } = require("./policy-assertions");
const { buildFixPlan, publicFixPlan } = require("./safe-fix");

const RULES = new Map(catalog.rules.map((item) => [item.id, item]));

function adviseRepairs(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const sourcePlan = buildFixPlan(projectRoot, { scanRel: options.scanRel, rules: options.rules });
  const safeFingerprints = new Set(sourcePlan.ok
    ? sourcePlan.actions.flatMap((action) => action.edits.map((edit) => `${edit.rule}:${action.rel}:${edit.line}`))
    : []);
  const source = [];
  if (sourcePlan.ok) for (const item of sourcePlan.selected) {
    const exact = safeFingerprints.has(`${item.rule}:${item.file}:${item.line}`);
    const definition = RULES.get(item.rule);
    source.push({
      rule: item.rule,
      file: item.file,
      line: item.line,
      fingerprint: item.fingerprint,
      remediation: exact ? "auto-safe" : definition && definition.fix === "suggested" ? "patch-suggested" : "manual-required",
      reason: exact ? "已通过内置确定性前置条件" : (sourcePlan.manual.find((value) => value.fingerprint === item.fingerprint) || {}).reason || "需要业务或平台语义确认",
    });
  }
  const assertionInspection = inspectPolicyAssertions(projectRoot, { module: options.module });
  const failingIds = assertionInspection.assertions.filter((item) => !item.passed).map((item) => item.id);
  const assertionPlan = buildAssertionFixPlan(projectRoot, { assertionIds: failingIds, module: options.module });
  const actionableAssertions = new Set(assertionPlan.ok
    ? assertionPlan.actions.flatMap((action) => action.edits.map((edit) => edit.assertionId))
    : []);
  const policy = assertionInspection.assertions.filter((item) => !item.passed).map((item) => ({
    assertionId: item.id,
    remediation: actionableAssertions.has(item.id) ? "auto-safe" : "manual-required",
    evidence: item.evidence,
  }));
  const adapters = inspectIntegrationAdapters(projectRoot, { module: options.module });
  const integration = adapters.bindings.filter((item) => item.findings.length > 0).map((item) => ({
    bindingId: item.id,
    adapterId: item.adapterId,
    maturity: item.maturity,
    remediation: "platform-template-or-manual",
    missingStages: item.requiredStages.filter((stage) => !item.stages[stage]),
    missingCapabilities: Object.entries(item.capabilities).filter(([, value]) => !value.ok).map(([key]) => key),
  }));
  const summary = {
    autoSafe: source.filter((item) => item.remediation === "auto-safe").length + policy.filter((item) => item.remediation === "auto-safe").length,
    suggested: source.filter((item) => item.remediation === "patch-suggested").length,
    manual: source.filter((item) => item.remediation === "manual-required").length + policy.filter((item) => item.remediation === "manual-required").length,
    platformAdapter: integration.length,
  };
  return {
    schemaVersion: 1,
    ok: true,
    summary,
    source,
    policy,
    integration,
    plans: {
      source: sourcePlan.ok ? publicFixPlan(sourcePlan) : sourcePlan,
      policy: assertionPlan.ok ? publicAssertionFixPlan(assertionPlan) : assertionPlan,
    },
    safety: {
      autoApply: ["B3", "B5", "project-approved exact safeReplacement"],
      suggestedNeverAutoApplies: true,
      businessSemanticsManual: true,
    },
  };
}

module.exports = { adviseRepairs };
