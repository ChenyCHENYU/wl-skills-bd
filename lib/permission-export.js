"use strict";

const fs = require("fs");
const path = require("path");
const collaboration = require("./collaboration");
const { loadContract } = require("./contract");
const { hashJson } = require("./deterministic");
const { hashBuffer, hashFile, resolveWithin, writeTextAtomic } = require("./manifest");
const { guardResult } = require("./write-guard");

function buildPermissionExportPlan(contractFile, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const loaded = loadContract(contractFile, { projectRoot });
  if (!loaded.ok) return { ok: false, projectRoot, contractFile: loaded.file, errors: loaded.errors, actions: [] };
  const manifest = collaboration.buildManifest(loaded.contract, loaded.profile, loaded.deliveryProfile);
  const inventory = collaboration.buildPermissionInventory(manifest);
  const content = collaboration.renderPermissionInventoryMarkdown(inventory);
  const outputRel = options.output || `reports/SYS_PERMISSION_INFO_${inventory.contractId}.md`;
  let destination;
  try {
    destination = resolveWithin(projectRoot, outputRel);
  } catch (error) {
    return { ok: false, projectRoot, contractFile: loaded.file, errors: [{ path: "$.output", message: error.message }], actions: [] };
  }
  const contentHash = hashBuffer(Buffer.from(content, "utf8"));
  const currentHash = fs.existsSync(destination) ? hashFile(destination) : null;
  const action = currentHash === null ? "add" : (currentHash === contentHash ? "unchanged" : "update");
  const planHash = hashJson({
    schemaVersion: 1,
    contractId: loaded.contract.contractId,
    outputRel,
    currentHash,
    contentHash,
  });
  return {
    ok: true,
    projectRoot,
    contractFile: loaded.file,
    contract: loaded.contract,
    inventory,
    outputRel,
    destination,
    content,
    currentHash,
    contentHash,
    action,
    planHash,
  };
}

function applyPermissionExportPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, errors: plan.errors || [], applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const guarded = guardResult(plan.projectRoot, options, plan.contract);
  if (guarded) return guarded;
  const fresh = buildPermissionExportPlan(plan.contractFile, { projectRoot: plan.projectRoot, output: plan.outputRel });
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, errors: fresh.errors, applied: [] };
  }
  if (fresh.action === "unchanged") {
    return { ok: true, planHash: fresh.planHash, output: fresh.outputRel, inventory: fresh.inventory, applied: [{ rel: fresh.outputRel, result: "unchanged" }] };
  }
  const backupId = `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${fresh.planHash.slice(0, 12)}`;
  const backup = fresh.currentHash
    ? resolveWithin(fresh.projectRoot, `.wl-skills-bd/.state/permission-backups/${backupId}/${fresh.outputRel}`)
    : null;
  const original = fresh.currentHash ? fs.readFileSync(fresh.destination) : null;
  try {
    if (backup) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, original);
    }
    writeTextAtomic(fresh.destination, fresh.content);
    if (hashFile(fresh.destination) !== fresh.contentHash) throw new Error("权限清单写后哈希校验失败");
  } catch (error) {
    try {
      if (original) writeTextAtomic(fresh.destination, original);
      else if (fs.existsSync(fresh.destination)) fs.unlinkSync(fresh.destination);
    } catch (rollbackError) {
      return { ok: false, reason: "write-failed-rollback-failed", message: `${error.message}; rollback: ${rollbackError.message}`, applied: [] };
    }
    return { ok: false, reason: "write-failed-rolled-back", message: error.message, applied: [] };
  }
  return {
    ok: true,
    planHash: fresh.planHash,
    backupId,
    output: fresh.outputRel,
    inventory: fresh.inventory,
    applied: [{ rel: fresh.outputRel, result: fresh.action }],
  };
}

function publicPermissionExportPlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    state: "previewed",
    output: plan.outputRel,
    action: plan.action,
    planHash: plan.planHash,
    currentHash: plan.currentHash,
    contentHash: plan.contentHash,
    inventory: plan.inventory,
    markdown: plan.content,
  };
}

module.exports = { applyPermissionExportPlan, buildPermissionExportPlan, publicPermissionExportPlan };
