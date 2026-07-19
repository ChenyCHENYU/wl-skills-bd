"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const policy = require("../lib/commit-policy");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-commit-"));

function runGit(args) {
  return childProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

try {
  fs.mkdirSync(path.join(root, ".wl-skills-bd"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "catalog.config.json"), `${JSON.stringify({
    schemaVersion: 1,
    project: { id: "wl-test", name: "测试" },
    docsRoot: "docs/backend",
    commit: { types: ["feat", "fix", "docs"], requireDetailSeparator: true, maxHeaderLength: 80 },
    modules: {
      order: { displayName: "订单", contractRoots: ["contracts/order"], sourceRoots: ["src/order"], upstream: [], downstream: [], owners: ["team"] },
    },
  }, null, 2)}\n`, "utf8");

  assert.strictEqual(policy.validateMessage(root, "feat(order): 订单创建-增加幂等校验").ok, true);
  assert.strictEqual(policy.validateMessage(root, "feat: missing scope").ok, false);
  assert.strictEqual(policy.validateMessage(root, "feat(other): 功能点-具体内容").errors[0].code, "COMMIT_SCOPE");
  assert.strictEqual(policy.validateMessage(root, "feature(order): 功能点-具体内容").errors[0].code, "COMMIT_TYPE");
  assert.strictEqual(policy.validateMessage(root, "feat(order): 只有功能点").errors[0].code, "COMMIT_SUBJECT");
  assert.strictEqual(policy.validateMessage(root, "feat（order）： 功能点-具体内容").ok, false, "全角标点必须拒绝");

  runGit(["init", "-q"]);
  runGit(["config", "user.email", "test@example.com"]);
  runGit(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(root, "README.md"), "test\n", "utf8");
  runGit(["add", "README.md"]);
  runGit(["commit", "-q", "-m", "feat(order): 初始化-增加说明"]);
  fs.appendFileSync(path.join(root, "README.md"), "bad\n", "utf8");
  runGit(["add", "README.md"]);
  runGit(["commit", "-q", "-m", "bad message"]);
  const range = policy.validateRange(root, "HEAD~1..HEAD");
  assert.strictEqual(range.ok, false);
  assert.strictEqual(range.checked, 1);
  assert.strictEqual(range.invalid[0].errors[0].code, "COMMIT_FORMAT");

  const doctor = policy.doctor(root);
  assert.strictEqual(doctor.ok, false);
  assert.ok(doctor.checks.some((check) => check.id === "hooks-path" && !check.ok));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✓ commit policy：type/scope/subject、全角拒绝、range 与 Hook doctor 通过");
