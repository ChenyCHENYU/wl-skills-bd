"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { applyAssertionFixPlan, buildAssertionFixPlan, inspectPolicyAssertions, loadConfig, publicAssertionFixPlan } = require("../lib/policy-assertions");

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "wls-qa-")); }
function write(project, rel, content) { const file = path.join(project, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, "utf8"); }

function configure(project, replacement = false) {
  write(project, ".wl-skills-bd/quality-assertions.json", JSON.stringify({
    schemaVersion: 1,
    assertions: [{
      id: "PLATFORM_TIMEOUT", module: "order", description: "平台客户端必须使用超时策略",
      evidenceRefs: ["src/main/java/RemoteClient.java"], activateAnyOf: ["PlatformHttpClient"],
      requireAnyOf: ["TimeoutPolicy.DEFAULT"], forbidAnyOf: ["TimeoutPolicy.NONE"], severity: "error",
      message: "缺少平台批准的超时边界", owner: "platform-team", sourceRef: "PLATFORM-HTTP-1",
      safeReplacements: replacement ? [{ file: "src/main/java/RemoteClient.java", before: "TimeoutPolicy.NONE", after: "TimeoutPolicy.DEFAULT", expectedOccurrences: 1 }] : [],
    }],
  }, null, 2));
}

test("通用边界要求完全由项目断言驱动，未配置时不主观扫描", () => {
  const project = root(); write(project, "src/main/java/RemoteClient.java", "PlatformHttpClient client;");
  const result = inspectPolicyAssertions(project);
  assert.equal(result.ok, true); assert.equal(result.state, "not-configured");
});

test("精确断言输出证据、所有者和人工修复分级", () => {
  const project = root(); configure(project, false); write(project, "src/main/java/RemoteClient.java", "PlatformHttpClient client;");
  const result = inspectPolicyAssertions(project, { module: "order" });
  assert.equal(result.ok, false); assert.equal(result.assertions[0].remediation, "manual-required"); assert.equal(result.findings[0].owner, "platform-team");
});

test("项目批准的单次精确替换经过 planHash、复验和回滚边界", () => {
  const project = root(); configure(project, true); write(project, "src/main/java/RemoteClient.java", "PlatformHttpClient client = create(TimeoutPolicy.NONE);");
  const plan = buildAssertionFixPlan(project, { assertionIds: ["PLATFORM_TIMEOUT"] });
  assert.equal(plan.ok, true); assert.equal(plan.actions.length, 1); assert.equal(publicAssertionFixPlan(plan).safety.exactMatchOnly, true);
  assert.equal(applyAssertionFixPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  const applied = applyAssertionFixPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.equal(applied.ok, true); assert(fs.readFileSync(path.join(project, "src/main/java/RemoteClient.java"), "utf8").includes("TimeoutPolicy.DEFAULT")); assert.equal(inspectPolicyAssertions(project).ok, true);
});

test("精确替换命中次数不唯一时降级人工且零写入", () => {
  const project = root(); configure(project, true); write(project, "src/main/java/RemoteClient.java", "PlatformHttpClient + TimeoutPolicy.NONE + TimeoutPolicy.NONE");
  const before = fs.readFileSync(path.join(project, "src/main/java/RemoteClient.java"), "utf8");
  const plan = buildAssertionFixPlan(project, { assertionIds: ["PLATFORM_TIMEOUT"] });
  assert.equal(plan.actions.length, 0); assert(plan.manual[0].reason.includes("实际 2 次")); assert.equal(fs.readFileSync(path.join(project, "src/main/java/RemoteClient.java"), "utf8"), before);
});

test("同文件任一替换不安全时整文件保持原子零写入并完整列出人工项", () => {
  const project = root();
  write(project, ".wl-skills-bd/quality-assertions.json", JSON.stringify({
    schemaVersion: 1,
    assertions: [
      { id: "PLATFORM_TIMEOUT", module: "order", description: "timeout", evidenceRefs: ["src/main/java/RemoteClient.java"], activateAnyOf: ["PlatformHttpClient"], requireAnyOf: ["TimeoutPolicy.DEFAULT"], forbidAnyOf: ["TimeoutPolicy.NONE"], severity: "error", message: "timeout", owner: "platform", sourceRef: "P-1", safeReplacements: [{ file: "src/main/java/RemoteClient.java", before: "TimeoutPolicy.NONE", after: "TimeoutPolicy.DEFAULT" }] },
      { id: "PLATFORM_RETRY", module: "order", description: "retry", evidenceRefs: ["src/main/java/RemoteClient.java"], activateAnyOf: ["PlatformHttpClient"], requireAnyOf: ["RetryPolicy.SAFE"], forbidAnyOf: ["RetryPolicy.NONE"], severity: "error", message: "retry", owner: "platform", sourceRef: "P-2", safeReplacements: [{ file: "src/main/java/RemoteClient.java", before: "RetryPolicy.NONE", after: "RetryPolicy.SAFE" }] },
    ],
  }, null, 2));
  const original = "PlatformHttpClient TimeoutPolicy.NONE RetryPolicy.NONE RetryPolicy.NONE";
  write(project, "src/main/java/RemoteClient.java", original);
  const plan = buildAssertionFixPlan(project, { assertionIds: ["PLATFORM_TIMEOUT", "PLATFORM_RETRY"] });
  assert.equal(plan.actions.length, 0);
  assert.deepEqual(new Set(plan.manual.map((item) => item.assertionId)), new Set(["PLATFORM_TIMEOUT", "PLATFORM_RETRY"]));
  assert.equal(fs.readFileSync(path.join(project, "src/main/java/RemoteClient.java"), "utf8"), original);
});

test("畸形 safeReplacement 路径返回配置诊断", () => {
  const project = root();
  configure(project, true);
  const file = path.join(project, ".wl-skills-bd/quality-assertions.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.assertions[0].safeReplacements[0].file = 42;
  fs.writeFileSync(file, JSON.stringify(raw), "utf8");
  const loaded = loadConfig(project);
  assert.equal(loaded.ok, false);
  assert(loaded.diagnostics.some((item) => item.message.includes("safeReplacements")));
});
