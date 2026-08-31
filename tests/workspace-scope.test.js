"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");
const { discoverWorkspace } = require("../lib/workspace");
const { scanPlaintextSecrets } = require("../lib/config-layering");
const { runConfigDoctor } = require("../lib/config-doctor");

function fixture(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-workspace-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
    }
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const catalog = JSON.stringify({
  schemaVersion: 1,
  project: { id: "workspace-fixture", name: "Workspace Fixture" },
  docsRoot: "docs/backend",
  modules: {
    alpha: {
      displayName: "Alpha",
      root: "module-alpha",
      contractRoots: ["module-alpha/contracts"],
      sourceRoots: ["module-alpha/src/main/java"],
      upstream: [], downstream: [], owners: ["team-alpha"],
    },
    beta: {
      displayName: "Beta",
      contractRoots: ["module-beta/contracts"],
      sourceRoots: ["module-beta/src/main/java"],
      upstream: [], downstream: [], owners: ["team-beta"],
    },
  },
});

fixture({
  ".wl-skills-bd/catalog.config.json": catalog,
  "module-alpha/.be-rules-ignore": "B1:src/main/java/demo/AlphaController.java # SEC-100 reviewed public endpoint\n",
  "module-alpha/src/main/java/demo/AlphaController.java": `class AlphaController {
    @PostMapping("save")
    public Object save() { return null; }
  }`,
  "module-beta/src/main/java/demo/BetaController.java": `class BetaController {
    @PostMapping("save")
    public Object save() { return null; }
  }`,
  "module-alpha/src/main/resources/bootstrap.yml": `spring:
  profiles:
    active: dev
  cloud:
    nacos:
      config:
        server-addr: localhost:8848
        namespace: dev
        group: JH4J
        shared-configs:
          - dataId: datasource-\${DATASOURCE:mysql}-\${DB_CLUSTER:cx}-\${spring.profiles.active}.yml`,
  "module-beta/src/main/resources/bootstrap.yml": `spring:
  profiles:
    active: sit
  cloud:
    nacos:
      config:
        server-addr: localhost:8848
        namespace: sit
        group: JH4J
        shared-configs:
          - dataId: datasource-\${DATASOURCE:mysql}-\${DB_CLUSTER:pt}-\${spring.profiles.active}.yml`,
}, (root) => {
  const workspace = discoverWorkspace(root);
  assert.strictEqual(workspace.enabled, true);
  assert.deepStrictEqual(workspace.modules.map((item) => item.rel), ["module-alpha", "module-beta"]);
  const result = runBeRules(root, { rules: ["B1"] });
  assert.strictEqual(result.workspace, true);
  assert.strictEqual(result.suppressed.length, 1, "子模块豁免必须在整仓扫描中生效");
  assert.deepStrictEqual(result.issues.map((item) => item.file), ["module-beta/src/main/java/demo/BetaController.java"]);
  assert.strictEqual(result.issues[0].module, "beta");
  const alphaOnly = runBeRules(root, { module: "alpha", rules: ["B1"] });
  assert.deepStrictEqual(alphaOnly.modules.map((item) => item.id), ["alpha"]);
  assert.strictEqual(alphaOnly.issues.length, 0);
  assert.strictEqual(alphaOnly.suppressed.length, 1);
  const unknown = runBeRules(root, { module: "missing", rules: ["B1"] });
  assert.strictEqual(unknown.issues[0].rule, "WLS_CONFIG");
  assert.match(unknown.issues[0].message, /未知模块/);
  const doctor = runConfigDoctor(root);
  assert.strictEqual(doctor.workspace, true);
  assert.strictEqual(doctor.checks.find((item) => item.id === "alpha:config-profile").detail, "profile=dev");
  assert.strictEqual(doctor.checks.find((item) => item.id === "beta:config-profile").detail, "profile=sit");
});

fixture({
  "deployment.yml": [
    "kind: Deployment",
    "spec:",
    "  template:",
    "    spec:",
    "      automountServiceAccountToken: false",
    "data:",
    "  NACOS_PASSWORD: real-secret-value",
  ].join("\n"),
}, (root) => {
  const file = path.join(root, "deployment.yml");
  const issues = scanPlaintextSecrets([{ rel: "deployment.yml", abs: file, name: "deployment.yml" }]);
  assert.strictEqual(issues.length, 1, "布尔型 token 配置不得被当作秘密，真实密码仍必须命中");
  assert.strictEqual(issues[0].key, "data.NACOS_PASSWORD");
});

console.log("✅ workspace-scope：多模块作用域、子模块豁免与语义化密钥扫描通过");
