"use strict";

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const {
  MANIFEST_NAME,
  hashFile,
  normalizeRel,
  readManifest,
  resolveWithin,
  writeManifest,
} = require("./manifest");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "files");

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
    entries.set(rel, { rel, source, sourceHash: hashFile(source) });
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
    const currentHash = hashFile(destination);
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
      const currentHash = hashFile(destination);
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
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function backupFile(projectRoot, rel, sourceFile, backupId) {
  const backupRoot = path.join(projectRoot, ".wl-skills-bd", ".state", "backups", backupId);
  const backup = resolveWithin(backupRoot, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(sourceFile, backup);
  return backup;
}

function applyPlan(plan, options = {}) {
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const backupId = timestamp();
  const applied = [];
  const blocked = plan.actions.filter((item) => item.action === "conflict" && !force);
  const manifestFiles = {};

  if (blocked.length > 0) {
    return { ok: false, dryRun, applied, blocked, backupId };
  }

  for (const item of plan.actions) {
    if (["preserve-stale", "stale-missing"].includes(item.action)) {
      applied.push({ ...item, result: "preserved" });
      continue;
    }
    if (item.action === "remove-stale") {
      if (!dryRun) fs.unlinkSync(item.destination);
      applied.push({ ...item, result: dryRun ? "would-remove" : "removed" });
      continue;
    }

    if (item.action === "unchanged") {
      manifestFiles[item.rel] = {
        sourceHash: item.sourceHash,
        installedHash: item.sourceHash,
      };
      applied.push({ ...item, result: "unchanged" });
      continue;
    }

    if (!dryRun) {
      if (fs.existsSync(item.destination) && ["update", "conflict"].includes(item.action)) {
        backupFile(plan.projectRoot, item.rel, item.destination, backupId);
      }
      fs.mkdirSync(path.dirname(item.destination), { recursive: true });
      fs.copyFileSync(item.source, item.destination);
    }
    manifestFiles[item.rel] = {
      sourceHash: item.sourceHash,
      installedHash: item.sourceHash,
    };
    applied.push({ ...item, result: dryRun ? `would-${item.action}` : item.action });
  }

  if (!dryRun && blocked.length === 0) {
    writeManifest(plan.projectRoot, {
      schemaVersion: 1,
      package: pkg.name,
      version: pkg.version,
      installedAt: new Date().toISOString(),
      files: manifestFiles,
    });
  }
  return { ok: blocked.length === 0, dryRun, applied, blocked, backupId };
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
    if (hashFile(destination) !== owned.installedHash) {
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
    else if (hashFile(destination) !== owned.installedHash) drift.push({ rel, status: "modified" });
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
