#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const IGNORED = new Set([".git", "node_modules", "target"]);
const CONFLICT_MARKERS = ["<".repeat(7), "=".repeat(7), ">".repeat(7)];

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, files);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

const files = walk(ROOT).sort();
assert.ok(files.length > 0, "未找到 JavaScript 文件");
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  assert.ok(
    CONFLICT_MARKERS.every((marker) => !source.includes(marker)),
    `${path.relative(ROOT, file)} 存在合并冲突标记`,
  );
  assert.ok(!/^\uFEFF/.test(source), `${path.relative(ROOT, file)} 禁止 UTF-8 BOM`);
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
  assert.strictEqual(checked.status, 0, `${path.relative(ROOT, file)} 语法检查失败：\n${checked.stderr || checked.stdout}`);
}

console.log(`✅ JavaScript 基线：${files.length} 个文件通过语法、BOM 与冲突标记检查`);
