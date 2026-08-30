#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const capabilities = require("../files/.wl-skills-bd/capabilities.json");
const { normalizeSkillStatus } = require("../lib/capabilities");

const ROOT = path.resolve(__dirname, "..");
const errors = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function verifyStandardsIndex() {
  const index = read("files/.github/standards/index.md");
  if (!index.includes(`## ${capabilities.standards.count} 条后端规范清单`)) {
    errors.push(`standards/index.md 未声明 ${capabilities.standards.count} 条规范`);
  }
  for (const id of capabilities.standards.ids) {
    if (!new RegExp(`^\\| ${id}\\s+\\|`, "m").test(index)) errors.push(`standards/index.md 缺少规范 ${id}`);
  }
}

function verifySkillRegistry() {
  const registry = read("files/.github/skills/_registry.md");
  for (const skill of capabilities.skills.items) {
    const rel = skill.path.replace(/^files\/\.github\/skills\//, "");
    const line = registry.split(/\r?\n/).find((value) => value.includes(`](${rel}/SKILL.md)`));
    if (!line) {
      errors.push(`skills/_registry.md 缺少 ${skill.name}`);
      continue;
    }
    if (normalizeSkillStatus(line) !== skill.status) {
      errors.push(`skills/_registry.md 中 ${skill.name} 状态与 SKILL.md 不一致`);
    }
  }
}

function verifyActiveRuleRanges() {
  const currentFiles = [
    "mcp/registry.js",
    "mcp/tools/beRulesTools.js",
    "kit-internal/architecture.md",
    "kit-internal/rule-coverage.md",
    "files/.github/skills/core/convention-audit-be/SKILL.md",
    "files/.github/skills/core/convention-audit-be/USAGE.md",
    "files/.github/skills/ops/code-fix-be/SKILL.md",
    "files/.github/skills/test/unit-test-gen/SKILL.md",
  ];
  const expected = capabilities.backendRules.displayRange;
  for (const rel of currentFiles) {
    for (const [index, line] of read(rel).split(/\r?\n/).entries()) {
      if (/^\s*[-*].*(?:20\d{2}|v\d)/.test(line)) continue;
      const ranges = line.match(/B1(?:~|-)B\d+/g) || [];
      for (const range of ranges) {
        if (range.replace("-", "~") !== expected) errors.push(`${rel}:${index + 1} 使用过期规则范围 ${range}`);
      }
    }
  }
}

verifyStandardsIndex();
verifySkillRegistry();
verifyActiveRuleRanges();

if (errors.length > 0) {
  for (const error of errors) console.error(`doc-sync: ${error}`);
  process.exit(1);
}
console.log(`doc sync verified: standards=${capabilities.standards.count}, rules=${capabilities.backendRules.displayRange}, skills=${capabilities.skills.count}`);
