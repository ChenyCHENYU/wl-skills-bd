"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const impact = require("../lib/impact-analysis");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-impact-"));
try {
  writeJson(path.join(root, ".wl-skills-bd", "catalog.config.json"), {
    schemaVersion: 1,
    project: { id: "steel-impact", name: "字段影响示例" },
    docsRoot: "docs/backend",
    modules: {
      pl: { displayName: "炼钢", contractRoots: ["contracts"], sourceRoots: ["src"], upstream: [], downstream: [], owners: ["steel-team"] },
    },
  });
  writeJson(path.join(root, "contracts", "heat.contract.json"), {
    schemaVersion: 1,
    contractId: "pl-heat",
    module: "pl",
    ownership: "steel-team",
    entity: { name: "PlHeat", table: "pl_heat", description: "炉次" },
    database: "mysql",
    migration: { version: "20260830_120000" },
    fields: [{ name: "heatNo", column: "heat_no", javaType: "String", dbType: "VARCHAR(50)", comment: "炉号", maxLength: 50 }],
  });
  const dto = path.join(root, "src", "dto", "PlHeatRequestDTO.java");
  fs.mkdirSync(path.dirname(dto), { recursive: true });
  fs.writeFileSync(dto, [
    "package example.dto;",
    "import javax.validation.constraints.Size;",
    "public class PlHeatRequestDTO {",
    "  @Size(max = 80)",
    "  private String heatNo;",
    "}",
    "",
  ].join("\n"), "utf8");
  const unsafe = impact.analyzeFieldImpact(root, { module: "pl", field: "heat_no", table: "pl_heat", limit: 2 });
  assert.strictEqual(unsafe.ok, false);
  assert.ok(unsafe.propagation.findings.some((item) => item.code === "I201"));
  assert.strictEqual(unsafe.matches[0].owner, "steel-team");
  assert.strictEqual(unsafe.evidence.items.length, 2);
  assert.ok(unsafe.evidence.nextCursor !== null);

  fs.writeFileSync(dto, fs.readFileSync(dto, "utf8").replace("max = 80", "max = 50"), "utf8");
  const safe = impact.analyzeFieldImpact(root, { module: "pl", field: "heatNo" });
  assert.strictEqual(safe.ok, true, JSON.stringify(safe.propagation.findings));
  assert.strictEqual(safe.matches[0].storageMaxLength, 50);
  assert.ok(safe.evidence.roleCounts.dto >= 1);

  const ordered = impact.validateMigrationChain("pl-out", ["V1__expand.sql", "V2__backfill.sql", "V3__contract.sql"]);
  assert.deepStrictEqual(ordered.issues, []);
  const unsafeChain = impact.validateMigrationChain("pl-out", ["V3__contract.sql"]);
  assert.deepStrictEqual(unsafeChain.issues.map((item) => item.code), ["I301", "I302"]);
  assert.strictEqual(impact.analyzeFieldImpact(root, { field: "heatNo" }).ok, false, "禁止隐式全仓扫描");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ impact analysis：字段引用、容量边界、所有权、迁移阶段与分页证据通过");
