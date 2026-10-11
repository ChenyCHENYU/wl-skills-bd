"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { VALUE_OPTIONS } = require("../lib/cli-arguments");
const cli = path.resolve(__dirname, "../bin/wl-skills-bd.js");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-cli-boundaries-")));
const a = path.join(root, "a"), b = path.join(root, "b");
fs.mkdirSync(a); fs.mkdirSync(b);
fs.writeFileSync(path.join(a, "user.txt"), "用户项目 A 原内容\n");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: a, encoding: "utf8" });
const json = (result) => { assert.ok(result.stdout, result.stderr); return JSON.parse(result.stdout); };
function snapshot(dir) {
  const walk = (current) => fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(current, entry.name);
    return entry.isDirectory() ? walk(file) : [[path.relative(dir, file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]];
  });
  return walk(dir).sort(([left], [right]) => left.localeCompare(right));
}

try {
  const aBefore = snapshot(a), bBefore = snapshot(b);
  for (const flags of [["--target="], ["--target", ""], ["--target", " "], ["--target"], ["--target", a, "--target", b]]) {
    const result = run("init", ...flags, "--confirm", "--plan-hash=fake", "--json");
    assert.equal(result.status, 1, JSON.stringify(flags));
    assert.match(result.stderr, /缺少参数|相互冲突/);
    assert.deepEqual(snapshot(a), aBefore);
    assert.deepEqual(snapshot(b), bBefore);
  }
  const preview = json(run("init", `--target=${b}`, "--json"));
  assert.equal(preview.projectRoot, b);
  const installed = run("init", `--target=${b}`, `--plan-hash=${preview.planHash}`, "--confirm", "--json");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(json(installed).result.ok, true);
  assert.deepEqual(snapshot(a), aBefore, "指定 B 时不能写入 A");
  fs.mkdirSync(path.join(b, "src"));
  fs.writeFileSync(path.join(b, "src/GoodService.java"), "public class GoodService {\n    /** 查询当前租户记录。 */\n    public String query() { return \"ok\"; }\n}\n");
  for (const flags of [["--target", b, "--rules", "B12", "--run-id", "pair-check"], [`--target=${b}`, "--rules=B12", "--run-id=equals-check"]]) {
    const result = run("validate", "src/GoodService.java", ...flags, "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(json(result).receipt.checkedFiles.map((item) => item.path), ["src/GoodService.java"]);
  }
  const beforeInvalid = snapshot(b);
  for (const args of [["src/GoodService.java", "src/Other.java"], ["--target-file", "src/GoodService.java"], ["--unknown-target=src"]]) {
    const result = run("validate", ...args, "--target", b, "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /位置参数|未知选项/);
    assert.deepEqual(snapshot(b), beforeInvalid, "拒绝参数前不能产生检查记录");
  }
  fs.writeFileSync(path.join(b, ".wl-skills-bd/contracts/wl-delivery-profile.v1.json"), "{invalid");
  const broken = run("validate", "src/GoodService.java", `--target=${b}`, "--rules=B29", "--run-id=profile-failure", "--json");
  assert.equal(broken.status, 1);
  assert.equal(json(broken).receipt.executionStatus, "failed");
  assert.deepEqual(json(broken).receipt.checkedFiles.map((item) => item.path), ["src/GoodService.java"]);
  const status = json(run("status", "--target", b, "--run-id", "profile-failure", "--json"));
  assert.equal(status.executionStatus, "failed", "真实执行器异常必须结束，不能永久 running");
  const injection = `const rules=require(${JSON.stringify(path.resolve(__dirname, "../lib/be-rules"))});rules.runBeRules=()=>{throw new Error("injected-validator-error")};process.exitCode=require(${JSON.stringify(cli)}).main(${JSON.stringify(["validate", "src/GoodService.java", "--target", b, "--rules", "B12", "--run-id", "injected-failure", "--json"])});`;
  const injected = spawnSync(process.execPath, ["-e", injection], { cwd: a, encoding: "utf8" });
  assert.equal(injected.status, 1);
  assert.equal(json(injected).error.code, "validator-input-error");
  assert.equal(json(injected).receipt.executionStatus, "failed");
  assert.deepEqual(json(injected).receipt.checkedFiles, []);
  assert.equal(json(run("status", "--target", b, "--run-id", "injected-failure", "--json")).executionStatus, "failed");
  const source = fs.readFileSync(cli, "utf8");
  const used = [...new Set([...source.matchAll(/(?:option|keyValueOptions)\([^,\n]+,\s*"(--[^"\n]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual([...VALUE_OPTIONS].sort(), used, "值参数目录必须与所有旧命令读取一致");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("✅ CLI boundaries：pair/等号、缺空值/冲突零写入、精确目标、旧入口和失败终态");
