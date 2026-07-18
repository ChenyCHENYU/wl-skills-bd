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

try {
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.actions.length, 16);
  assert.strictEqual(plan.completion.contractStatus, "confirmed");
  assert.deepStrictEqual(plan.summary, { add: 16 });
  assert.strictEqual(buildPlan(contractFile, { projectRoot: tempRoot }).planHash, plan.planHash, "相同输入必须得到相同 planHash");

  assert.strictEqual(applyPlan(plan, { planHash: plan.planHash }).reason, "confirm-required");
  assert.strictEqual(applyPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  assert.strictEqual(fs.existsSync(path.join(tempRoot, STATE_REL)), false, "未确认时必须零写入");

  const applied = applyPlan(plan, { confirm: true, planHash: plan.planHash, requireComplete: true });
  assert.strictEqual(applied.ok, true);
  assert.strictEqual(applied.applied.length, 16);
  assert.strictEqual(fs.existsSync(path.join(tempRoot, STATE_REL)), true);

  const stablePlan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.deepStrictEqual(stablePlan.summary, { unchanged: 16 });
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
}

console.log("✅ codegen：16 产物、确定性、确认门、冲突保护、强制备份与失败整批回滚通过");
