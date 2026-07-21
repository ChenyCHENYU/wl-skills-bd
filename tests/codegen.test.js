"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyPlan, buildPlan, STATE_REL } = require("../lib/codegen");

const ROOT = path.resolve(__dirname, "..");
const contractFile = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-codegen-"));
const rollbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-codegen-rollback-"));
const assuranceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-skills-bd-codegen-assurance-"));

try {
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.actions.length, 17);
  assert.strictEqual(plan.completion.contractStatus, "confirmed");
  assert.deepStrictEqual(plan.summary, { add: 17 });
  assert.strictEqual(buildPlan(contractFile, { projectRoot: tempRoot }).planHash, plan.planHash, "相同输入必须得到相同 planHash");

  assert.strictEqual(applyPlan(plan, { planHash: plan.planHash }).reason, "confirm-required");
  assert.strictEqual(applyPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  assert.strictEqual(fs.existsSync(path.join(tempRoot, STATE_REL)), false, "未确认时必须零写入");

  const assuranceContract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
  assuranceContract.assurance = {
    level: "production",
    criticality: "core",
    slo: { availabilityPercent: 99.9, p95LatencyMs: 500, p99LatencyMs: 1000, maxErrorRatePercent: 0.1 },
    recovery: { rtoMinutes: 60, rpoMinutes: 15 },
    security: { authorizationModel: "tenant-data-scope", methodSecurityRequired: true, auditRequired: true },
    dataGovernance: { owner: "主数据团队", sourceOfTruth: "feature-category", classificationDefault: "internal", retentionPolicy: "按企业主数据保留策略执行" },
    consistency: { idempotencyStrategy: "business-key", eventDelivery: "none", crossServiceTransaction: "none" },
    resilience: { dependencyTimeoutMs: 3000, retryMaxAttempts: 1, circuitBreakerRequired: true, rateLimitRequired: true },
    evidence: {
      threatModelRef: "docs/evidence/threat-model.md",
      authorizationReviewRef: "docs/evidence/authorization-review.md",
      loadTestRef: "docs/evidence/load-test.md",
      runbookRef: "docs/evidence/runbook.md",
      restoreDrillRef: "docs/evidence/restore-drill.md",
      dataReviewRef: "docs/evidence/data-review.md",
    },
  };
  const assuranceContractFile = path.join(assuranceRoot, "feature-category.contract.json");
  fs.writeFileSync(assuranceContractFile, `${JSON.stringify(assuranceContract, null, 2)}\n`, "utf8");
  const missingEvidencePlan = buildPlan(assuranceContractFile, { projectRoot: assuranceRoot });
  assert.strictEqual(missingEvidencePlan.ok, true, JSON.stringify(missingEvidencePlan.errors));
  assert.strictEqual(missingEvidencePlan.completion.contractStatus, "draft");
  assert.strictEqual(missingEvidencePlan.assuranceEvidence.missing.length, 6);
  assert.strictEqual(
    applyPlan(missingEvidencePlan, { confirm: true, planHash: missingEvidencePlan.planHash, requireComplete: true }).reason,
    "contract-incomplete",
    "生产证据缺失时 requireComplete 必须零写入",
  );
  for (const rel of Object.values(assuranceContract.assurance.evidence)) {
    const file = path.join(assuranceRoot, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# ${path.basename(file)}\n\n已评审证据。\n`, "utf8");
  }
  const readyEvidencePlan = buildPlan(assuranceContractFile, { projectRoot: assuranceRoot });
  assert.strictEqual(readyEvidencePlan.completion.contractStatus, "confirmed");
  assert.strictEqual(readyEvidencePlan.assuranceEvidence.ok, true);
  assert.strictEqual(applyPlan(readyEvidencePlan, {
    confirm: true,
    planHash: readyEvidencePlan.planHash,
    requireComplete: true,
  }).ok, true, "生产证据齐备后才允许通过完成门");

  const applied = applyPlan(plan, { confirm: true, planHash: plan.planHash, requireComplete: true });
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(applied.applied.length, 17);
  assert.strictEqual(fs.existsSync(path.join(tempRoot, STATE_REL)), true);

  const stablePlan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.deepStrictEqual(stablePlan.summary, { unchanged: 17 });
  assert.strictEqual(buildPlan(contractFile, { projectRoot: tempRoot }).planHash, stablePlan.planHash);

  const modified = stablePlan.actions.find((item) => item.rel.endsWith("Controller.java"));
  const untouched = stablePlan.actions.find((item) => item.rel.endsWith("Mapper.java"));
  const untouchedBefore = fs.readFileSync(untouched.destination, "utf8");
  fs.appendFileSync(modified.destination, "// local change\n", "utf8");
  const conflictPlan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(conflictPlan.summary.conflict, 1);
  const blocked = applyPlan(conflictPlan, { confirm: true, planHash: conflictPlan.planHash });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.applied.length, 0);
  assert.strictEqual(fs.readFileSync(untouched.destination, "utf8"), untouchedBefore, "冲突时不得部分写入");

  const forced = applyPlan(conflictPlan, { confirm: true, force: true, planHash: conflictPlan.planHash });
  assert.strictEqual(forced.ok, true);
  assert.ok(fs.existsSync(path.join(tempRoot, ".wl-skills-bd", ".state", "codegen-backups", forced.backupId, modified.rel)));
  assert.doesNotMatch(fs.readFileSync(modified.destination, "utf8"), /local change/);

  const rollbackPlan = buildPlan(contractFile, { projectRoot: rollbackRoot });
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (source, destination) => {
    renameCount += 1;
    if (renameCount === 4) throw new Error("injected write failure");
    return originalRename(source, destination);
  };
  let rolledBack;
  try {
    rolledBack = applyPlan(rollbackPlan, {
      confirm: true,
      planHash: rollbackPlan.planHash,
    });
  } finally {
    fs.renameSync = originalRename;
  }
  assert.strictEqual(rolledBack.ok, false);
  assert.strictEqual(rolledBack.reason, "write-failed-rolled-back");
  assert.strictEqual(rolledBack.rolledBack, true);
  assert.deepStrictEqual(rolledBack.applied, []);
  for (const action of rollbackPlan.actions) {
    assert.strictEqual(fs.existsSync(action.destination), false, `失败后不得残留 ${action.rel}`);
    assert.strictEqual(fs.existsSync(`${action.destination}.${process.pid}.tmp`), false, `失败后不得残留临时文件 ${action.rel}`);
  }
  assert.strictEqual(fs.existsSync(path.join(rollbackRoot, STATE_REL)), false, "失败后不得写入 codegen state");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(rollbackRoot, { recursive: true, force: true });
  fs.rmSync(assuranceRoot, { recursive: true, force: true });
}

console.log("✅ codegen：17 产物、确定性、确认门、冲突保护、强制备份与失败整批回滚通过");
