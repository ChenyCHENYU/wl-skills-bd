"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dbSpec = require("../lib/db-spec");
const dbDrift = require("../lib/db-drift");
const ruleRegistry = require("../lib/rule-registry");
const { runBeRules } = require("../lib/be-rules");

const ROOT = path.resolve(__dirname, "..");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-b31-"));
  fs.mkdirSync(path.join(dir, "docs", "db-spec"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "contracts", "db", "pl_heat_process"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".wl-skills-bd"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "db-spec", "spec.json"), JSON.stringify({
    tables: [
      { name: "pl_charge", cname: "进程跟踪", fields: ["id", "heat_id", "start_time", "end_time"] },
      { name: "pl_slab_main", cname: "坯料", fields: ["id", "slab_no", "apply_jugde_status"] },
    ],
  }));
  fs.writeFileSync(path.join(dir, "docs", "contracts", "db", "pl_heat_process", "wl-contract.json"), JSON.stringify({
    entity: { table: "pl_heat_process" },
    fields: [{ column: "ID" }, { column: "HEAT_ID" }, { column: "START_TIME" }, { column: "END_TIME" }],
  }));
  return dir;
}

// ── B31：文档 ↔ 契约 ──────────────────────────────────────────
{
  const dir = makeProject();
  const contracts = new Map([["pl_heat_process", new Set(["id", "heat_id", "start_time", "end_time"])]]);
  const result = dbSpec.checkDocContractConsistency(dir, contracts);
  const errors = result.issues.filter((i) => i.severity === "error");
  assert.strictEqual(errors.length, 2, "pl_charge 与 pl_slab_main 均未在契约中，应各报一个 error");
  assert.ok(errors.every((e) => e.message.includes("pl_charge") || e.message.includes("pl_slab_main")), "error 应指向缺失表");
}

// ── B31：豁免登记后转 warn，且豁免目标缺失仍报错 ─────────────
{
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, ".wl-skills-bd", "naming-waivers.json"), JSON.stringify({
    waivers: [
      { from: "pl_charge", to: "pl_heat_process", reason: "建模演进", approvedBy: "tester", date: "2026-08-20" },
    ],
  }));
  const contracts = new Map([["pl_heat_process", new Set(["id", "heat_id", "start_time", "end_time"])]]);
  const result = dbSpec.checkDocContractConsistency(dir, contracts);
  const renamedWarn = result.issues.find((i) => i.severity === "warn" && i.message.includes("已审批改名"));
  assert.ok(renamedWarn, "豁免改名应降为 warn 并保留追溯信息");
  assert.ok(renamedWarn.message.includes("tester"), "warn 应携带审批人");
  assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 1, "pl_slab_main 仍未豁免，保持 error");
}

// ── B31：字段基线豁免 ─────────────────────────────────────────
{
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, "docs", "contracts", "db", "pl_heat_process", "wl-contract.json"), JSON.stringify({
    entity: { table: "pl_slab" },
    fields: [{ column: "ID" }, { column: "SLAB_NO" }],
  }));
  fs.writeFileSync(path.join(dir, ".wl-skills-bd", "naming-waivers.json"), JSON.stringify({
    waivers: [
      { from: "pl_slab_main", to: "pl_slab", reason: "拆分", approvedBy: "tester", date: "2026-08-20", baselineFields: ["id", "slab_no"] },
    ],
  }));
  const contracts = new Map([["pl_slab", new Set(["id", "slab_no"])]]);
  const result = dbSpec.checkDocContractConsistency(dir, contracts);
  const fieldError = result.issues.find((i) => i.severity === "error" && i.message.includes("apply_jugde_status"));
  assert.ok(fieldError, "文档字段 apply_jugde_status 未落实且不在基线，应报 error");
}

// ── B31：validate 集成（error 计入 stats，无 db-spec 时仅 warn）──
{
  const dir = makeProject();
  const result = runBeRules(dir, {});
  assert.ok(result.stats.byRule.B31 >= 2, `B31 应进入 validate 结果（实际 ${result.stats.byRule.B31 || 0}）`);
  assert.ok(result.stats.error >= 2, "B31 error 应计入阻断统计");
}
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-empty-"));
  const result = runBeRules(empty, {});
  const b31 = (result.rawIssues || result.issues || []).filter((i) => i.rule === "B31");
  assert.ok(b31.every((i) => i.severity === "warn"), "无 db-spec 目录时 B31 只提示不阻断");
}

// ── db drift：无源列 / 无主表 / 账本放行 ────────────────────────
{
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify([
    { table: "pl_heat_process", columns: ["ID", "HEAT_ID", "START_TIME", "END_TIME", "GHOST_COL"] },
    { table: "pl_fin_plan", columns: ["ID"] },
  ]));
  const result = dbDrift.detectDrift(dir, path.join(dir, "snapshot.json"));
  assert.strictEqual(result.ok, false, "存在无源变更时应失败");
  assert.ok(result.issues.some((i) => i.kind === "unclaimed-column" && i.column === "ghost_col"), "无源列应被检出");
  assert.ok(result.issues.some((i) => i.kind === "unclaimed-table" && i.table === "pl_fin_plan"), "无主表应被检出");

  dbDrift.appendLedger(dir, { table: "pl_heat_process", column: "ghost_col", approvalRef: "CHG-1", executedBy: "dba" });
  const after = dbDrift.detectDrift(dir, path.join(dir, "snapshot.json"));
  const approved = after.issues.find((i) => i.kind === "approved-drift");
  assert.ok(approved && approved.severity === "warn", "账本内列应转为 warn 标识");
  assert.strictEqual(after.issues.filter((i) => i.severity === "error").length, 1, "仅剩无主表 error");
}

// ── rule-registry：catalog 自检 ────────────────────────────────
{
  const result = ruleRegistry.checkRuleRegistry(ROOT);
  assert.strictEqual(result.ok, true, `包内 catalog 应自检通过（问题：${result.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ")}）`);
  assert.ok(result.summary.rules >= 39, "应至少登记 39 条规则（含 B31）");
}

console.log("✅ db-spec/db-drift/rule-registry 全部断言通过");
