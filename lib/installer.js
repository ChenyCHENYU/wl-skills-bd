"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pkg = require("../package.json");
const { hashJson } = require("./deterministic");
const { assertExpectedHash, rememberFile, rememberMissingParents, removeEmptyDirectories, restoreJournal } = require("./file-transaction");
const { guardResult } = require("./write-guard");
const {
  MANIFEST_NAME,
  hashFile,
  hashManagedFile,
  normalizeRel,
  readManifest,
  resolveWithin,
  writeManifest,
  writeTextAtomic,
} = require("./manifest");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "files");
const BACKUP_ROOT_REL = path.join(".wl-skills-bd", ".state", "backups");
const CLEAN_BACKUP_ROOT_REL = path.join(".wl-skills-bd", ".state", "clean-backups");

function walkFiles(root, current = root, output = []) {
  if (!fs.existsSync(current)) return output;
  const entries = fs.readdirSync(current, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, output);
    else if (entry.isFile()) output.push(normalizeRel(path.relative(root, absolute)));
  }
  return output;
}

function sourceEntries(sourceRoot = SOURCE_ROOT) {
  const entries = new Map();
  for (const rel of walkFiles(sourceRoot)) {
    const source = resolveWithin(sourceRoot, rel);
    entries.set(rel, { rel, source, sourceHash: hashManagedFile(source) });
  }
  return entries;
}

function buildPlan(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT);
  const manifest = readManifest(projectRoot);
  const sources = sourceEntries(sourceRoot);
  const actions = [];

  for (const entry of sources.values()) {
    const destination = resolveWithin(projectRoot, entry.rel);
    const owned = manifest && manifest.files[entry.rel];
    if (!fs.existsSync(destination)) {
      actions.push({ ...entry, destination, action: "add" });
      continue;
    }
    const currentHash = hashManagedFile(destination);
    if (currentHash === entry.sourceHash) {
      actions.push({ ...entry, destination, currentHash, action: "unchanged" });
      continue;
    }
    if (owned && currentHash === owned.installedHash) {
      actions.push({ ...entry, destination, currentHash, action: "update" });
      continue;
    }
    actions.push({ ...entry, destination, currentHash, action: "conflict" });
  }

  if (manifest) {
    for (const [rel, owned] of Object.entries(manifest.files)) {
      if (sources.has(rel)) continue;
      const destination = resolveWithin(projectRoot, rel);
      if (!fs.existsSync(destination)) {
        actions.push({ rel, destination, action: "stale-missing" });
        continue;
      }
      const currentHash = hashManagedFile(destination);
      actions.push({
        rel,
        destination,
        currentHash,
        action: currentHash === owned.installedHash ? "remove-stale" : "preserve-stale",
      });
    }
  }

  const summary = actions.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  const manifestFile = path.join(projectRoot, MANIFEST_NAME);
  const manifestHash = fs.existsSync(manifestFile) ? hashFile(manifestFile) : null;
  const planHash = hashJson({
    kind: "asset-install",
    packageVersion: pkg.version,
    projectRoot,
    sourceRoot,
    manifestHash,
    actions: actions.map((item) => ({ rel: item.rel, action: item.action,
      sourceHash: item.sourceHash || null, currentHash: item.currentHash || null })),
  });
  return { projectRoot, sourceRoot, manifest, manifestHash, sources, actions, summary, planHash };
}

function timestamp() {
  return `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17)}-${crypto.randomBytes(4).toString("hex")}`;
}

