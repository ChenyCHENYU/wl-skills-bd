"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_OUTPUT_REL = "files/.wl-skills-bd/capabilities.json";

function readFrontmatter(file) {
  const content = fs.readFileSync(file, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  let section = null;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (field) {
      const value = field[2].trim();
      result[field[1]] = value;
      section = value === "" ? field[1] : null;
      continue;
    }
    const nested = line.match(/^\s+([a-zA-Z][\w-]*):\s*(.*)$/);
    if (section === "metadata" && nested) {
      result[nested[1]] = nested[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return result;
}

function walkSkillFiles(root) {
  const files = [];
  for (const category of fs.readdirSync(root, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryRoot = path.join(root, category.name);
    for (const skill of fs.readdirSync(categoryRoot, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const file = path.join(categoryRoot, skill.name, "SKILL.md");
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

function normalizeSkillStatus(value) {
  if (String(value).includes("✅")) return "implemented";
  if (String(value).includes("部分")) return "partial";
  if (String(value).includes("骨架")) return "skeleton";
  return "unknown";
}

function discoverCapabilities(packageRootInput) {
  const packageRoot = path.resolve(packageRootInput);
  const standardsRoot = path.join(packageRoot, "files", ".github", "standards");
  const standardFiles = fs.readdirSync(standardsRoot)
    .filter((file) => /^\d{2}-.+\.md$/.test(file))
    .sort();
  const standardIds = standardFiles.map((file) => file.slice(0, 2));
  const ruleCatalog = JSON.parse(fs.readFileSync(path.join(packageRoot, "files", ".wl-skills-bd", "rules", "catalog.json"), "utf8"));
  const backendRuleIds = ruleCatalog.rules
    .map((rule) => rule.id)
    .filter((id) => /^B\d+$/.test(id))
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  const skillFiles = walkSkillFiles(path.join(packageRoot, "files", ".github", "skills"));
  const skills = skillFiles.map((file) => {
    const frontmatter = readFrontmatter(file);
    return {
      name: frontmatter.name,
      path: path.relative(packageRoot, path.dirname(file)).replace(/\\/g, "/"),
      status: normalizeSkillStatus(frontmatter.status),
      statusLabel: frontmatter.status,
      stage: frontmatter.stage,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const latestRule = backendRuleIds.at(-1) || null;
  return {
    schemaVersion: 1,
    kind: "wl-skills-bd-capabilities",
    standards: {
      count: standardIds.length,
      ids: standardIds,
      latest: standardIds.at(-1) || null,
    },
    backendRules: {
      count: backendRuleIds.length,
      ids: backendRuleIds,
      latest: latestRule,
      displayRange: latestRule ? `B1~${latestRule}` : "",
    },
    skills: {
      count: skills.length,
      items: skills,
      summary: {
        implemented: skills.filter((skill) => skill.status === "implemented").length,
        partial: skills.filter((skill) => skill.status === "partial").length,
        skeleton: skills.filter((skill) => skill.status === "skeleton").length,
        unknown: skills.filter((skill) => skill.status === "unknown").length,
      },
    },
  };
}

function serializeCapabilities(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

module.exports = {
  DEFAULT_OUTPUT_REL,
  discoverCapabilities,
  normalizeSkillStatus,
  readFrontmatter,
  serializeCapabilities,
};
