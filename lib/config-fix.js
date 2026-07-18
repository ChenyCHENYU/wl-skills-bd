"use strict";

const fs = require("fs");
const path = require("path");
const { listConfigFiles, scanPlaintextSecrets, isSensitiveKey, parseYamlKeyValue, isPlaceholder } = require("./config-layering");
const { hashJson } = require("./deterministic");
const { resolveWithin } = require("./manifest");

const PLACEHOLDER_MAP = {
  "password": "PASSWORD",
  "passwd": "PASSWORD",
  "pwd": "PASSWORD",
  "nacos.password": "NACOS_PASSWORD",
  "db.password": "DB_PASSWORD",
  "datasource.password": "DB_PASSWORD",
  "redis.password": "REDIS_PASSWORD",
  "datasource.druid.password": "DB_PASSWORD",
  "datasource.dynamic.datasource.master.password": "DB_PASSWORD",
  "datasource.dynamic.datasource.slave.password": "DB_PASSWORD",
  "redis.host": "REDIS_HOST",
  "redis.port": "REDIS_PORT",
  "redis.password": "REDIS_PASSWORD",
  "datasource.url": "DB_URL",
  "datasource.username": "DB_USERNAME",
  "datasource.druid.username": "DB_USERNAME",
  "datasource.password": "DB_PASSWORD",
};

function buildFixPlan(root, options = {}) {
  const files = listConfigFiles(root);
  const issues = scanPlaintextSecrets(files);
  if (issues.length === 0) {
    return { ok: true, actions: [], summary: { fixed: 0, skipped: 0 }, reason: "no-issues" };
  }
  const actions = [];
  const fileGroups = new Map();
  for (const issue of issues) {
    if (!fileGroups.has(issue.file)) fileGroups.set(issue.file, []);
    fileGroups.get(issue.file).push(issue);
  }
  for (const [file, fileIssues] of fileGroups) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const original = fs.readFileSync(abs, "utf8");
    let modified = original;
    let fixed = 0;
    for (const issue of fileIssues) {
      const placeholder = guessPlaceholder(issue.key, issue.value);
      // 替换该行：用 key 最后一段 + 明文值 匹配（YAML 实际行的 key 是缩进后的最后一段）
      const keySegment = issue.key.split(".").pop();
      const lineRegex = new RegExp(`^(\\s*[^#\\n]*?\\b${escapeRegex(keySegment)}\\s*:\\s*)${escapeRegex(issue.value)}(\\s*(?:#.*)?)$`, "m");
      const before = modified;
      modified = modified.replace(lineRegex, `$1\${${placeholder}}$2`);
      if (modified !== before) fixed += 1;
    }
    if (modified !== original) {
      actions.push({
        kind: "fix-secret",
        file,
        rel: file,
        action: "update",
        fixed,
        total: fileIssues.length,
        originalHash: hashJson(original),
        content: modified,
      });
    }
  }
  return {
    ok: true,
    actions,
    summary: { fixed: actions.reduce((a, x) => a + x.fixed, 0), total: issues.length },
  };
}

function guessPlaceholder(keyPath, value) {
  const lower = keyPath.toLowerCase();
  // 直接匹配
  if (PLACEHOLDER_MAP[lower]) return PLACEHOLDER_MAP[lower];
  // 模糊匹配
  if (/nacos.*password/i.test(keyPath)) return "NACOS_PASSWORD";
  if (/(datasource|db).*password/i.test(keyPath)) return "DB_PASSWORD";
  if (/redis.*password/i.test(keyPath)) return "REDIS_PASSWORD";
  if (/password|passwd|pwd/i.test(keyPath)) return "PASSWORD";
  if (/secret|token|apikey/i.test(keyPath)) return "SECRET";
  // 兜底：基于 key 名生成
  const envName = keyPath.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return envName || "SECRET";
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyFixPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  const applied = [];
  for (const action of plan.actions) {
    const dest = resolveWithin(options.projectRoot || process.cwd(), action.rel);
    const backup = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
    fs.writeFileSync(dest, action.content, "utf8");
    applied.push({ rel: action.rel, result: "fixed", fixed: action.fixed, backup });
  }
  // 复扫验证
  const files = listConfigFiles(options.projectRoot || process.cwd());
  const remaining = scanPlaintextSecrets(files);
  return {
    ok: remaining.length === 0,
    applied,
    closure: { fixed: plan.summary.fixed, remaining: remaining.length, regressions: 0 },
  };
}

module.exports = { applyFixPlan, buildFixPlan, guessPlaceholder };
