"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  collectCoverage,
  evaluateQualityGate,
  loadQualityGate,
  parseJacocoXml,
} = require("../lib/quality-gate");
const { buildReviewBaselinePlan, compactModuleEvidence, runReview, stabilizeFindingFingerprints } = require("../lib/review");

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wls-review-"));
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("quality gate 区分新增、基线与有期限豁免", () => {
  const rows = [
    { rule: "B1", severity: "error", file: "A.java", line: 1, message: "new", fingerprint: "new" },
    { rule: "B2", severity: "error", file: "B.java", line: 1, message: "old", fingerprint: "old" },
    { rule: "B3", severity: "error", file: "C.xml", line: 1, message: "waived", fingerprint: "waived" },
  ];
  const config = {
    baselineMode: "new-only",
    blockSeverities: ["error"],
    requireCompleteRuleCoverage: true,
    warningBudget: null,
    coverage: { required: false, reportPaths: [], minimumLine: null, minimumChangedLine: null },
    exemptions: [{ fingerprint: "waived", owner: "owner", reason: "approved temporarily", approvalRef: "CR-1", expiresAt: "2099-01-01T00:00:00.000Z" }],
  };
  const result = evaluateQualityGate({
    findings: rows,
    config,
    baseline: { exists: true, fingerprints: new Set(["old"]), diagnostics: [] },
    coverage: { reports: [], line: { ratio: null }, changedLine: { ratio: null }, diagnostics: [] },
    ruleCoverage: { status: "complete", mode: "full" },
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.decision, "block");
  assert.deepEqual(result.fresh.map((item) => item.fingerprint), ["new"]);
  assert.deepEqual(result.existing.map((item) => item.fingerprint), ["old"]);
  assert.deepEqual(result.suppressed.map((item) => item.fingerprint), ["waived"]);
});

test("quality gate 拒绝过期豁免和不完整扫描", () => {
  const config = {
    baselineMode: "new-only",
    blockSeverities: ["error"],
    requireCompleteRuleCoverage: true,
    warningBudget: null,
    coverage: { required: false, reportPaths: [], minimumLine: null, minimumChangedLine: null },
    exemptions: [{ fingerprint: "x", owner: "owner", reason: "expired waiver", approvalRef: "CR-2", expiresAt: "2020-01-01T00:00:00.000Z" }],
  };
  const result = evaluateQualityGate({
    findings: [],
    config,
    baseline: { exists: false, fingerprints: new Set(), diagnostics: [] },
    coverage: { reports: [], line: { ratio: null }, changedLine: { ratio: null }, diagnostics: [] },
    ruleCoverage: { status: "partial", mode: "changed" },
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.summary.expiredExemptions, 1);
  assert(result.gateReasons.some((item) => item.code === "QG_RULE_COVERAGE"));
});

test("review 基线 fingerprint 不因无关行号漂移且能区分同文件重复问题", () => {
  const first = stabilizeFindingFingerprints([
    { source: "be-rules", rule: "B3", file: "Mapper.xml", line: 10, message: "SELECT *", fingerprint: "raw-1" },
    { source: "be-rules", rule: "B3", file: "Mapper.xml", line: 20, message: "SELECT *", fingerprint: "raw-2" },
  ]);
  const shifted = stabilizeFindingFingerprints([
    { source: "be-rules", rule: "B3", file: "Mapper.xml", line: 15, message: "SELECT *", fingerprint: "raw-3" },
    { source: "be-rules", rule: "B3", file: "Mapper.xml", line: 25, message: "SELECT *", fingerprint: "raw-4" },
  ]);
  assert.deepEqual(first.map((item) => item.fingerprint), shifted.map((item) => item.fingerprint));
  assert.notEqual(first[0].fingerprint, first[1].fingerprint);
  assert.notEqual(first[0].evidenceFingerprint, shifted[0].evidenceFingerprint);
});

test("JaCoCo XML 计算全量与变更行覆盖率", () => {
  const root = tempProject();
  write(root, "target/site/jacoco/jacoco.xml", `<?xml version="1.0"?><report><package name="com/acme"><sourcefile name="OrderService.java"><line nr="10" mi="0" ci="3"/><line nr="11" mi="2" ci="0"/></sourcefile><counter type="LINE" missed="1" covered="1"/></package><counter type="LINE" missed="1" covered="1"/></report>`);
  const parsed = parseJacocoXml(fs.readFileSync(path.join(root, "target/site/jacoco/jacoco.xml"), "utf8"));
  assert.equal(parsed.line.ratio, 0.5);
  const changed = new Map([["src/main/java/com/acme/OrderService.java", new Set([10, 11, 12])]]);
  const result = collectCoverage(root, { coverage: { required: true, reportPaths: ["target/site/jacoco/jacoco.xml"] } }, changed);
  assert.equal(result.line.ratio, 0.5);
  assert.equal(result.changedLine.ratio, 0.5);
});

test("JaCoCo 多模块同名源码按报告模块归属且不依赖 counter 属性顺序", () => {
  const root = tempProject();
  const report = (covered) => `<?xml version="1.0"?><report><package name="com/acme"><sourcefile name="OrderService.java"><line nr="10" mi="${covered ? 0 : 1}" ci="${covered ? 1 : 0}"/></sourcefile></package><counter covered="${covered ? 1 : 0}" type="LINE" missed="${covered ? 0 : 1}"/></report>`;
  write(root, "module-a/target/site/jacoco/jacoco.xml", report(true));
  write(root, "module-b/target/site/jacoco/jacoco.xml", report(false));
  const changed = new Map([
    ["module-a/src/main/java/com/acme/OrderService.java", new Set([10])],
    ["module-b/src/main/java/com/acme/OrderService.java", new Set([10])],
  ]);
  const result = collectCoverage(root, { coverage: { required: true, reportPaths: ["module-a/target/site/jacoco/jacoco.xml", "module-b/target/site/jacoco/jacoco.xml"], minimumChangedLine: 0.5 } }, changed);
  assert.equal(result.line.ratio, 0.5);
  assert.equal(result.changedLine.ratio, 0.5);
  assert.equal(result.diagnostics.length, 0);
});

test("review 总控只把显式变更送入规则执行并给出门禁决策", () => {
  const root = tempProject();
  write(root, "src/main/resources/mapper/UnsafeMapper.xml", `<mapper namespace="x.UnsafeMapper"><select id="list">SELECT * FROM demo</select></mapper>`);
  write(root, "src/main/resources/mapper/SafeMapper.xml", `<mapper namespace="x.SafeMapper"><sql id="BaseColumns">id</sql><select id="list">SELECT id FROM demo</select></mapper>`);
  const result = runReview(root, { changedFiles: ["src/main/resources/mapper/UnsafeMapper.xml"], limit: 10 });
  assert.equal(result.changes.mode, "explicit");
  assert.equal(result.changes.count, 1);
  assert.equal(result.decision, "block");
  assert(result.findings.some((item) => item.rule === "B3"));
  assert(!result.findings.some((item) => item.file.endsWith("SafeMapper.xml")));
});

test("review 输出只展开一次规则覆盖并按 limit 裁剪变更文件", () => {
  const root = tempProject();
  const changedFiles = Array.from({ length: 12 }, (_, index) => `src/main/java/F${index}.java`);
  const result = runReview(root, { changedFiles, limit: 3 });
  assert.equal(result.changes.count, 12);
  assert.equal(result.changes.files.length, 3);
  assert.equal(result.changes.truncated, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.evidence.execution, "requestedRules"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.evidence.execution, "executedRules"), false);
  const modules = compactModuleEvidence(Array.from({ length: 5 }, (_, index) => ({ id: `m${index}`, root: `m${index}`, stats: { total: index }, execution: { requestedRules: ["B1"], executedRules: ["B1"], scan: { loadedFiles: index } } })), 2);
  assert.equal(modules.count, 5);
  assert.equal(modules.items.length, 2);
  assert.equal(modules.truncated, true);
  assert(modules.items.every((item) => !Object.prototype.hasOwnProperty.call(item, "execution")));
});

test("非法 quality gate 配置 fail-closed", () => {
  const root = tempProject();
  write(root, ".wl-skills-bd/quality-gate.json", JSON.stringify({ schemaVersion: 1, blockSeverities: [] }));
  const loaded = loadQualityGate(root);
  assert.equal(loaded.ok, false);
  assert(loaded.diagnostics.some((item) => item.rule === "QG_CONFIG"));
});

test("review baseline 不允许吸收损坏的平台策略配置", () => {
  const root = tempProject();
  write(root, ".wl-skills-bd/integration-adapters.json", JSON.stringify({ schemaVersion: 1, adapters: [], bindings: [{ id: "bad", adapterId: "missing" }] }));
  const plan = buildReviewBaselinePlan(root, { changedFiles: [] });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "baseline-infrastructure-invalid");
});

test("项目级 baseline 拒绝模块切片覆盖全局基线", () => {
  const root = tempProject();
  const plan = buildReviewBaselinePlan(root, { module: "order" });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "baseline-requires-project-full-review");
});
