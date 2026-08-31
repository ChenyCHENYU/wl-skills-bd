"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { spawnSync } = require("child_process");

const cli = path.resolve(__dirname, "..", "bin", "wl-skills-bd.js");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("review/integration/fix CLI 复用同一平台适配与安全写链", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wls-review-cli-"));
  try {
    let result = run(["integration", "adapters", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).readiness, "not-configured");

    write(root, ".wl-skills-bd/integration-adapters.json", JSON.stringify({
      schemaVersion: 1,
      adapters: [{
        id: "team-wrapper",
        provider: "team-platform",
        displayName: "团队消息封装",
        contractTransports: ["team-mq"],
        detector: { dependencies: [{ groupId: "com.acme", artifactId: "team-mq-starter" }] },
        qualityGate: {
          inbound: { requiredStages: ["declared", "dependency"], requiredCapabilities: [], severity: "error" },
          outbound: { requiredStages: [], requiredCapabilities: [], severity: "error" },
        },
        implementationRecipes: [{ id: "consumer", direction: "inbound", templateRef: "templates/Consumer.java.tmpl", output: "generated/{{variables.className}}.java", requiredVariables: ["className"] }],
      }],
      bindings: [{ id: "order-created", module: "order", adapterId: "team-wrapper", direction: "inbound", contractRef: "contracts/order.json", integrationId: "ORDER_CREATED", sourceRefs: [], configRefs: [], testRefs: [], runtimeEvidenceRefs: [], requiredCapabilities: [] }],
    }, null, 2));
    write(root, "pom.xml", "<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>team-mq-starter</artifactId></dependency></dependencies></project>");
    write(root, "contracts/order.json", JSON.stringify({ integrations: [{ id: "ORDER_CREATED", direction: "inbound", transport: "team-mq" }] }));
    write(root, "templates/Consumer.java.tmpl", "package generated;\npublic final class {{variables.className}} {}\n");

    result = run(["integration", "plan", "--binding", "order-created", "--recipe", "consumer", "--var", "className=OrderConsumer", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const implementationPlan = JSON.parse(result.stdout);
    assert.equal(implementationPlan.safety.newFilesOnly, true);
    assert.equal(fs.existsSync(path.join(root, "generated/OrderConsumer.java")), false);

    result = run(["integration", "apply", "--binding", "order-created", "--recipe", "consumer", "--var", "className=OrderConsumer", "--plan-hash", implementationPlan.planHash, "--confirm", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).state, "applied-verified");
    assert.equal(fs.existsSync(path.join(root, "generated/OrderConsumer.java")), true);

    result = run(["review", "run", "--module", "order", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ruleCoverage.status, "complete");

    result = run(["fix", "advise", "--module", "order", "--rules", "B3", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).summary.platformAdapter, 0);

    result = run(["review", "baseline", "plan", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const baselinePlan = JSON.parse(result.stdout);
    assert.equal(fs.existsSync(path.join(root, ".wl-skills-bd/review-baseline.json")), false);
    result = run(["review", "baseline", "apply", "--plan-hash", baselinePlan.planHash, "--confirm", "--target", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(root, ".wl-skills-bd/review-baseline.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
