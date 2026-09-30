"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson } = require("./deterministic");
const {
  hashBuffer,
  hashFile,
  normalizeRel,
  resolveWithin,
  writeTextAtomic,
} = require("./manifest");
const { guardResult } = require("./write-guard");

function currentHash(file) {
  return fs.existsSync(file) ? hashFile(file) : null;
}

function assertExpectedHash(file, expectedHash, hasher = hashFile) {
  const actual = fs.existsSync(file) ? hasher(file) : null;
  if (actual !== (expectedHash || null)) throw new Error(`计划执行期间文件已变化：${file}`);
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

function restoreJournal(journal, createdDirs, projectRoot) {
  for (const [file, before] of [...journal.entries()].reverse()) {
    if (before.existed) writeTextAtomic(file, before.content, { projectRoot });
    else if (fs.existsSync(file)) fs.unlinkSync(resolveWithin(projectRoot, path.relative(projectRoot, file)));
  }
  removeEmptyDirectories(createdDirs);
}

function buildFilePlan(projectRootInput, relInput, content, options = {}) {
  const projectRoot = path.resolve(projectRootInput);
  const rel = normalizeRel(relInput);
  let destination;
  try {
    destination = resolveWithin(projectRoot, rel);
  } catch (error) {
    return { ok: false, reason: "path-outside-project", errors: [{ path: "$.output", message: error.message }] };
  }
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const base = {
    schemaVersion: 1,
    kind: options.kind || "file-write",
    rel,
    currentHash: currentHash(destination),
    contentHash: hashBuffer(contentBuffer),
    metadata: options.metadata || {},
  };
  return {
    ok: true,
    ...base,
    planHash: hashJson(base),
    projectRoot,
    destination,
    content: contentBuffer,
  };
}

function publicFilePlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    rel: plan.rel,
    action: plan.currentHash ? "update" : "add",
    currentHash: plan.currentHash,
    contentHash: plan.contentHash,
    metadata: plan.metadata,
    planHash: plan.planHash,
  };
}

function applyFilePlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, reason: plan.reason || "invalid-plan", errors: plan.errors || [], applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const guarded = guardResult(plan.projectRoot, options);
  if (guarded) return guarded;
  let destination;
  try {
    destination = resolveWithin(plan.projectRoot, plan.rel);
  } catch (error) {
    return { ok: false, reason: "path-outside-project", message: error.message, applied: [] };
  }
  if (currentHash(destination) !== plan.currentHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: plan.planHash, applied: [] };
  }
  const backupId = plan.planHash.slice(0, 16);
  const backupRel = `.wl-skills-bd/.state/file-backups/${backupId}/${plan.rel}`;
  const backup = resolveWithin(plan.projectRoot, backupRel);
  const existed = fs.existsSync(destination);
  const before = existed ? fs.readFileSync(destination) : null;
  try {
    if (existed) writeTextAtomic(backup, before, { projectRoot: plan.projectRoot });
    writeTextAtomic(destination, plan.content, { projectRoot: plan.projectRoot });
    if (hashFile(destination) !== plan.contentHash) throw new Error("写后内容哈希不一致");
  } catch (error) {
    let rollbackError = null;
    try {
      if (existed) writeTextAtomic(destination, before, { projectRoot: plan.projectRoot });
      else if (fs.existsSync(destination)) fs.unlinkSync(destination);
    } catch (cause) {
      rollbackError = cause.message;
    }
    return {
      ok: false,
      reason: rollbackError ? "write-failed-rollback-failed" : "write-failed-rolled-back",
      message: error.message,
      rollbackError,
      applied: [],
    };
  }
  return {
    ok: true,
    state: "applied",
    planHash: plan.planHash,
    rel: plan.rel,
    contentHash: plan.contentHash,
    backup: existed ? normalizeRel(backupRel) : null,
    applied: [{ rel: plan.rel, result: existed ? "updated" : "created" }],
  };
}

module.exports = {
  applyFilePlan,
  assertExpectedHash,
  buildFilePlan,
  publicFilePlan,
  rememberFile,
  rememberMissingParents,
  removeEmptyDirectories,
  restoreJournal,
};
