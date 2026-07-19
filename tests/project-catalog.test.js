"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const codegen = require("../lib/codegen");
const catalog = require("../lib/project-catalog");
const { buildContextPlan } = require("../lib/context-planner");

const ROOT = path.resolve(__dirname, "..");
const BASE_CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json"), "utf8"));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeContract(moduleId, index) {
  const value = JSON.parse(JSON.stringify(BASE_CONTRACT));
  const title = moduleId[0].toUpperCase() + moduleId.slice(1);
  value.contractId = `${moduleId}-record`;
  value.module = moduleId;
  value.rootPackage = "com.example.business";
  value.entity.name = `${title}Record`;
  value.entity.table = `${moduleId.toUpperCase()}_RECORD`;
  value.entity.description = `${title} record`;
  value.api.requestPath = `${moduleId}Record`;
  value.api.externalBasePath = `/${moduleId}/${moduleId}Record`;
  value.api.permissionPrefix = `${moduleId}_record`;
  value.api.permissions = Object.fromEntries(Object.entries(value.api.permissions).map(([key]) => [key, `${moduleId}_record_${key}`]));
  value.migration.version = `20260719_12000${index}`;
  value.migration.verificationSql = [`SELECT COUNT(1) FROM ${value.entity.table}`];
  return value;
}

function makeProject(root) {
  const modules = ["order", "customer", "billing"];
  const config = {
    schemaVersion: 1,
    project: { id: "wl-sale", name: "销售业务" },
    docsRoot: "docs/backend",
    commit: {
      types: ["feat", "fix", "docs", "test", "chore"],
      requireDetailSeparator: true,
      maxHeaderLength: 100,
    },
    modules: {
      order: { displayName: "订单", contractRoots: ["contracts/order"], sourceRoots: ["src/order"], upstream: ["customer"], downstream: ["billing"], owners: ["order-team"] },
      customer: { displayName: "客户", contractRoots: ["contracts/customer"], sourceRoots: ["src/customer"], upstream: [], downstream: ["order"], owners: ["customer-team"] },
      billing: { displayName: "结算", contractRoots: ["contracts/billing"], sourceRoots: ["src/billing"], upstream: ["order"], downstream: [], owners: ["billing-team"] },
    },
  };
  writeJson(path.join(root, ".wl-skills-bd", "catalog.config.json"), config);
  modules.forEach((moduleId, index) => {
    writeJson(path.join(root, "contracts", moduleId, `${moduleId}.json`), makeContract(moduleId, index));
    fs.mkdirSync(path.join(root, "src", moduleId), { recursive: true });
    fs.writeFileSync(path.join(root, "src", moduleId, `${moduleId}.java`), `package ${moduleId};\n`, "utf8");
  });
}

function applyModule(root, moduleId) {
  const plan = catalog.buildCatalogPlan(root, { module: moduleId });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.blocking, false, JSON.stringify(plan.diagnostics));
  const result = catalog.applyCatalogPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  return result;
}

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-catalog-"));
const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-catalog-duplicate-"));

