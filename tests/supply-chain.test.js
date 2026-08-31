"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { inspectSupplyChain } = require("../lib/supply-chain");

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "wls-sc-")); }
function write(project, rel, content) { const file = path.join(project, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, "utf8"); }
function pom(version, extra = "") { return `<project><dependencies><dependency><groupId>com.acme</groupId><artifactId>core</artifactId><version>${version}</version></dependency>${extra}</dependencies></project>`; }

test("未配置供应链策略时只输出确定性清单，不擅自阻断", () => {
  const project = root();
  write(project, "pom.xml", pom("LATEST"));
  const result = inspectSupplyChain(project);
  assert.equal(result.ok, true);
  assert.equal(result.state, "inventory-only");
  assert.equal(result.findings.length, 0);
  assert.equal(result.inventory.dependencies, 1);
});

test("项目策略控制版本收敛、动态版本、BOM 和禁用依赖门禁", () => {
  const project = root();
  write(project, ".wl-skills-bd/supply-chain.json", JSON.stringify({
    schemaVersion: 1,
    enforceConvergence: true,
    forbidDynamicVersions: true,
    requiredBoms: [{ groupId: "com.acme", artifactId: "platform-bom" }],
    forbiddenCoordinates: [{ groupId: "com.acme", artifactId: "core" }],
  }));
  write(project, "pom.xml", pom("LATEST"));
  write(project, "module/pom.xml", pom("1.0.0"));
  const result = inspectSupplyChain(project);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map((item) => item.rule));
  assert(rules.has("SC_CONVERGENCE"));
  assert(rules.has("SC_DYNAMIC_VERSION"));
  assert(rules.has("SC_REQUIRED_BOM"));
  assert(rules.has("SC_FORBIDDEN_DEPENDENCY"));
});

test("非 POM 变更时供应链扫描短路", () => {
  const project = root();
  write(project, "pom.xml", pom("1.0.0"));
  const result = inspectSupplyChain(project, { changedFiles: ["src/main/java/A.java"] });
  assert.equal(result.state, "not-affected");
  assert.equal(result.inventory.poms, 0);
});
