"use strict";

const fs = require("fs");
const path = require("path");
const { listConfigFiles, scanPlaintextSecrets, isSensitiveKey, parseYamlKeyValue, isPlaceholder } = require("./config-layering");
const { hashJson } = require("./deterministic");
const { resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

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
  const projectRoot = path.resolve(root);
  const files = listConfigFiles(projectRoot);
  const issues = scanPlaintextSecrets(files);
  if (issues.length === 0) {
    const planHash = hashJson({ schemaVersion: 1, actions: [] });
    return { ok: true, projectRoot, actions: [], summary: { fixed: 0, total: 0 }, reason: "no-issues", planHash };
  }
  const actions = [];
  const fileGroups = new Map();
  for (const issue of issues) {
    if (!fileGroups.has(issue.file)) fileGroups.set(issue.file, []);
    fileGroups.get(issue.file).push(issue);
  }
  for (const [file, fileIssues] of fileGroups) {
    const abs = path.join(projectRoot, file);
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
  const planHash = hashJson({
    schemaVersion: 1,
    actions: actions.map((action) => ({ rel: action.rel, originalHash: action.originalHash, contentHash: hashJson(action.content) })),
  });
  return {
    ok: true,
    projectRoot,
    actions,
    summary: { fixed: actions.reduce((a, x) => a + x.fixed, 0), total: issues.length },
    planHash,
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
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const projectRoot = path.resolve(options.projectRoot || plan.projectRoot || process.cwd());
  const guarded = guardResult(projectRoot, options);
  if (guarded) return guarded;
  const fresh = buildFixPlan(projectRoot);
  if (fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  }
  if (fresh.actions.length === 0) return { ok: true, reason: "no-issues", planHash: fresh.planHash, applied: [], closure: { fixed: 0, remaining: 0, regressions: 0 } };
  for (const action of fresh.actions) {
    const destination = resolveWithin(projectRoot, action.rel);
    if (!fs.existsSync(destination) || hashJson(fs.readFileSync(destination, "utf8")) !== action.originalHash) {
      return { ok: false, reason: "plan-changed", expectedPlanHash: buildFixPlan(projectRoot).planHash, applied: [] };
    }
  }

  const backupId = `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${fresh.planHash.slice(0, 12)}`;
  const backupRoot = resolveWithin(projectRoot, `.wl-skills-bd/.state/config-fix-backups/${backupId}`);
  const backups = [];
  const applied = [];
  const rollback = () => {
    for (const item of [...backups].reverse()) writeTextAtomic(item.destination, fs.readFileSync(item.backup));
  };
  try {
    for (const action of fresh.actions) {
      const destination = resolveWithin(projectRoot, action.rel);
      const backup = resolveWithin(backupRoot, action.rel);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(destination, backup);
      backups.push({ destination, backup });
      writeTextAtomic(destination, action.content);
      applied.push({ rel: action.rel, result: "fixed", fixed: action.fixed });
    }
    const remaining = scanPlaintextSecrets(listConfigFiles(projectRoot));
    if (remaining.length > 0) {
      rollback();
      return { ok: false, reason: "closure-failed-rolled-back", remaining, backupId, applied: [] };
    }
  } catch (error) {
    try {
      rollback();
    } catch (rollbackError) {
      return { ok: false, reason: "write-failed-rollback-failed", message: `${error.message}; rollback: ${rollbackError.message}`, backupId, applied: [] };
    }
    return { ok: false, reason: "write-failed-rolled-back", message: error.message, backupId, applied: [] };
  }
  return {
    ok: true,
    planHash: fresh.planHash,
    backupId,
    applied,
    closure: { fixed: fresh.summary.fixed, remaining: 0, regressions: 0 },
  };
}

module.exports = { applyFixPlan, buildFixPlan, guessPlaceholder };
