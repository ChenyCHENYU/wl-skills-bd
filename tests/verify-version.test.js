"use strict";

/**
 * tests/verify-version.test.js — scripts/verify-version.js 冒烟测试
 *
 * 通过子进程跑 verify-version.js，确认当前仓库自身能通过自检。
 * 对标 wl-skills-kit/tests/version-tools.test.js。
 */

const { execFileSync } = require("child_process");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "verify-version.js");

function run() {
  return execFileSync("node", [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

(function testVerifyVersionPasses() {
  const out = run();
  assert.match(out, /\[verify-version\] ✔/, "verify-version 应通过自检");
  assert.match(out, /standards=\d+/, "应输出 standards 计数");
  assert.match(out, /skills=\d+/, "应输出 skills 计数");
  console.log("  ✔ verify-version 通过，版本/计数一致");
})();

console.log("\n✅ verify-version 测试通过");