try {
  makeProject(projectRoot);
  assert.strictEqual(catalog.buildCatalogPlan(projectRoot).ok, false, "默认不得隐式全量扫描");

  applyModule(projectRoot, "customer");
  const partialIndex = fs.readFileSync(path.join(projectRoot, "docs", "backend", "INDEX.md"), "utf8");
  assert.doesNotMatch(partialIndex, /\(modules\/(?:order|billing)\.md\)/u, "未索引模块不得生成死链接");
  applyModule(projectRoot, "billing");
  const orderApplied = applyModule(projectRoot, "order");
  assert.deepStrictEqual(orderApplied.scannedModules, ["order"]);
  assert.deepStrictEqual(orderApplied.linkedModules, ["billing", "customer"]);

  const orderPlan = catalog.buildCatalogPlan(projectRoot, { module: "order" });
  assert.deepStrictEqual(orderPlan.scannedModules, ["order"]);
  assert.deepStrictEqual(orderPlan.reusedModules, ["billing", "customer"]);
  const originalPlanHash = orderPlan.planHash;
  const orderContract = path.join(projectRoot, "contracts", "order", "order.json");
  const codegenBeforeLinkedRefresh = codegen.buildPlan(orderContract, { projectRoot });
  assert.strictEqual(codegenBeforeLinkedRefresh.ok, true);
  fs.appendFileSync(path.join(projectRoot, "src", "customer", "customer.java"), "// unrelated change\n", "utf8");
  const afterUnrelatedChange = catalog.buildCatalogPlan(projectRoot, { module: "order" });
  assert.strictEqual(afterUnrelatedChange.planHash, originalPlanHash, "其他模块源码变化不得触发当前模块扫描或改变计划");
  applyModule(projectRoot, "customer");
  const codegenAfterLinkedRefresh = codegen.buildPlan(orderContract, { projectRoot });
  assert.strictEqual(codegenAfterLinkedRefresh.planHash, codegenBeforeLinkedRefresh.planHash, "无契约关系命中的关联模块刷新不得使当前生成计划漂移");

  const context = buildContextPlan(projectRoot, { module: "order", task: "增加订单创建接口", keywords: ["customer"], maxFiles: 20 });
  assert.strictEqual(context.ok, true, JSON.stringify(context));
  assert.deepStrictEqual(context.scanPolicy.scannedModules, ["order"]);
  assert.deepStrictEqual(context.scanPolicy.loadedSnapshotModules, ["billing", "customer"]);
  assert.strictEqual(context.scanPolicy.linkedSourceDirectoriesScanned, false);
  assert.ok(context.selection.files.some((file) => file.role === "target-catalog"));
  assert.ok(context.selection.files.some((file) => file.role === "upstream-contract" && file.module === "customer"));
  assert.ok(context.selection.files.every((file) => file.module === "order" || !/-(?:snapshot|doc)$/.test(file.role)), "不得把关联模块整份目录或文档加入上下文");
  assert.ok(context.selection.files.every((file) => !/^src\/(billing|customer)\//.test(file.rel)), "不得读取关联模块源码");

  const moduleDoc = fs.readFileSync(path.join(projectRoot, "docs", "backend", "modules", "order.md"), "utf8");
  const indexDoc = fs.readFileSync(path.join(projectRoot, "docs", "backend", "INDEX.md"), "utf8");
  const commitDoc = fs.readFileSync(path.join(projectRoot, "docs", "backend", "COMMIT_CONVENTION.md"), "utf8");
  for (const document of [moduleDoc, indexDoc, commitDoc]) {
    assert.match(document, /^<!--\n/u, "人读文档必须带用途注释头");
    assert.match(document, /purpose:/u);
    assert.match(document, /editable: false/u);
  }

  const codegenPlan = codegen.buildPlan(orderContract, { projectRoot });
  assert.strictEqual(codegenPlan.ok, true, JSON.stringify(codegenPlan.errors));
  assert.strictEqual(codegenPlan.catalogPreflight.enabled, true);
  assert.deepStrictEqual(codegenPlan.catalogPreflight.scannedModules, ["order"]);

  fs.appendFileSync(path.join(projectRoot, "src", "order", "order.java"), "// stale\n", "utf8");
  const staleContext = buildContextPlan(projectRoot, { module: "order" });
  assert.strictEqual(staleContext.ok, false);
  assert.strictEqual(staleContext.reason, "catalog-stale");
  const blockedCodegen = codegen.buildPlan(orderContract, { projectRoot });
  assert.strictEqual(blockedCodegen.ok, false);
  assert.strictEqual(blockedCodegen.catalogPreflight.enabled, true);

  makeProject(duplicateRoot);
  const billingFile = path.join(duplicateRoot, "contracts", "billing", "billing.json");
  const billing = JSON.parse(fs.readFileSync(billingFile, "utf8"));
  const order = JSON.parse(fs.readFileSync(path.join(duplicateRoot, "contracts", "order", "order.json"), "utf8"));
  billing.entity.table = order.entity.table;
  billing.api.requestPath = order.api.requestPath;
  billing.api.externalBasePath = order.api.externalBasePath;
  billing.api.permissionPrefix = order.api.permissionPrefix;
  billing.api.permissions = { ...order.api.permissions };
  writeJson(billingFile, billing);
  const duplicatePlan = catalog.buildCatalogPlan(duplicateRoot, { full: true });
  assert.strictEqual(duplicatePlan.ok, true);
  assert.strictEqual(duplicatePlan.blocking, true);
  assert.ok(duplicatePlan.diagnostics.errors.some((item) => item.code === "CAT_DUPLICATE"), JSON.stringify(duplicatePlan.diagnostics));
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(duplicateRoot, { recursive: true, force: true });
}

console.log("✓ project catalog：模块增量扫描、一跳快照、文档头、生成前置门禁与全局去重通过");
