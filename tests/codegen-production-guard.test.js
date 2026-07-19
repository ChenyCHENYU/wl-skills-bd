"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyPlan, buildPlan, detectEnvironment, isProductionGuardBlocked } = require("../lib/codegen");

const ROOT = path.resolve(__dirname, "..");
const contractFile = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");

function withEnv(env, value, fn) {
  const old = process.env[env];
  process.env[env] = value;
  try { fn(); } finally { if (old === undefined) delete process.env[env]; else process.env[env] = old; }
}

// ─── detectEnvironment 优先级 ───
assert.strictEqual(detectEnvironment(os.tmpdir(), { environment: "prod" }), "prod", "contract.environment=prod 优先");
assert.strictEqual(detectEnvironment(os.tmpdir(), { environment: "dev" }), "dev", "contract.environment=dev 透传");
assert.strictEqual(detectEnvironment(os.tmpdir(), null), null, "无任何信号返回 null");

withEnv("WL_PROJECT_ENV", "prod", () => {
  assert.strictEqual(detectEnvironment(os.tmpdir(), null), "prod", "WL_PROJECT_ENV=prod");
});
withEnv("SPRING_PROFILES_ACTIVE", "prod", () => {
  assert.strictEqual(detectEnvironment(os.tmpdir(), null), "prod", "SPRING_PROFILES_ACTIVE=prod");
});

// ─── isProductionGuardBlocked ───
assert.strictEqual(isProductionGuardBlocked("prod"), true, "prod 默认阻断");
assert.strictEqual(isProductionGuardBlocked("production"), true, "production 别名也必须阻断");
assert.strictEqual(isProductionGuardBlocked("pre"), true, "pre 预发布环境默认阻断");
assert.strictEqual(isProductionGuardBlocked("dev"), false, "dev 不阻断");
assert.strictEqual(isProductionGuardBlocked(null), false, "无环境不阻断");
assert.strictEqual(isProductionGuardBlocked("prod", true), false, "MCP 显式授权后不阻断");
withEnv("WL_ALLOW_PRODUCTION_WRITES", "true", () => {
  assert.strictEqual(isProductionGuardBlocked("prod"), false, "显式授权后不阻断");
});

// ─── applyPlan 在 prod 环境阻断 ───
function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-prodguard-"));
}

let tempRoot = freshRoot();
try {
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  assert.strictEqual(plan.ok, true);

  withEnv("WL_PROJECT_ENV", "prod", () => {
    const blocked = applyPlan(plan, { confirm: true, planHash: plan.planHash });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason, "production-write-guard");
    assert.strictEqual(blocked.environment, "prod");
    assert.strictEqual(fs.existsSync(path.join(tempRoot, ".wl-skills-bd", ".state", "codegen-manifest.json")), false, "生产护栏阻断时零写入");
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

tempRoot = freshRoot();
try {
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  withEnv("WL_PROJECT_ENV", "prod", () => {
    withEnv("WL_ALLOW_PRODUCTION_WRITES", "true", () => {
      const allowed = applyPlan(plan, { confirm: true, planHash: plan.planHash });
      assert.strictEqual(allowed.ok, true, "显式授权后允许写");
    });
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

tempRoot = freshRoot();
try {
  const plan = buildPlan(contractFile, { projectRoot: tempRoot });
  withEnv("WL_PROJECT_ENV", "dev", () => {
    const devApplied = applyPlan(plan, { confirm: true, planHash: plan.planHash });
    assert.strictEqual(devApplied.ok, true, "dev 环境正常写入");
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("✅ codegen 受保护环境护栏：environment 识别、pre/prod 默认阻断、显式授权与零写入通过");
