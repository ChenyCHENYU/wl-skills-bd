"use strict";

const test = require("node:test");
const assert = require("assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { protocol, runOperation } = require("../lib/protocol-cli");
const cases = require("./protocol-routing-cases.json");
const BIN = path.join(__dirname, "..", "bin", "wl-skills-bd.js");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-routing-"));
}

function routeAt(projectRoot, task) {
  if (!fs.existsSync(path.join(projectRoot, "package.json"))) fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ devDependencies: { "@agile-team/wl-skills-bd": "*" } }));
  return protocol.request({ operation: "route", projectRoot, task }, runOperation);
}

function installBd(root) {
  const plan = spawnSync(process.execPath, [BIN, "init", "--target", root], { encoding: "utf8", timeout: 120000 });
  assert.equal(plan.status, 0, plan.stderr);
  const hash = (plan.stdout.match(/planHash: ([a-f0-9]+)/) || [])[1];
  assert.ok(hash, "未取得 planHash");
  const confirm = spawnSync(process.execPath, [BIN, "init", "--target", root, "--confirm", "--plan-hash", hash], { encoding: "utf8", timeout: 120000 });
  assert.equal(confirm.status, 0, confirm.stdout + confirm.stderr);
}

test.before(() => {
  const root = tempRoot();
  installBd(root);
  module.exports.installedRoot = root;
});

for (const item of cases) {
  const expectedBare = item.skill ? "gap" : item.status;
  const expectedInstalled = item.installedStatus || (item.skill ? "matched" : item.status);

  test(`已声明接入但未初始化：「${item.task}」→ ${expectedBare}${item.skill ? ` + ${item.skill}` : ""}`, () => {
    const envelope = routeAt(tempRoot(), item.task);
    assert.equal(envelope.ok, true);
    const decision = envelope.result.decision || envelope.result;
    assert.equal(decision.status, expectedBare);
    if (item.skill) assert.ok(decision.selectedSkills.includes(item.skill), `应选中 ${item.skill}，实际 ${decision.selectedSkills}`);
    else assert.equal((decision.selectedSkills || []).length, 0);
  });

  test(`已安装：「${item.task}」→ ${expectedInstalled}${item.skill ? ` + ${item.skill}` : ""}`, () => {
    const envelope = routeAt(module.exports.installedRoot, item.task);
    assert.equal(envelope.ok, true);
    const decision = envelope.result.decision || envelope.result;
    assert.equal(decision.status, expectedInstalled);
    if (item.skill) assert.ok(decision.selectedSkills.includes(item.skill));
  });
}