function backupFile(projectRoot, rel, sourceFile, backupId) {
  const backup = resolveWithin(projectRoot, `${normalizeRel(BACKUP_ROOT_REL)}/${backupId}/${rel}`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(sourceFile, backup);
  return backup;
}

function removeFailedTransactionBackups(projectRoot, backupId) {
  const transactionBackupDir = resolveWithin(projectRoot, `${normalizeRel(BACKUP_ROOT_REL)}/${backupId}`);
  fs.rmSync(transactionBackupDir, { recursive: true, force: true });
}

function applyInstallAction(item, context) {
  const { dryRun, plan, backupId, applied, manifestFiles, journal, createdDirs } = context;
  if (!dryRun) {
    assertExpectedHash(item.destination, item.currentHash, hashManagedFile);
    if (item.source) assertExpectedHash(item.source, item.sourceHash, hashManagedFile);
  }
  if (["preserve-stale", "stale-missing"].includes(item.action)) {
    applied.push({ ...item, result: "preserved" });
    return;
  }
  if (item.action === "remove-stale") {
    if (!dryRun) {
      rememberFile(journal, item.destination);
      fs.unlinkSync(item.destination);
    }
    applied.push({ ...item, result: dryRun ? "would-remove" : "removed" });
    return;
  }
  if (item.action === "unchanged") {
    manifestFiles[item.rel] = { sourceHash: item.sourceHash, installedHash: item.sourceHash };
    applied.push({ ...item, result: "unchanged" });
    return;
  }
  if (!dryRun) {
    rememberFile(journal, item.destination);
    rememberMissingParents(createdDirs, item.destination, plan.projectRoot);
    if (fs.existsSync(item.destination) && ["update", "conflict"].includes(item.action)) {
      backupFile(plan.projectRoot, item.rel, item.destination, backupId);
    }
    writeTextAtomic(item.destination, fs.readFileSync(item.source), { projectRoot: plan.projectRoot });
    assertExpectedHash(item.destination, item.sourceHash, hashManagedFile);
    if (process.platform !== "win32" && /(?:^|\/)\.?(?:git-hooks|githooks)\/commit-msg$/.test(item.rel)) {
      fs.chmodSync(item.destination, 0o755);
    }
  }
  manifestFiles[item.rel] = { sourceHash: item.sourceHash, installedHash: item.sourceHash };
  applied.push({ ...item, result: dryRun ? `would-${item.action}` : item.action });
}

function applyPlan(plan, options = {}) {
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  if (!plan || !plan.planHash) return { ok: false, reason: "invalid-plan", applied: [], blocked: [] };
  if (!dryRun && options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [], blocked: [] };
  if (!dryRun && options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [], blocked: [] };
  }
  let fresh;
  try { fresh = buildPlan(plan.projectRoot, { sourceRoot: plan.sourceRoot }); } catch (error) {
    return { ok: false, reason: "plan-recheck-failed", message: error.message, applied: [], blocked: [] };
  }
  if (fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [], blocked: [] };
  }
  if (!dryRun) {
    const guarded = guardResult(fresh.projectRoot, options);
    if (guarded) return { ...guarded, blocked: [] };
  }
  const backupId = timestamp();
  const applied = [];
  const blocked = fresh.actions.filter((item) => item.action === "conflict" && !force);
  const manifestFiles = {};
  const journal = new Map();
  const createdDirs = new Set();
  const manifestFile = path.join(fresh.projectRoot, MANIFEST_NAME);

  if (blocked.length > 0) {
    return { ok: false, dryRun, applied, blocked, backupId };
  }

  try {
    for (const item of fresh.actions) {
      applyInstallAction(item, {
        dryRun, plan: fresh, backupId, applied, manifestFiles, journal, createdDirs,
      });
    }
    if (!dryRun) {
      assertExpectedHash(manifestFile, fresh.manifestHash);
      rememberFile(journal, manifestFile);
      rememberMissingParents(createdDirs, manifestFile, fresh.projectRoot);
      writeManifest(fresh.projectRoot, {
        schemaVersion: 1,
        package: pkg.name,
        version: pkg.version,
        installedAt: new Date().toISOString(),
        files: manifestFiles,
      });
    }
    return { ok: true, dryRun, planHash: fresh.planHash, applied, blocked, backupId: dryRun ? null : backupId };
  } catch (error) {
    try {
      restoreJournal(journal, createdDirs, fresh.projectRoot);
      removeFailedTransactionBackups(fresh.projectRoot, backupId);
    } catch (rollbackError) {
      return {
        ok: false,
        reason: "write-failed-rollback-failed",
        message: `${error.message}; rollback: ${rollbackError.message}`,
        dryRun,
        applied: [],
        attempted: applied,
        blocked,
        backupId,
      };
    }
    return {
      ok: false,
      reason: "write-failed-rolled-back",
      message: error.message,
      rolledBack: true,
      dryRun,
      applied: [],
      attempted: applied,
      blocked,
      backupId,
    };
  }
}

function buildCleanPlan(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  const manifest = readManifest(projectRoot);
  if (!manifest) return { ok: false, reason: "manifest-missing", actions: [] };
  const actions = [];
  for (const [rel, owned] of Object.entries(manifest.files)) {
    const destination = resolveWithin(projectRoot, rel);
    if (!fs.existsSync(destination)) actions.push({ rel, destination, action: "missing", currentHash: null });
    else {
      const currentHash = hashManagedFile(destination);
      actions.push({ rel, destination, currentHash,
        action: currentHash === owned.installedHash ? "remove" : "preserve" });
    }
  }
  const manifestHash = hashFile(path.join(projectRoot, MANIFEST_NAME));
  const planHash = hashJson({ kind: "asset-clean", projectRoot, manifestHash,
    actions: actions.map(({ rel, action, currentHash }) => ({ rel, action, currentHash })) });
  return { ok: true, projectRoot, manifestHash, actions, planHash };
}

