"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const configFix = require("../lib/config-fix");
const configInit = require("../lib/config-init");
const permissionExport = require("../lib/permission-export");

const ROOT = path.resolve(__dirname, "..");
const contractFile = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  process.env[name] = value;
  try { return fn(); } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
}

const permissionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-permission-chain-"));
try {
  const plan = permissionExport.buildPermissionExportPlan(contractFile, { projectRoot: permissionRoot });
  assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
  assert.strictEqual(fs.existsSync(plan.destination), false, "permission preview 必须零写入");
  assert.strictEqual(permissionExport.applyPermissionExportPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  withEnv("WL_PROJECT_ENV", "pre", () => {
    const blocked = permissionExport.applyPermissionExportPlan(plan, { confirm: true, planHash: plan.planHash });
    assert.strictEqual(blocked.reason, "production-write-guard");
    assert.strictEqual(fs.existsSync(plan.destination), false);
  });
  const applied = permissionExport.applyPermissionExportPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);
  assert.ok(fs.existsSync(plan.destination));

  const updatePlan = permissionExport.buildPermissionExportPlan(contractFile, { projectRoot: permissionRoot });
  fs.appendFileSync(updatePlan.destination, "\nlocal drift\n", "utf8");
  const drifted = permissionExport.applyPermissionExportPlan(updatePlan, { confirm: true, planHash: updatePlan.planHash });
  assert.strictEqual(drifted.reason, "plan-changed");
} finally {
  fs.rmSync(permissionRoot, { recursive: true, force: true });
}

const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-config-chain-"));
try {
  const configFile = path.join(configRoot, "src", "main", "resources", "application.yml");
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, "spring:\n  datasource:\n    password: dangerous-secret\n", "utf8");
  const plan = configFix.buildFixPlan(configRoot);
  withEnv("WL_PROJECT_ENV", "production", () => {
    const blocked = configFix.applyFixPlan(plan, { projectRoot: configRoot, confirm: true, planHash: plan.planHash });
    assert.strictEqual(blocked.reason, "production-write-guard");
    assert.match(fs.readFileSync(configFile, "utf8"), /dangerous-secret/);
  });

  const initPlan = configInit.buildInitPlan(configRoot, { project: "wl-sale", module: "sale", port: 10000, datasourceType: "oracle", customer: "internal" });
  fs.writeFileSync(path.join(configRoot, ".gitignore"), "changed-after-preview\n", "utf8");
  const initBlocked = configInit.applyInitPlan(initPlan, { projectRoot: configRoot, confirm: true, planHash: initPlan.planHash });
  assert.strictEqual(initBlocked.reason, "plan-changed");
  assert.strictEqual(fs.existsSync(path.join(configRoot, "src", "main", "resources", "bootstrap.yml")), false, "计划漂移后必须零写入");
} finally {
  fs.rmSync(configRoot, { recursive: true, force: true });
}

console.log("✅ write chain：permission/config 的 preview、planHash、漂移阻断、pre/prod 护栏和零写入通过");
