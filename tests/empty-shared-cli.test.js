"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = path.resolve(__dirname, "../bin/wl-skills-bd.js");
const files = ["AGENTS.md", "CLAUDE.md"];

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-empty-shared-"));
  const command = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, "--target", root, "--json"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const apply = (name) => {
    const plan = command(name, "--dry-run");
    const result = command(name, "--plan-hash", plan.planHash, "--confirm");
    assert.equal(result.result.ok, true);
    return result.result;
  };
  try { run({ root, command, apply }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("真实 CLI 安装和升级后 clean 保留预存空 AGENTS/CLAUDE 文件", () => fixture(({ root, apply }) => {
  for (const rel of files) fs.writeFileSync(path.join(root, rel), "");
  apply("init");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".wl-skills-bd-manifest.json"), "utf8"));
  for (const rel of files) assert.equal(manifest.files[rel].createdFile, false);
  apply("update");
  const cleaned = apply("clean");
  for (const rel of files) {
    assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "");
    assert.ok(cleaned.removed.includes(rel));
    assert.ok(!cleaned.preserved.includes(rel), "空文件存在性不应误报为用户修改");
  }
}));

test("真实 CLI clean 删除本包新建且未修改的共享文件", () => fixture(({ root, apply }) => {
  apply("init");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".wl-skills-bd-manifest.json"), "utf8"));
  for (const rel of files) assert.equal(manifest.files[rel].createdFile, true);
  apply("clean");
  for (const rel of files) assert.ok(!fs.existsSync(path.join(root, rel)));
}));

test("旧区块记录缺少文件存在性基线时真实 CLI clean 保守保留空文件", () => fixture(({ root, apply }) => {
  apply("init");
  const file = path.join(root, ".wl-skills-bd-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const rel of files) delete manifest.files[rel].createdFile;
  fs.writeFileSync(file, JSON.stringify(manifest));
  apply("clean");
  for (const rel of files) assert.equal(fs.readFileSync(path.join(root, rel), "utf8"), "");
}));
