"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cli = path.resolve(__dirname, "..", "bin", "wl-skills-bd.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-cli-"));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true });
}

try {
  const preview = run(["init", "--target", root, "--dry-run", "--json"]);
  assert.strictEqual(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /"action": "add"/);
  assert.strictEqual(fs.existsSync(path.join(root, ".wl-skills-bd-manifest.json")), false);

  const init = run(["init", "--target", root]);
  assert.strictEqual(init.status, 0, init.stderr);
  assert.ok(fs.existsSync(path.join(root, ".wl-skills-bd-manifest.json")));

  const check = run(["check", "--target", root, "--json"]);
  assert.strictEqual(check.status, 0, check.stderr);
  assert.strictEqual(JSON.parse(check.stdout).ok, true);

  const diff = run(["diff", "--target", root]);
  assert.strictEqual(diff.status, 0, diff.stdout + diff.stderr);

  const contract = ".github/templates/examples/feature-category.contract.json";
  fs.mkdirSync(path.join(root, "contracts", "feature"), { recursive: true });
  fs.copyFileSync(path.join(root, contract), path.join(root, "contracts", "feature", "feature-category.json"));
  fs.writeFileSync(path.join(root, ".wl-skills-bd", "catalog.config.json"), `${JSON.stringify({
    schemaVersion: 1,
    project: { id: "wl-cli", name: "CLI 测试" },
    docsRoot: "docs/backend",
    commit: { types: ["feat", "fix", "docs"], requireDetailSeparator: true, maxHeaderLength: 100 },
    modules: {
      feature: { displayName: "特征", contractRoots: ["contracts/feature"], sourceRoots: ["src/main"], upstream: [], downstream: [], owners: ["test-team"] },
    },
  }, null, 2)}\n`, "utf8");

  const implicitCatalog = run(["catalog", "plan", "--target", root, "--json"]);
  assert.strictEqual(implicitCatalog.status, 1, "目录不得隐式全量扫描");
  const catalogPreview = run(["catalog", "plan", "--module", "feature", "--target", root, "--json"]);
  assert.strictEqual(catalogPreview.status, 0, catalogPreview.stderr);
  const catalogPlan = JSON.parse(catalogPreview.stdout);
  assert.deepStrictEqual(catalogPlan.scannedModules, ["feature"]);
  const catalogApply = run(["catalog", "apply", "--module", "feature", "--target", root, "--plan-hash", catalogPlan.planHash, "--confirm", "--json"]);
  assert.strictEqual(catalogApply.status, 0, catalogApply.stderr);
  const context = run(["context", "plan", "--module", "feature", "--task", "增加特征接口", "--target", root, "--json"]);
  assert.strictEqual(context.status, 0, context.stderr);
  assert.deepStrictEqual(JSON.parse(context.stdout).scanPolicy.scannedModules, ["feature"]);
  const commit = run(["commit", "validate", "--message", "feat(feature): 特征分类-增加幂等校验", "--target", root, "--json"]);
  assert.strictEqual(commit.status, 0, commit.stderr);

  const contractValidation = run(["codegen", "validate", contract, "--target", root, "--json"]);
  assert.strictEqual(contractValidation.status, 0, contractValidation.stderr);
  assert.strictEqual(JSON.parse(contractValidation.stdout).ok, true);

  const codegenPlan = run(["codegen", "plan", contract, "--target", root, "--json"]);
  assert.strictEqual(codegenPlan.status, 0, codegenPlan.stderr);
  const generatedPlan = JSON.parse(codegenPlan.stdout);
  assert.strictEqual(generatedPlan.actions.length, 17);

  const unconfirmed = run(["codegen", "apply", contract, "--target", root, "--plan-hash", generatedPlan.planHash, "--json"]);
  assert.strictEqual(unconfirmed.status, 2);
  assert.strictEqual(JSON.parse(unconfirmed.stdout).reason, "confirm-required");

  const generated = run(["codegen", "apply", contract, "--target", root, "--plan-hash", generatedPlan.planHash, "--confirm", "--json"]);
  assert.strictEqual(generated.status, 0, generated.stderr);
  assert.strictEqual(JSON.parse(generated.stdout).applied.length, 17);

  const contractShow = run(["contract", "show", contract, "--target", root, "--format", "json"]);
  assert.strictEqual(contractShow.status, 0, contractShow.stderr);
  assert.strictEqual(JSON.parse(contractShow.stdout).transport.successCode, 2000);

  const contractDiff = run(["contract", "diff", contract, "--target", root, "--frontend", "docs/contracts/mdm-feature-category.api.md", "--json"]);
  assert.strictEqual(contractDiff.status, 0, contractDiff.stderr);
  assert.strictEqual(JSON.parse(contractDiff.stdout).ok, true);
  const strictContractDiff = run(["contract", "diff", contract, "--target", root, "--frontend", "docs/contracts/mdm-feature-category.api.md", "--strict", "--json"]);
  assert.strictEqual(strictContractDiff.status, 0, strictContractDiff.stderr);
  assert.strictEqual(JSON.parse(strictContractDiff.stdout).ok, true);

  const permissionPreview = run(["permissions", "export", contract, "--target", root, "--output", "reports/SYS_PERMISSION_INFO.md", "--json"]);
  assert.strictEqual(permissionPreview.status, 0, permissionPreview.stderr);
  const permissionPlan = JSON.parse(permissionPreview.stdout);
  assert.strictEqual(fs.existsSync(path.join(root, "reports", "SYS_PERMISSION_INFO.md")), false, "权限预览不得写文件");
  const permissionApply = run(["permissions", "export", contract, "--target", root, "--output", "reports/SYS_PERMISSION_INFO.md", "--plan-hash", permissionPlan.planHash, "--confirm", "--json"]);
  assert.strictEqual(permissionApply.status, 0, permissionApply.stderr);
  assert.strictEqual(fs.existsSync(path.join(root, "reports", "SYS_PERMISSION_INFO.md")), true);

  const fixPlan = run(["fix", "plan", "src/main", "--rules", "B3,B5", "--target", root, "--json"]);
  assert.strictEqual(fixPlan.status, 0, fixPlan.stderr);
  assert.strictEqual(JSON.parse(fixPlan.stdout).mode, "preview");

  const unsafeFix = run(["fix", "plan", "src/main", "--rules", "B1", "--target", root, "--json"]);
  assert.strictEqual(unsafeFix.status, 1);
  assert.strictEqual(JSON.parse(unsafeFix.stdout).reason, "unsupported-rules");

  const report = run(["validate", ".", "--target", root, "--format", "sarif", "--output", "reports/backend.sarif"]);
  assert.ok([0, 1].includes(report.status), report.stderr);
  const sarif = JSON.parse(fs.readFileSync(path.join(root, "reports", "backend.sarif"), "utf8"));
  assert.strictEqual(sarif.version, "2.1.0");

  const doctor = run(["doctor", "--target", root, "--json"]);
  assert.strictEqual(doctor.status, 1, "无 pom 的目录 doctor 必须失败");

  console.log("✅ CLI：安装、模块目录、一跳上下文、提交校验、契约生成门与 doctor 退出码通过");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