function applyCleanPlan(plan, options = {}) {
  if (!plan || !plan.ok) return { ok: false, reason: plan && plan.reason || "invalid-plan", removed: [], preserved: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", removed: [], preserved: [] };
  if (options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, removed: [], preserved: [] };
  }
  let fresh;
  try { fresh = buildCleanPlan(plan.projectRoot); } catch (error) {
    return { ok: false, reason: "plan-recheck-failed", message: error.message, removed: [], preserved: [] };
  }
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, removed: [], preserved: [] };
  }
  const guarded = guardResult(fresh.projectRoot, options);
  if (guarded) return { ...guarded, removed: [], preserved: [] };
  const backupId = timestamp();
  const backupRoot = resolveWithin(fresh.projectRoot, `${normalizeRel(CLEAN_BACKUP_ROOT_REL)}/${backupId}`);
  const journal = new Map();
  const removed = [];
  const preserved = fresh.actions.filter((item) => item.action === "preserve").map((item) => item.rel);
  const manifestFile = path.join(fresh.projectRoot, MANIFEST_NAME);
  try {
    for (const item of fresh.actions.filter((action) => action.action === "remove")) {
      assertExpectedHash(item.destination, item.currentHash, hashManagedFile);
      rememberFile(journal, item.destination);
      const backup = resolveWithin(fresh.projectRoot, `${normalizeRel(CLEAN_BACKUP_ROOT_REL)}/${backupId}/${item.rel}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(item.destination, backup);
      fs.unlinkSync(item.destination);
      removed.push(item.rel);
    }
    assertExpectedHash(manifestFile, fresh.manifestHash);
    rememberFile(journal, manifestFile);
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.copyFileSync(manifestFile, path.join(backupRoot, MANIFEST_NAME));
    fs.unlinkSync(manifestFile);
    return { ok: true, planHash: fresh.planHash, backupId, removed, preserved };
  } catch (error) {
    try {
      restoreJournal(journal, new Set(), fresh.projectRoot);
      fs.rmSync(backupRoot, { recursive: true, force: true });
      return { ok: false, reason: "write-failed-rolled-back", message: error.message, removed: [], preserved: [], rolledBack: true };
    } catch (rollbackError) {
      return { ok: false, reason: "write-failed-rollback-failed", message: `${error.message}; rollback: ${rollbackError.message}`,
        removed: [], preserved: [], backupId };
    }
  }
}

function clean(projectRootInput, options = {}) {
  const plan = buildCleanPlan(projectRootInput);
  if (options.dryRun === true) return { ...publicCleanPlan(plan), dryRun: true };
  return applyCleanPlan(plan, options);
}

function publicInstallPlan(plan) {
  return { ok: true, kind: "asset-install", projectRoot: plan.projectRoot,
    planHash: plan.planHash, summary: plan.summary,
    actions: plan.actions.map(({ rel, action, sourceHash, currentHash }) => ({ rel, action, sourceHash, currentHash })) };
}

function publicCleanPlan(plan) {
  if (!plan.ok) return plan;
  return { ok: true, kind: "asset-clean", projectRoot: plan.projectRoot, planHash: plan.planHash,
    actions: plan.actions.map(({ rel, action, currentHash }) => ({ rel, action, currentHash })),
    summary: plan.actions.reduce((total, item) => { total[item.action] = (total[item.action] || 0) + 1; return total; }, {}) };
}

function check(projectRootInput) {
  const projectRoot = path.resolve(projectRootInput);
  let manifest;
  try {
    manifest = readManifest(projectRoot);
  } catch (error) {
    return { ok: false, projectRoot, errors: [error.message], drift: [] };
  }
  if (!manifest) {
    return { ok: false, projectRoot, errors: [`缺少 ${MANIFEST_NAME}`], drift: [] };
  }
  const drift = [];
  for (const [rel, owned] of Object.entries(manifest.files)) {
    const destination = resolveWithin(projectRoot, rel);
    if (!fs.existsSync(destination)) drift.push({ rel, status: "missing" });
    else if (hashManagedFile(destination) !== owned.installedHash) drift.push({ rel, status: "modified" });
  }
  return { ok: drift.length === 0, projectRoot, version: manifest.version, errors: [], drift };
}

module.exports = {
  MANIFEST_NAME,
  SOURCE_ROOT,
  applyPlan,
  applyCleanPlan,
  buildPlan,
  buildCleanPlan,
  check,
  clean,
  publicInstallPlan,
  publicCleanPlan,
  sourceEntries,
  walkFiles,
};
