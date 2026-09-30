"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const installer = require("../lib/installer");
const { resolveWithin } = require("../lib/manifest");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-"));
const apply = (plan, options = {}) => installer.applyPlan(plan, { confirm: true, planHash: plan.planHash, ...options });

try {
  const initialPlan = installer.buildPlan(root);
  assert.ok(initialPlan.actions.length > 20, "应发现待安装资产");
  assert.ok(initialPlan.actions.every((item) => item.action === "add"));

  assert.strictEqual(installer.applyPlan(initialPlan).reason, "confirm-required");
  const installed = apply(initialPlan);
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(installer.check(root).ok, true);

  const eolRel = ".github/standards/01-toolchain.md";
  const eolFile = path.join(root, eolRel);
  const lfContent = fs.readFileSync(eolFile, "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(eolFile, lfContent.replace(/\n/g, "\r\n"), "utf8");
  assert.strictEqual(
    installer.check(root).ok,
    true,
    "仅 LF/CRLF 不同不应被判定为受管文件漂移",
  );
  const eolPlan = installer.buildPlan(root);
  assert.strictEqual(
    eolPlan.actions.find((item) => item.rel === eolRel).action,
    "unchanged",
    "Windows CRLF 检出不应被误判为本地冲突",
  );
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "profile.local.json"), JSON.stringify({
    schemaVersion: 1,
    profileId: "jh4j3-openapi3",
    softDelete: { activeValue: 0, deletedValue: 4 },
  }));
  assert.strictEqual(installer.check(root).ok, true, "未受管 profile.local 不应制造安装漂移");

  const conflictRel = ".cursor/mcp.json";
  const missingRel = ".vscode/mcp.json";
  const conflictFile = path.join(root, conflictRel);
  fs.appendFileSync(conflictFile, "\nlocal-change\n", "utf8");
  fs.unlinkSync(path.join(root, missingRel));

  const conflictPlan = installer.buildPlan(root);
  assert.ok(conflictPlan.actions.some((item) => item.rel === conflictRel && item.action === "conflict"));
  assert.ok(conflictPlan.actions.some((item) => item.rel === missingRel && item.action === "add"));
  const blocked = apply(conflictPlan);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(fs.existsSync(path.join(root, missingRel)), false, "冲突时必须零写入");

  const forced = apply(conflictPlan, { force: true });
  assert.strictEqual(forced.ok, true);
  assert.strictEqual(installer.check(root).ok, true);
  assert.ok(
    fs.existsSync(path.join(root, ".wl-skills-bd", ".state", "backups", forced.backupId, conflictRel)),
    "force 覆盖前必须备份",
  );

  fs.appendFileSync(conflictFile, "\nuser-owned\n", "utf8");
  const cleanPlan = installer.buildCleanPlan(root);
  assert.strictEqual(installer.applyCleanPlan(cleanPlan).reason, "confirm-required");
  const cleaned = installer.applyCleanPlan(cleanPlan, { confirm: true, planHash: cleanPlan.planHash });
  assert.strictEqual(cleaned.ok, true);
  assert.ok(cleaned.preserved.includes(conflictRel));
  assert.ok(fs.existsSync(conflictFile), "clean 必须保留被用户修改的文件");
  assert.strictEqual(fs.existsSync(path.join(root, installer.MANIFEST_NAME)), false);

  assert.throws(() => resolveWithin(root, "../outside"), /非法相对路径|路径越界/);

  const rollbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-rollback-"));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-source-"));
  try {
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "before-a\n");
    fs.writeFileSync(path.join(sourceRoot, "b.txt"), "before-b\n");
    assert.strictEqual(
      apply(installer.buildPlan(rollbackRoot, { sourceRoot })).ok,
      true,
    );
    const manifestBefore = fs.readFileSync(path.join(rollbackRoot, installer.MANIFEST_NAME));
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "after-a\n");
    fs.writeFileSync(path.join(sourceRoot, "b.txt"), "after-b\n");
    const failingPlan = installer.buildPlan(rollbackRoot, { sourceRoot });
    const originalRename = fs.renameSync;
    let injected = false;
    fs.renameSync = (from, to) => {
      if (to === path.join(rollbackRoot, "b.txt") && !injected) {
        injected = true;
        throw new Error("injected write failure");
      }
      return originalRename(from, to);
    };
    let rolledBack;
    try { rolledBack = apply(failingPlan); } finally { fs.renameSync = originalRename; }
    assert.strictEqual(rolledBack.ok, false);
    assert.strictEqual(rolledBack.reason, "write-failed-rolled-back");
    assert.strictEqual(rolledBack.rolledBack, true);
    assert.strictEqual(fs.readFileSync(path.join(rollbackRoot, "a.txt"), "utf8"), "before-a\n");
    assert.deepStrictEqual(
      fs.readFileSync(path.join(rollbackRoot, installer.MANIFEST_NAME)),
      manifestBefore,
      "中途失败必须恢复原 manifest",
    );
    assert.strictEqual(
      fs.existsSync(path.join(rollbackRoot, ".wl-skills-bd", ".state", "backups", rolledBack.backupId)),
      false,
      "失败事务完成回滚后不得残留本次临时备份目录",
    );
  } finally {
    fs.rmSync(rollbackRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-drift-"));
  const driftSource = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-drift-source-"));
  try {
    fs.writeFileSync(path.join(driftSource, "a.txt"), "package\n");
    const addPlan = installer.buildPlan(driftRoot, { sourceRoot: driftSource });
    fs.writeFileSync(path.join(driftRoot, "a.txt"), "user\n");
    assert.strictEqual(apply(addPlan).reason, "plan-changed");
    assert.strictEqual(fs.readFileSync(path.join(driftRoot, "a.txt"), "utf8"), "user\n");
    fs.unlinkSync(path.join(driftRoot, "a.txt"));
    assert.strictEqual(apply(installer.buildPlan(driftRoot, { sourceRoot: driftSource })).ok, true);
    const cleanPlan = installer.buildCleanPlan(driftRoot);
    fs.appendFileSync(path.join(driftRoot, "a.txt"), "local\n");
    assert.strictEqual(installer.applyCleanPlan(cleanPlan, { confirm: true, planHash: cleanPlan.planHash }).reason, "plan-changed");
    assert.strictEqual(fs.existsSync(path.join(driftRoot, installer.MANIFEST_NAME)), true);
  } finally {
    fs.rmSync(driftRoot, { recursive: true, force: true });
    fs.rmSync(driftSource, { recursive: true, force: true });
  }
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-clean-rollback-"));
  const cleanSource = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-clean-source-"));
  try {
    fs.writeFileSync(path.join(cleanSource, "a.txt"), "a\n");
    fs.writeFileSync(path.join(cleanSource, "b.txt"), "b\n");
    assert.strictEqual(apply(installer.buildPlan(cleanRoot, { sourceRoot: cleanSource })).ok, true);
    const cleanPlan = installer.buildCleanPlan(cleanRoot);
    const originalUnlink = fs.unlinkSync;
    let injected = false;
    fs.unlinkSync = (file) => {
      if (file === path.join(cleanRoot, "b.txt") && !injected) {
        injected = true;
        throw new Error("injected clean failure");
      }
      return originalUnlink(file);
    };
    let failedClean;
    try { failedClean = installer.applyCleanPlan(cleanPlan, { confirm: true, planHash: cleanPlan.planHash }); }
    finally { fs.unlinkSync = originalUnlink; }
    assert.strictEqual(failedClean.reason, "write-failed-rolled-back");
    assert.strictEqual(fs.readFileSync(path.join(cleanRoot, "a.txt"), "utf8"), "a\n");
    assert.strictEqual(fs.readFileSync(path.join(cleanRoot, "b.txt"), "utf8"), "b\n");
    assert.strictEqual(fs.existsSync(path.join(cleanRoot, installer.MANIFEST_NAME)), true);
    const retryCleanPlan = installer.buildCleanPlan(cleanRoot);
    const successfulClean = installer.applyCleanPlan(retryCleanPlan, { confirm: true, planHash: retryCleanPlan.planHash });
    assert.strictEqual(successfulClean.ok, true);
    assert.ok(fs.existsSync(path.join(cleanRoot, ".wl-skills-bd", ".state", "clean-backups", successfulClean.backupId, "a.txt")));
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
    fs.rmSync(cleanSource, { recursive: true, force: true });
  }
  const raceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-race-"));
  const raceSource = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-race-source-"));
  try {
    fs.writeFileSync(path.join(raceSource, "a.txt"), "old-a\n");
    fs.writeFileSync(path.join(raceSource, "b.txt"), "old-b\n");
    assert.strictEqual(apply(installer.buildPlan(raceRoot, { sourceRoot: raceSource })).ok, true);
    fs.writeFileSync(path.join(raceSource, "a.txt"), "new-a\n");
    fs.writeFileSync(path.join(raceSource, "b.txt"), "new-b\n");
    const racePlan = installer.buildPlan(raceRoot, { sourceRoot: raceSource });
    const originalRename = fs.renameSync;
    let changed = false;
    fs.renameSync = (from, to) => {
      const value = originalRename(from, to);
      if (to === path.join(raceRoot, "a.txt") && !changed) {
        changed = true;
        fs.writeFileSync(path.join(raceRoot, "b.txt"), "user-b\n");
      }
      return value;
    };
    let aborted;
    try { aborted = apply(racePlan); } finally { fs.renameSync = originalRename; }
    assert.strictEqual(aborted.reason, "write-failed-rolled-back");
    assert.strictEqual(fs.readFileSync(path.join(raceRoot, "a.txt"), "utf8"), "old-a\n");
    assert.strictEqual(fs.readFileSync(path.join(raceRoot, "b.txt"), "utf8"), "user-b\n", "并发本地修改不得被覆盖");

    fs.writeFileSync(path.join(raceRoot, "b.txt"), "old-b\n");
    const cleanRacePlan = installer.buildCleanPlan(raceRoot);
    const originalUnlink = fs.unlinkSync;
    changed = false;
    fs.unlinkSync = (file) => {
      const value = originalUnlink(file);
      if (file === path.join(raceRoot, "a.txt") && !changed) {
        changed = true;
        fs.writeFileSync(path.join(raceRoot, "b.txt"), "user-clean-b\n");
      }
      return value;
    };
    let cleanAborted;
    try { cleanAborted = installer.applyCleanPlan(cleanRacePlan, { confirm: true, planHash: cleanRacePlan.planHash }); }
    finally { fs.unlinkSync = originalUnlink; }
    assert.strictEqual(cleanAborted.reason, "write-failed-rolled-back");
    assert.strictEqual(fs.readFileSync(path.join(raceRoot, "a.txt"), "utf8"), "old-a\n");
    assert.strictEqual(fs.readFileSync(path.join(raceRoot, "b.txt"), "utf8"), "user-clean-b\n");
    assert.ok(fs.existsSync(path.join(raceRoot, installer.MANIFEST_NAME)));
  } finally {
    fs.rmSync(raceRoot, { recursive: true, force: true });
    fs.rmSync(raceSource, { recursive: true, force: true });
  }
  console.log("✅ installer：manifest、零写入冲突、备份、clean 保护、事务回滚与路径边界通过");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
