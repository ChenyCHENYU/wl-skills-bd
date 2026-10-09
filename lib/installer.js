"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pkg = require("../package.json");
const { hashJson } = require("./deterministic");
const { assertExpectedHash, rememberFile, rememberMissingParents, removeEmptyDirectories, restoreJournal } = require("./file-transaction");
const { guardResult } = require("./write-guard");
const shared = require("./shared-assets");
const { getJsoncNodeText } = require("./shared-jsonc.cjs");
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
const OWNER = "wl-skills-bd";
const MCP_FILES = new Set([".cursor/mcp.json", ".kiro/settings/mcp.json", ".vscode/mcp.json", ".mcp.json"]);
const PROJECT_PROFILE = ".wl-skills-bd/contracts/wl-delivery-profile.v1.json";
function projectConfiguration(rel) {
  return rel === PROJECT_PROFILE || rel === ".wl-skills-bd/config.json" || rel.startsWith(".wl-skills-bd/profiles/");
}

function planContribution(entry, current, owned) {
  const text = fs.readFileSync(entry.source, "utf8");
  // Java 工程可无 npm 依赖；宿主使用本次安装版本，避免 npx 漂到另一套规则。
  const source = MCP_FILES.has(entry.rel) ? text.replace(/"@agile-team\/wl-skills-bd"/g, JSON.stringify(`${pkg.name}@${pkg.version}`)) : text;
  if (shared.SHARED_MARKDOWN.has(entry.rel)) return shared.planMarkdown(current, source, owned, OWNER, true);
  return shared.planMcp(current, source, owned, OWNER, true);
}

