"use strict";

/**
 * tests/business-closure.test.js — v0.26 业务闭环与数据库复核机制
 *
 * 覆盖：状态机闭环校验（可达性/死前置/无终态）、codegen openQuestions 人工确认门、
 * 三方字段对账（reconcileContract）、快照导出辅助（snapshotTemplate）、
 * ALTER 影响分析硬门与变更前证据 SQL。
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateContract } = require("../lib/contract");
const codegen = require("../lib/codegen");
const dbSpec = require("../lib/db-spec");
const drift = require("../lib/db-drift");

const ROOT = path.resolve(__dirname, "..");
const saleExample = JSON.parse(fs.readFileSync(
  path.join(ROOT, "files", ".github", "templates", "examples", "sale-order-master.contract.json"),
  "utf8",
));
const featureExample = JSON.parse(fs.readFileSync(
  path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json"),
  "utf8",
));

function validateClone(contract) {
  return validateContract(structuredClone(contract), { projectRoot: ROOT });
}

// ─── 1. 状态机闭环 ────────────────────────────────────────────────────────

(function testStateClosure() {
  const valid = validateClone(saleExample);
  assert.strictEqual(valid.ok, true, JSON.stringify(valid.errors));

  const unreachable = structuredClone(saleExample);
  unreachable.fields.find((field) => field.name === "status").enumValues.push("ARCHIVED");
  const unreachableResult = validateContract(unreachable, { projectRoot: ROOT });
  assert.strictEqual(unreachableResult.ok, false);
  assert.ok(unreachableResult.errors.some((error) => /ARCHIVED 不可达/.test(error.message)), "不可达枚举必须报错");

  const deadPrecondition = structuredClone(saleExample);
  deadPrecondition.customOperations.find((op) => op.name === "submit").preconditions = [
    { field: "status", operator: "equals", value: "DRAFT" },
    { field: "status", operator: "notEquals", value: "DRAFT" },
  ];
  const deadResult = validateContract(deadPrecondition, { projectRoot: ROOT });
  assert.strictEqual(deadResult.ok, false);
  assert.ok(deadResult.errors.some((error) => /前置状态组合.*空集|永不可触发/.test(error.message)), "空集前置必须报错");

  const loop = structuredClone(saleExample);
  const loopField = loop.fields.find((field) => field.name === "status");
  loopField.enumValues = ["DRAFT", "SUBMITTED"];
  loopField.initialValue = "DRAFT";
  const submitOp = loop.customOperations.find((op) => op.name === "submit");
  const withdrawOp = structuredClone(submitOp);
  withdrawOp.name = "withdraw";
  withdrawOp.path = "withdraw/{id}";
  withdrawOp.permission = "sale_order_master_withdraw";
  withdrawOp.preconditions[0].value = "SUBMITTED";
  withdrawOp.patch[0].value = "DRAFT";
  loop.customOperations = [submitOp, withdrawOp];
  const loopResult = validateContract(loop, { projectRoot: ROOT });
  assert.strictEqual(loopResult.ok, true, JSON.stringify(loopResult.errors));
  assert.ok((loopResult.warnings || []).some((warning) => /status 无终态/.test(warning)), "无终态必须产生人工确认警告");
  console.log("  ✓ 状态机闭环：不可达枚举、空集前置、无终态警告");
})();

// ─── 2. openQuestions 人工确认门 ─────────────────────────────────────────

(function testOpenQuestions() {
  const saleQuestions = codegen.buildOpenQuestions(validateClone(saleExample).contract);
  assert.ok(saleQuestions.some((question) => question.id === "Q-STATE-CONCURRENCY" && question.blocking !== false));
  assert.ok(saleQuestions.some((question) => /^Q-BATCH-/.test(question.id) && question.blocking !== false));

  const featureQuestions = codegen.buildOpenQuestions(validateClone(featureExample).contract);
  assert.ok(featureQuestions.some((question) => question.id === "Q-ASSURANCE-LEVEL" && question.blocking === false), "交付级别疑点只提醒不阻断");
  assert.strictEqual(featureQuestions.some((question) => question.blocking !== false), false, "无业务命令契约不得有阻断性疑点");

  const stable = JSON.stringify(codegen.buildOpenQuestions(validateClone(saleExample).contract));
  assert.strictEqual(stable, JSON.stringify(saleQuestions), "疑点清单必须确定性");
  console.log("  ✓ openQuestions：批量/并发阻断项、交付级别提醒、确定性");
})();

// ─── 3. 三方字段对账 ─────────────────────────────────────────────────────

(function testReconciliation() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-db-review-"));
  try {
    const loaded = validateClone(featureExample);
    const contract = loaded.contract;
    // 构造与契约/Profile 完全一致的文档镜像（业务字段 + 平台治理字段）
    const descriptor = dbSpec.descriptorFromContract(contract, "wl-contract.json", loaded.profile);
    fs.mkdirSync(path.join(tempRoot, "docs", "db-spec"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "docs", "db-spec", "feature-category.json"),
      JSON.stringify({
        tables: [{
          name: contract.entity.table,
          comment: contract.entity.description,
          fields: [
            ...descriptor.fields.map((field) => {
              const entry = { name: field.name, dbType: field.dbType, comment: field.comment };
              if (typeof field.nullable === "boolean") entry.nullable = field.nullable;
              if (field.defaultValue !== undefined) entry.defaultValue = field.defaultValue;
              return entry;
            }),
            ...descriptor.platformFields.map((field) => {
              const entry = { name: field.name, dbType: field.dbType, comment: field.comment };
              if (typeof field.nullable === "boolean") entry.nullable = field.nullable;
              if (field.defaultValue !== undefined) entry.defaultValue = field.defaultValue;
              return entry;
            }),
          ],
        }],
      }, null, 2),
      "utf8",
    );

    const matched = dbSpec.reconcileContract(tempRoot, contract, { profile: loaded.profile });
    assert.strictEqual(matched.ok, true, JSON.stringify(matched.rows.filter((row) => row.issues.some((issue) => issue.severity === "error")).map((row) => row.issues)));
    assert.ok(matched.summary.fields >= contract.fields.length);
    assert.ok(matched.rows.every((row) => row.issues.every((issue) => issue.severity !== "error")), "逐字段对账必须全部一致");

    const drifted = structuredClone(featureExample);
    drifted.fields[0].dbType = "VARCHAR2(128 CHAR)";
    const driftedResult = dbSpec.reconcileContract(tempRoot, validateContract(drifted, { projectRoot: ROOT }).contract, { profile: loaded.profile });
    assert.strictEqual(driftedResult.ok, false, "长度漂移必须在对账报告中体现");
    assert.ok(driftedResult.rows.some((row) => row.issues.some((issue) => issue.property === "dbType" && issue.severity === "error")), "长度差异必须逐字段指出");

    const snapshot = { tables: [{ name: contract.entity.table, columns: contract.fields.map((field, index) => ({ name: field.column, ordinal: index + 1, dbType: field.dbType, nullable: field.nullable === true, comment: field.comment })) }] };
    const snapTables = drift.loadSnapshot(writeTempJson(tempRoot, snapshot));
    const threeWay = dbSpec.reconcileContract(tempRoot, contract, { profile: loaded.profile, snapshotTables: snapTables.tables });
    assert.strictEqual(threeWay.snapshotProvided, true);
    assert.ok(threeWay.rows.some((row) => row.snapshot && row.snapshot.dbType), "快照值必须进入对账行");
    console.log("  ✓ 三方对账：全一致、长度漂移、快照参与");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})();

function writeTempJson(root, value) {
  const file = path.join(root, "snapshot.json");
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

// ─── 4. 快照导出辅助与变更前证据 SQL ────────────────────────────────────

(function testSnapshotTemplateAndEvidence() {
  const mysql = drift.snapshotTemplate("mysql");
  assert.match(mysql, /information_schema\.COLUMNS/);
  assert.match(mysql, /db drift --snapshot/);
  const oracle = drift.snapshotTemplate("oracle");
  assert.match(oracle, /USER_TAB_COLUMNS/);
  assert.match(oracle, /"table"/);

  const alterEvidence = codegen.preChangeEvidenceSql({ database: "oracle", entity: { table: "MDM_FOO" } });
  assert.ok(alterEvidence.some((sql) => sql.includes("MDM_FOO")));
  assert.ok(alterEvidence.every((sql) => !/DROP|TRUNCATE|ALTER|UPDATE |DELETE /i.test(sql)), "证据采集 SQL 必须只读");
  console.log("  ✓ 快照模板与只读证据 SQL");
})();

// ─── 5. ALTER 影响分析硬门 ────────────────────────────────────────────────

(function testAlterImpactGate() {
  const noCatalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-alter-gate-"));
  try {
    const alterContract = validateClone(featureExample).contract;
    alterContract.alter = {
      version: "20260916_120000",
      phase: "expand",
      rollbackStrategy: "新增可空列不破坏存量；如需回退按 DBA 流程删除对应列并保留审批记录。",
      verificationSql: ["SELECT COUNT(*) FROM MDM_FEATURE_CATEGORY"],
      operations: [{ type: "add", field: { name: "remark", column: "REMARK", javaType: "String", dbType: "VARCHAR2(200)", comment: "备注", nullable: true } }],
    };
    const blocked = codegen.buildAlterImpact(noCatalogRoot, alterContract);
    assert.strictEqual(blocked.mode, "blocked", "未配置 Catalog 且无 impactRef 必须阻断");
    assert.match(blocked.reason, /impactRef|catalog\.config/);

    alterContract.alter.impactRef = "工单 CHG-2026-0916：impact field 输出 0 处引用，已评审";
    const manual = codegen.buildAlterImpact(noCatalogRoot, alterContract);
    assert.strictEqual(manual.mode, "manual-ref");
    assert.strictEqual(manual.impactRef, "工单 CHG-2026-0916：impact field 输出 0 处引用，已评审");
    console.log("  ✓ ALTER 硬门：无 Catalog 阻断、impactRef 人工登记放行");
  } finally {
    fs.rmSync(noCatalogRoot, { recursive: true, force: true });
  }
})();

console.log("\n✅ 业务闭环：状态机闭环、openQuestions 确认门、三方对账、快照模板与 ALTER 硬门通过");
