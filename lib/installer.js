"use strict";

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const {
  MANIFEST_NAME,
  hashManagedFile,
  normalizeRel,
  readManifest,
  resolveWithin,
  writeManifest,
} = require("./manifest");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "files");
const BACKUP_ROOT_REL = path.join(".wl-skills-bd", ".state", "backups");

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
  const manifest = readManifest(projectRoot);
  const sources = sourceEntries(options.sourceRoot || SOURCE_ROOT);
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
  return { projectRoot, manifest, sources, actions, summary };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

function backupFile(projectRoot, rel, sourceFile, backupId) {
  const backupRoot = path.join(projectRoot, BACKUP_ROOT_REL, backupId);
  const backup = resolveWithin(backupRoot, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(sourceFile, backup);
  return backup;
}

function rememberFile(journal, file) {
  if (journal.has(file)) return;
  journal.set(file, fs.existsSync(file)
    ? { existed: true, content: fs.readFileSync(file) }
    : { existed: false, content: null });
}

function rememberMissingParents(createdDirs, file, projectRoot) {
  let current = path.dirname(file);
  const root = path.resolve(projectRoot);
  while (current !== root && current.startsWith(root + path.sep)) {
    if (fs.existsSync(current)) break;
    createdDirs.add(current);
    current = path.dirname(current);
  }
}

function removeEmptyDirectories(createdDirs) {
  const ordered = [...createdDirs].sort((left, right) => right.length - left.length);
  for (const dir of ordered) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function restoreJournal(journal, createdDirs) {
  for (const [file, before] of [...journal.entries()].reverse()) {
    const temp = `${file}.${process.pid}.tmp`;
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (before.existed) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, before.content);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  removeEmptyDirectories(createdDirs);
}

function removeFailedTransactionBackups(projectRoot, backupId) {
  const transactionBackupDir = path.join(projectRoot, BACKUP_ROOT_REL, backupId);
  fs.rmSync(transactionBackupDir, { recursive: true, force: true });
}

function applyInstallAction(item, context) {
  const { dryRun, plan, backupId, applied, manifestFiles, journal, createdDirs } = context;
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
    fs.mkdirSync(path.dirname(item.destination), { recursive: true });
    fs.copyFileSync(item.source, item.destination);
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
  const backupId = timestamp();
  const applied = [];
  const blocked = plan.actions.filter((item) => item.action === "conflict" && !force);
  const manifestFiles = {};
  const journal = new Map();
  const createdDirs = new Set();
  const manifestFile = path.join(plan.projectRoot, MANIFEST_NAME);

  if (blocked.length > 0) {
    return { ok: false, dryRun, applied, blocked, backupId };
  }

  try {
    for (const item of plan.actions) {
      applyInstallAction(item, {
        dryRun, plan, backupId, applied, manifestFiles, journal, createdDirs,
      });
    }
    if (!dryRun) {
      rememberFile(journal, manifestFile);
      rememberMissingParents(createdDirs, manifestFile, plan.projectRoot);
      writeManifest(plan.projectRoot, {
        schemaVersion: 1,
        package: pkg.name,
        version: pkg.version,
        installedAt: new Date().toISOString(),
        files: manifestFiles,
      });
    }
    return { ok: true, dryRun, applied, blocked, backupId };
  } catch (error) {
    try {
      restoreJournal(journal, createdDirs);
      removeFailedTransactionBackups(plan.projectRoot, backupId);
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

function clean(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const manifest = readManifest(projectRoot);
  if (!manifest) return { ok: false, reason: "manifest-missing", removed: [], preserved: [] };
  const removed = [];
  const preserved = [];
  for (const [rel, owned] of Object.entries(manifest.files)) {
    const destination = resolveWithin(projectRoot, rel);
    if (!fs.existsSync(destination)) continue;
    if (hashManagedFile(destination) !== owned.installedHash) {
      preserved.push(rel);
      continue;
    }
    if (!options.dryRun) fs.unlinkSync(destination);
    removed.push(rel);
  }
  if (!options.dryRun) fs.unlinkSync(path.join(projectRoot, MANIFEST_NAME));
  return { ok: true, dryRun: options.dryRun === true, removed, preserved };
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
  buildPlan,
  check,
  clean,
  sourceEntries,
  walkFiles,
};