function removalContent(destination, owned) {
  const current = fs.readFileSync(destination, "utf8");
  try {
    if (owned.kind === "block") return shared.removeMarkdown(current, owned, OWNER);
    if (owned.kind === "mcp") return shared.removeMcp(current, owned, OWNER);
  } catch { return { content: current, preserved: true }; }
  return { content: current, preserved: owned.kind === "reference" };
}

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
  shared.preflight(projectRoot, MANIFEST_NAME);
  shared.preflight(projectRoot, `${normalizeRel(BACKUP_ROOT_REL)}/preflight/file`);
  shared.preflight(projectRoot, `${normalizeRel(CLEAN_BACKUP_ROOT_REL)}/preflight/file`);

  for (const entry of sources.values()) {
    shared.preflight(projectRoot, entry.rel);
    const destination = resolveWithin(projectRoot, entry.rel);
    const owned = manifest && manifest.files[entry.rel];
    if (shared.SHARED_MARKDOWN.has(entry.rel) || MCP_FILES.has(entry.rel)) {
      const current = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : null;
      const currentHash = current === null ? null : hashManagedFile(destination);
      try {
        const planned = planContribution(entry, current, owned);
        const changed = current !== planned.content;
        const modified = owned && ["block", "mcp"].includes(owned.kind)
          && current !== null && shared.contributionModified(current, owned, OWNER);
        actions.push({ ...entry, destination, currentHash, content: planned.content, record: planned.record,
          action: modified ? "conflict" : changed ? (current === null ? "add" : "update") : "unchanged",
          forceable: Boolean(owned && ["block", "mcp"].includes(owned.kind)) });
      } catch (error) {
        actions.push({ ...entry, destination, currentHash, action: "conflict", forceable: false, reason: error.message });
      }
      continue;
    }
    if (!fs.existsSync(destination)) {
      actions.push({ ...entry, destination, action: "add", record: { kind: "file", sourceHash: entry.sourceHash, installedHash: entry.sourceHash } });
      continue;
    }
    const currentHash = hashManagedFile(destination);
    if (projectConfiguration(entry.rel) && currentHash !== entry.sourceHash && (!owned || owned.kind === "reference" || currentHash !== owned.installedHash)) {
      actions.push({ ...entry, destination, currentHash, action: "unchanged", record: {
        kind: "reference", projectOwned: true, installedHash: currentHash, sourceHash: entry.sourceHash,
      } });
      continue;
    }
    if (currentHash === entry.sourceHash) {
      actions.push({ ...entry, destination, currentHash, action: "unchanged", record: {
        kind: owned && owned.kind !== "reference" ? "file" : "reference", sourceHash: entry.sourceHash, installedHash: entry.sourceHash,
      } });
      continue;
    }
    if (owned && owned.kind !== "reference" && currentHash === owned.installedHash) {
      actions.push({ ...entry, destination, currentHash, action: "update", record: { kind: "file", sourceHash: entry.sourceHash, installedHash: entry.sourceHash } });
      continue;
    }
    actions.push({ ...entry, destination, currentHash, action: "conflict", forceable: Boolean(owned && owned.kind !== "reference"),
      record: { kind: "file", sourceHash: entry.sourceHash, installedHash: entry.sourceHash } });
  }

  if (manifest) {
    for (const [rel, owned] of Object.entries(manifest.files)) {
      if (sources.has(rel)) continue;
      shared.preflight(projectRoot, rel);
      const destination = resolveWithin(projectRoot, rel);
      if (!fs.existsSync(destination)) {
        actions.push({ rel, destination, action: "stale-missing" });
        continue;
      }
      const currentHash = hashManagedFile(destination);
      if (["block", "mcp", "reference"].includes(owned.kind)) {
        const removed = removalContent(destination, owned);
        actions.push({ rel, destination, currentHash, content: removed.content, keepFile: removed.keepFile === true,
          action: removed.preserved ? "preserve-stale" : removed.content || removed.keepFile ? "update-stale" : "remove-stale" });
        continue;
      }
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
      sourceHash: item.sourceHash || null, currentHash: item.currentHash || null,
      contentHash: item.content === undefined ? null : shared.hash(item.content), record: item.record || null, forceable: item.forceable || false })),
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
  if (["remove-stale", "update-stale"].includes(item.action)) {
    if (!dryRun) {
      rememberFile(journal, item.destination);
      if (item.action === "update-stale") writeTextAtomic(item.destination, item.content, { projectRoot: plan.projectRoot });
      else fs.unlinkSync(item.destination);
    }
    applied.push({ ...item, result: dryRun ? "would-remove" : "removed" });
    return;
  }
  if (item.action === "unchanged") {
    manifestFiles[item.rel] = item.record;
    applied.push({ ...item, result: "unchanged" });
    return;
  }
  if (!dryRun) {
    rememberFile(journal, item.destination);
    rememberMissingParents(createdDirs, item.destination, plan.projectRoot);
    if (fs.existsSync(item.destination) && ["update", "conflict"].includes(item.action)) {
      backupFile(plan.projectRoot, item.rel, item.destination, backupId);
    }
    writeTextAtomic(item.destination, item.content === undefined ? fs.readFileSync(item.source) : item.content, { projectRoot: plan.projectRoot });
    assertExpectedHash(item.destination, item.content === undefined ? item.sourceHash : shared.hash(item.content), hashManagedFile);
    if (process.platform !== "win32" && /(?:^|\/)\.?(?:git-hooks|githooks)\/commit-msg$/.test(item.rel)) {
      fs.chmodSync(item.destination, 0o755);
    }
  }
  manifestFiles[item.rel] = item.record;
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
  const blocked = fresh.actions.filter((item) => item.action === "conflict" && (!force || !item.forceable));
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
  shared.preflight(projectRoot, MANIFEST_NAME);
  shared.preflight(projectRoot, `${normalizeRel(CLEAN_BACKUP_ROOT_REL)}/preflight/file`);
  for (const [rel, owned] of Object.entries(manifest.files)) {
    shared.preflight(projectRoot, rel);
    const destination = resolveWithin(projectRoot, rel);
    if (!fs.existsSync(destination)) actions.push({ rel, destination, action: "missing", currentHash: null });
    else {
      const currentHash = hashManagedFile(destination);
      if (["block", "mcp", "reference"].includes(owned.kind)) {
        const removed = removalContent(destination, owned);
        actions.push({ rel, destination, currentHash, content: removed.content, keepFile: removed.keepFile === true,
          action: removed.preserved ? "preserve" : "remove" });
        continue;
      }
      actions.push({ rel, destination, currentHash,
        action: currentHash === owned.installedHash ? "remove" : "preserve" });
    }
  }
  const manifestHash = hashFile(path.join(projectRoot, MANIFEST_NAME));
  const planHash = hashJson({ kind: "asset-clean", projectRoot, manifestHash,
    actions: actions.map(({ rel, action, currentHash, content, keepFile }) => ({ rel, action, currentHash, keepFile: keepFile === true,
      contentHash: content === undefined ? null : shared.hash(content) })) });
  return { ok: true, projectRoot, manifest, manifestHash, actions, planHash };
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
      if (item.content || item.keepFile) writeTextAtomic(item.destination, item.content, { projectRoot: fresh.projectRoot });
      else fs.unlinkSync(item.destination);
      removed.push(item.rel);
    }
    assertExpectedHash(manifestFile, fresh.manifestHash);
    rememberFile(journal, manifestFile);
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.copyFileSync(manifestFile, path.join(backupRoot, MANIFEST_NAME));
    const retained = {};
    for (const item of fresh.actions.filter((action) => action.action === "preserve")) {
      const old = fresh.manifest.files[item.rel];
      let scope = old.kind === "block" || old.scope === "block" ? "block" : old.kind === "mcp" || old.scope === "mcp" ? "mcp" : "file";
      let installedHash;
      try { installedHash = shared.contributionHash(fs.readFileSync(item.destination, "utf8"), { ...old, kind: "reference", scope }, OWNER); }
      catch { scope = "file"; installedHash = item.currentHash; }
      retained[item.rel] = { ...old, kind: "reference", scope, installedHash, retained: true, previousInstalledHash: old.installedHash };
      if (scope === "mcp") {
        const nodeText = getJsoncNodeText(fs.readFileSync(item.destination, "utf8"), [old.container, OWNER]);
        retained[item.rel].installedTextHash = nodeText === undefined ? undefined : shared.hash(nodeText);
      }
    }
    if (Object.keys(retained).length) writeManifest(fresh.projectRoot, { ...fresh.manifest, files: retained, retained: true });
    else fs.unlinkSync(manifestFile);
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
    else {
      try {
        if (["block", "mcp"].includes(owned.kind) || ["block", "mcp"].includes(owned.scope)
          ? shared.contributionModified(fs.readFileSync(destination, "utf8"), owned, OWNER)
          : hashManagedFile(destination) !== owned.installedHash) drift.push({ rel, status: "modified" });
      } catch { drift.push({ rel, status: "modified" }); }
    }
  }
  return { ok: drift.length === 0, projectRoot, version: manifest.version, retained: manifest.retained === true, errors: [], drift };
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
