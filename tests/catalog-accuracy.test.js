"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const catalog = require("../lib/project-catalog");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-catalog-accuracy-"));
try {
  writeJson(path.join(root, ".wl-skills-bd", "catalog.config.json"), {
    schemaVersion: 1,
    project: { id: "steel-demo", name: "炼钢示例" },
    docsRoot: "docs/backend",
    modules: {
      pl: { displayName: "炼钢", contractRoots: ["docs/contracts"], sourceRoots: ["src"], upstream: [], downstream: [], owners: ["steel-team"] },
    },
  });
  writeJson(path.join(root, "docs", "contracts", "pl_heat", "wl-contract.json"), {
    schemaVersion: 1,
    contractId: "pl-heat",
    module: "pl",
    profile: "jh4j3-openapi3",
    rootPackage: "com.example.produce.pl",
    database: "mysql",
    ownership: "pl-owned",
    entity: { name: "PlHeat", table: "pl_heat", description: "炉次" },
    api: {
      requestPath: "plHeat",
      externalBasePath: "/produce/pl/plHeat",
      permissionPrefix: "pl_heat",
      permissions: { page: "pl_heat_page", detail: "pl_heat_detail", create: "pl_heat_create", update: "pl_heat_update", remove: "pl_heat_remove" },
    },
    migration: { version: "20260830_120000", rollbackStrategy: "使用新前向迁移恢复并保留原始数据，禁止修改历史迁移文件", verificationSql: ["SELECT COUNT(1) FROM pl_heat"] },
    fields: [{ name: "heatNo", column: "heat_no", javaType: "String", dbType: "VARCHAR(50)", comment: "炉号", writable: true, maxLength: 50 }],
  });
  writeJson(path.join(root, "docs", "contracts", "supporting-manifest.json"), { schemaVersion: 1, note: "不是资源契约" });
  const controller = [
    "package com.example.produce.pl.controller;",
    "import org.springframework.web.bind.annotation.*;",
    "@RestController",
    "@RequestMapping(\"/plHeat\")",
    "public class PlHeatController {",
    "  @GetMapping(\"/page\")",
    "  public String page() { return \"ok\"; }",
    "  @PostMapping(\"/confirm/{id}\")",
    "  public String confirm(@PathVariable String id) { return id; }",
    "}",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "PlHeatController.java"), controller, "utf8");

  const loaded = catalog.loadCatalogConfig(root);
  assert.strictEqual(loaded.ok, true, JSON.stringify(loaded.errors));
  const built = catalog.buildModuleCatalog(root, loaded.config, "pl");
  assert.strictEqual(built.ok, true, JSON.stringify(built.errors));
  assert.strictEqual(built.catalog.resources.length, 1, "辅助 JSON 不得被误当成契约");
  assert.strictEqual(built.catalog.resources[0].contractKind, "schema-mirror");
  assert.strictEqual(built.catalog.resources[0].codegenSafe, false);
  assert.strictEqual(built.catalog.apis.length, 2, "接口数量必须来自真实 Controller，不得合成五个 CRUD");
  assert.ok(built.catalog.apis.every((item) => item.source === "source-observed"));
  assert.ok(built.catalog.apis.every((item) => item.contractId === "pl-heat"));
  const summary = catalog.summarizeCatalog(built.catalog);
  assert.strictEqual(summary.stats.apis, 2);
  assert.deepStrictEqual(summary.contractKinds, { "schema-mirror": 1 });
  const firstPage = catalog.catalogSlice(built.catalog, "apis", { limit: 1 });
  assert.strictEqual(firstPage.items.length, 1);
  assert.strictEqual(firstPage.nextCursor, 1);
  assert.strictEqual(catalog.catalogSlice(built.catalog, "unknown").ok, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ catalog accuracy：契约候选过滤、源码 API 事实与紧凑分页输出通过");
