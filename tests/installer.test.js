"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const installer = require("../lib/installer");
const { resolveWithin } = require("../lib/manifest");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-"));

try {
  const initialPlan = installer.buildPlan(root);
  assert.ok(initialPlan.actions.length > 20, "应发现待安装资产");
  assert.ok(initialPlan.actions.every((item) => item.action === "add"));

  const installed = installer.applyPlan(initialPlan);
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(installer.check(root).ok, true);
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
  const blocked = installer.applyPlan(conflictPlan);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(fs.existsSync(path.join(root, missingRel)), false, "冲突时必须零写入");

  const forced = installer.applyPlan(conflictPlan, { force: true });
  assert.strictEqual(forced.ok, true);
  assert.strictEqual(installer.check(root).ok, true);
  assert.ok(
    fs.existsSync(path.join(root, ".wl-skills-bd", ".state", "backups", forced.backupId, conflictRel)),
    "force 覆盖前必须备份",
  );

  fs.appendFileSync(conflictFile, "\nuser-owned\n", "utf8");
  const cleaned = installer.clean(root);
  assert.strictEqual(cleaned.ok, true);
  assert.ok(cleaned.preserved.includes(conflictRel));
  assert.ok(fs.existsSync(conflictFile), "clean 必须保留被用户修改的文件");
  assert.strictEqual(fs.existsSync(path.join(root, installer.MANIFEST_NAME)), false);

  assert.throws(() => resolveWithin(root, "../outside"), /非法相对路径|路径越界/);
  console.log("✅ installer：manifest、零写入冲突、备份、clean 保护与路径边界通过");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
