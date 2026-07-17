#!/usr/bin/env node
/**
 * lint-skills.js — wl-skills-bd Skill 骨架完整性与规则覆盖矩阵自检
 *
 * 对标 wl-skills-kit/scripts/lint-skills.js，适配 bd。
 * 核心治理规则：rule-coverage.md 标记「阻断」的约定必须有确定性执行器（J星 或 regex）兜底。
 *
 * 检查项：
 *  1. 公共文件存在（_registry/_pipeline/_best-practices）
 *  2. 有写操作的 core/ops SKILL.md 必须含 Pre-flight + standards 引用
 *  3. _registry.md 列出的 SKILL.md 路径必须存在
 *  4. SKILL.md 主文件 ≤ 500 行，声明的 references 必须存在
 *  5. java-quality/ 下每个工具目录必须有 README.md（接入文档）
 *  6. 规则覆盖矩阵：rule-coverage.md 标记阻断的规则，执行器必须真实存在
 *
 * 用法：node scripts/lint-skills.js   exit 非0表示有违规
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKILLS = path.join(ROOT, "files", ".github", "skills");
const GITHUB = path.join(ROOT, "files", ".github");

const errors = [];
const warnings = [];

function fileMust(rel) {
  const full = path.join(SKILLS, rel);
  if (!fs.existsSync(full)) {
    errors.push(`缺失公共文件: ${rel}`);
    return null;
  }
  return fs.readFileSync(full, "utf8");
}

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, list);
    else list.push(fp);
  }
  return list;
}

// 1. 公共文件存在
const REQUIRED_PUBLIC = [
  "_registry.md",
  "_pipeline.md",
  "_best-practices.md",
];
for (const rel of REQUIRED_PUBLIC) fileMust(rel);

// 2. 有写操作的 core/ops SKILL.md：必须含 Pre-flight + standards 引用
const WRITE_SKILLS = [
  "core/api-design-be/SKILL.md",
  "core/entity-codegen/SKILL.md",
  "core/service-codegen/SKILL.md",
  "core/mapper-xml-gen/SKILL.md",
  "core/convention-audit-be/SKILL.md",
  "core/business-doc-extract-be/SKILL.md",
  "data/db-migration/SKILL.md",
  "ops/code-fix-be/SKILL.md",
  "ops/standard-env-config-be/SKILL.md",
];

for (const rel of WRITE_SKILLS) {
  const content = fileMust(rel);
  if (!content) continue;
  if (!/Pre-flight/i.test(content)) {
    errors.push(`${rel}: 有写操作的 Skill 必须含 Pre-flight 声明`);
  }
  if (!/standards/.test(content)) {
    errors.push(`${rel}: 必须引用 standards/ 规范基线`);
  }
}

// 3. _registry.md 列出的 SKILL.md 路径必须存在
const registry = fileMust("_registry.md") || "";
const skillPathRe = /skills\/([\w\-/]+\/SKILL\.md)/g;
let m;
const seen = new Set();
while ((m = skillPathRe.exec(registry)) !== null) {
  const p = m[1];
  if (seen.has(p)) continue;
  seen.add(p);
  if (!fs.existsSync(path.join(SKILLS, p))) {
    errors.push(`_registry.md 引用了不存在的 Skill: ${p}`);
  }
}

// 4. SKILL.md 主文件 ≤ 500 行 + references 存在性
const skillFiles = walk(SKILLS).filter((fp) => path.basename(fp) === "SKILL.md");
for (const sp of skillFiles) {
  const rel = path.relative(SKILLS, sp).replace(/\\/g, "/");
  const content = fs.readFileSync(sp, "utf8");
  const lines = content.split(/\r?\n/).length;
  if (lines > 500) {
    errors.push(`${rel}: ${lines} 行，超过 500；场景细节移入 references/`);
  }
  const refs = new Set(content.match(/references\/[\w./-]+\.md/g) || []);
  for (const r of refs) {
    if (r.includes("../")) {
      errors.push(`${rel}: reference 不得跨目录: ${r}`);
      continue;
    }
    if (!fs.existsSync(path.join(path.dirname(sp), r))) {
      errors.push(`${rel}: 引用不存在的文件 ${r}`);
    }
  }
}

// 5. java-quality/ 每个工具目录必须有 README.md
const JAVA_QUALITY = path.join(GITHUB, "java-quality");
if (fs.existsSync(JAVA_QUALITY)) {
  for (const entry of fs.readdirSync(JAVA_QUALITY, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const readme = path.join(JAVA_QUALITY, entry.name, "README.md");
      if (!fs.existsSync(readme)) {
        warnings.push(`java-quality/${entry.name}/: 缺 README.md 接入文档`);
      }
    }
  }
}

// 5.5 所有有 SKILL.md 的目录必须配 USAGE.md（执行细节+典型场景+FAQ）
const skillsWithSkMd = walk(SKILLS)
  .filter((fp) => path.basename(fp) === "SKILL.md")
  .map((fp) => path.dirname(fp));
for (const dir of skillsWithSkMd) {
  const usage = path.join(dir, "USAGE.md");
  if (!fs.existsSync(usage)) {
    errors.push(`${path.relative(SKILLS, dir).replace(/\\/g, "/")}/: Skill 必须配 USAGE.md（典型场景+触发词+FAQ）`);
  }
}

// 6. 规则覆盖矩阵：阻断规则必须有执行器兜底
function readOptional(rel) {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : "";
}

function blockingRulesInCoverage(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (!/^\|/.test(line)) continue;
    if (!/\|\s*是\s*\|/.test(line)) continue; // 阻断=是
    const found = [...line.matchAll(/\b([J]\d+)\b/g)].map((x) => x[1]);
    const regex = /\bregex\b/.test(line);
    for (const r of found) rules.push({ rule: r, line });
    if (regex) rules.push({ rule: "regex", line });
  }
  return rules;
}

(function checkCoverage() {
  const coveragePath = path.join(ROOT, "kit-internal", "rule-coverage.md");
  if (!fs.existsSync(coveragePath)) {
    warnings.push("kit-internal/rule-coverage.md 不存在，跳过覆盖矩阵校验");
    return;
  }
  const coverage = fs.readFileSync(coveragePath, "utf8");

  // 阻断项必须至少有一个执行器标记（J* 或 regex），否则就是"靠 AI 自觉"
  for (const line of coverage.split("\n")) {
    if (!/^\|/.test(line)) continue;
    if (!/standards\//.test(line)) continue; // 只看约定来源行
    if (!/\|\s*是\s*\|/.test(line)) continue; // 非阻断项跳过

    const hasExecutor = /\bJ\d+\b|\bregex\b/.test(line);
    if (!hasExecutor) {
      const desc = line.split("|")[2] || line.slice(0, 60);
      errors.push(
        `rule-coverage.md: 阻断约定「${desc.trim()}」无确定性执行器（J星 或 regex）兜底，仅靠 AI 自觉`,
      );
    }
  }

  // J* 规则必须在 java-quality/ 或 lib/be-rules.js 中有对应物化
  // J编号 → 工具目录名映射（非字面 j1/j2）
  const J_TOOL_MAP = {
    J1: "archunit",
    J2: "checkstyle",
    J3: "pmd",
    J4: "spotbugs",
    J5: "spotless",
    J6: "pmd", // J6 是 P3C，在 pmd/ 目录下的 ali-p3c-ruleset.xml
    J7: "knife4j",
  };
  const beRules = readOptional("lib/be-rules.js");
  for (const line of coverage.split("\n")) {
    const jRules = [...line.matchAll(/\bJ(\d+)\b/g)].map((x) => `J${x[1]}`);
    for (const j of jRules) {
      const toolDir = J_TOOL_MAP[j];
      const found =
        (toolDir && fs.existsSync(path.join(JAVA_QUALITY, toolDir))) ||
        new RegExp(j).test(beRules);
      if (!found) {
        warnings.push(
          `rule-coverage.md: ${j} 标记但 java-quality/${toolDir || "?"} 无对应目录`,
        );
      }
    }
  }
})();

// 输出
if (warnings.length) {
  console.warn("\n⚠️  Skill Lint 警告:");
  for (const w of warnings) console.warn("  " + w);
}
if (errors.length) {
  console.error("\n❌ Skill Lint 错误:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(
  `\n✅ Skill Lint 通过：公共文件 ${REQUIRED_PUBLIC.length}、写操作 Skill ${WRITE_SKILLS.length}、规则覆盖矩阵已校验`,
);
