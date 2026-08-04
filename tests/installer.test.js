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

  const rollbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-rollback-"));
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-installer-source-"));
  try {
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "before-a\n");
    fs.writeFileSync(path.join(sourceRoot, "b.txt"), "before-b\n");
    assert.strictEqual(
      installer.applyPlan(installer.buildPlan(rollbackRoot, { sourceRoot })).ok,
      true,
    );
    const manifestBefore = fs.readFileSync(path.join(rollbackRoot, installer.MANIFEST_NAME));
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "after-a\n");
    fs.writeFileSync(path.join(sourceRoot, "b.txt"), "after-b\n");
    const failingPlan = installer.buildPlan(rollbackRoot, { sourceRoot });
    fs.unlinkSync(path.join(sourceRoot, "b.txt"));
    const rolledBack = installer.applyPlan(failingPlan);
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
  console.log("✅ installer：manifest、零写入冲突、备份、clean 保护、事务回滚与路径边界通过");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
