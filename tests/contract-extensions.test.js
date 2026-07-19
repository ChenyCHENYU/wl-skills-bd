"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyPlan, buildPlan, inspectImplementation } = require("../lib/codegen");
const { buildManifest, buildPermissionInventory, compareKitApiMarkdown, renderMarkdown } = require("../lib/collaboration");
const { loadContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const examplesDir = path.join(ROOT, "files", ".github", "templates", "examples");

function loadExample(file) {
  const loaded = loadContract(path.join(examplesDir, file), { projectRoot: ROOT });
  assert.strictEqual(loaded.ok, true, JSON.stringify(loaded.errors));
  return loaded;
}

// ─── 扩展契约：indexes + customOperations + relations + export + externalId ───
const extended = loadExample("sale-order-master.contract.json");
const extendedManifest = buildManifest(extended.contract, extended.profile, extended.deliveryProfile);

assert.strictEqual(extended.contract.indexes.length, 2, "indexes 数量");
assert.strictEqual(extended.contract.customOperations.length, 3, "customOperations 数量");
assert.strictEqual(extended.contract.relations.length, 1, "relations 数量");
assert.strictEqual(extended.contract.api.permissions.export, "sale_order_master_export", "export 权限码");
assert.strictEqual(extended.contract.externalId, "SALE_ORDER_MASTER", "externalId");
assert.ok(extended.contract.fields[0].externalId === "FIELD_ORDER_NO", "字段 externalId");

assert.ok(extendedManifest.extensionOperations.includes("export"), "manifest 暴露 export");
assert.ok(extendedManifest.extensionOperations.includes("submit"), "manifest 暴露 submit");
assert.ok(extendedManifest.extensionOperations.includes("approve"), "manifest 暴露 approve");
assert.ok(extendedManifest.extensionOperations.includes("batchCancel"), "manifest 暴露 batchCancel");
assert.strictEqual(extendedManifest.operations.submit.method, "POST");
assert.strictEqual(extendedManifest.operations.submit.externalPath, "/sale/saleOrderMaster/submit/{id}");
assert.strictEqual(extendedManifest.operations.batchCancel.requestModel, "custom_batchCancel_request");
assert.ok(extendedManifest.frontend.apiConfig.submit, "apiConfig 含 submit");
assert.ok(extendedManifest.frontend.apiConfig.export, "apiConfig 含 export");
assert.ok(extendedManifest.relations && extendedManifest.relations.length === 1, "manifest 含 relations");
assert.strictEqual(extendedManifest.relations[0].detailContractId, "sale-order-item");
assert.ok(extendedManifest.models.custom_approve_request.find((f) => f.name === "opinion"), "approve 含 opinion 字段");
assert.ok(extendedManifest.models.custom_batchCancel_request.find((f) => f.name === "ids"), "batchCancel 含 ids");
assert.strictEqual(extendedManifest.completion.contractStatus, "draft", "含导出/关联骨架时必须显式标记 draft");
assert.ok(extendedManifest.completion.skeletonOperations.includes("export"));
assert.ok(extendedManifest.completion.skeletonOperations.includes("relation:items"));
assert.strictEqual(extendedManifest.source.profile, "jh4j3-openapi3");

// ─── codegen 扩展契约：基础产物 + 业务命令 DTO ───
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-extended-"));
try {
  const plan = buildPlan(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: tempRoot });
  assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
  assert.strictEqual(plan.actions.length, 19, "基础 17 产物 + approve/batch 请求 DTO");
  const productionBlocked = applyPlan(plan, { confirm: true, planHash: plan.planHash, requireComplete: true });
  assert.strictEqual(productionBlocked.reason, "contract-incomplete");
  assert.deepStrictEqual(productionBlocked.applied, []);
  assert.strictEqual(fs.existsSync(path.join(tempRoot, ".wl-skills-bd", ".state", "codegen-manifest.json")), false);

  const applied = applyPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(applied.ok, true);

  const controller = fs.readFileSync(path.join(tempRoot, "src/main/java/com/jhict/sale/order/controller/SaleOrderMasterController.java"), "utf8");
  assert.match(controller, /public ApiResult<Void> submit\(/, "Controller 含 submit 方法");
  assert.match(controller, /public ApiResult<java\.util\.Map<String, Object>> batchCancel\(/, "Controller 含 batchCancel 方法");
  assert.match(controller, /public void export\(/, "Controller 含 export 方法");
  assert.match(controller, /querySaleOrderItemByParentId/, "Controller 含 relations 查询方法");
  assert.match(controller, /@PostMapping\("approve\/\{id\}"\)/, "Controller approve 路径正确");
  assert.match(controller, /SaleOrderMasterApproveRequestDTO request/, "Controller approve 使用强类型请求 DTO");

  const service = fs.readFileSync(path.join(tempRoot, "src/main/java/com/jhict/sale/order/service/SaleOrderMasterService.java"), "utf8");
  assert.match(service, /public void submit\(String id\)/, "Service submit 四段式");
  assert.match(service, /ServiceAssert\.isTrue\(java\.util\.Objects\.equals\(entity\.getStatus\(\), "DRAFT"\)/, "Service submit 含类型安全的前置状态校验");
  assert.match(service, /entity\.setStatus\("SUBMITTED"\);/, "Service submit 构造 patch");
  assert.match(service, /public void approve\(String id, SaleOrderMasterApproveRequestDTO request\)/, "Service approve 使用 DTO");
  assert.match(service, /entity\.setApprovalOpinion\(request\.getOpinion\(\)\)/, "审批意见被显式消费");
  assert.match(service, /public java\.util\.Map<String, Object> batchCancel\(SaleOrderMasterBatchCancelRequestDTO request\)/, "Service batchCancel 签名");
  assert.match(service, /ids\.size\(\) <= 1000, "批量作废：去重后单批不能超过1000条"/);
  assert.match(service, /result\.put\("failures"/, "批量响应与契约 failures 一致");
  assert.match(service, /successCount/, "Service batchCancel 返回 successCount");

  const migration = fs.readFileSync(path.join(tempRoot, "src/main/resources/db/migration/V20260718_120000__create_sale_order_master.sql"), "utf8");
  assert.match(migration, /CREATE TABLE SALE_ORDER_MASTER/, "扩展契约默认生成 CREATE TABLE");
  assert.match(migration, /CREATE UNIQUE INDEX UK_ORDER_NO/, "migration 含唯一索引");
  assert.match(migration, /CREATE INDEX IDX_ORDER_STATUS/, "migration 含普通索引");

  const apiMd = fs.readFileSync(path.join(tempRoot, "docs/contracts/sale-order-master.api.md"), "utf8");
  assert.match(apiMd, /\| submit \| POST \|/, "api.md 含 submit 操作行");
  assert.match(apiMd, /\| export \| GET \|/, "api.md 含 export 操作行");
  assert.match(apiMd, /主从关联/, "api.md 含主从关联段");
  assert.match(apiMd, /querySaleOrderItemByParentId/, "api.md apiConfig 含关联查询路径");

  const skeletonEvidence = inspectImplementation(extended.contract, tempRoot);
  assert.strictEqual(skeletonEvidence.ok, false);
  assert.deepStrictEqual(skeletonEvidence.missingOperations.map((item) => item.operation), ["export", "relation:items", "submit", "approve", "batchCancel"]);

  const weakTestFile = path.join(tempRoot, "src/test/java/com/jhict/sale/order/service/SaleOrderMasterServiceTest.java");
  const weakTestOriginal = fs.readFileSync(weakTestFile, "utf8");
  fs.appendFileSync(weakTestFile, `
// service.submit("1"); 注释不是测试证据
class WeakEvidence {
    @Test
    void submit_withoutAssertion() {
        service.submit("1");
    }
}
`, "utf8");
  const weakEvidence = inspectImplementation(extended.contract, tempRoot);
  assert.ok(weakEvidence.missingOperations.some((item) => item.operation === "submit" && item.test === "missing"), "只有方法名/调用且无断言不得冒充完成");
  fs.writeFileSync(weakTestFile, weakTestOriginal, "utf8");

  const serviceFile = path.join(tempRoot, "src/main/java/com/jhict/sale/order/service/SaleOrderMasterService.java");
  const completedService = fs.readFileSync(serviceFile, "utf8")
    .replace(/throw new UnsupportedOperationException\("销售订单主表 导出实现需业务补齐：设置响应头并写入输出流"\);/, "response.setStatus(200);")
    .replace(/throw new UnsupportedOperationException\("SaleOrderItem 关联查询需注入对应 Service 并转发；契约 sale-order-item"\);/, "return java.util.Collections.emptyList();");
  fs.writeFileSync(serviceFile, completedService, "utf8");
  const serviceTestFile = weakTestFile;
  const completedTests = fs.readFileSync(serviceTestFile, "utf8").replace(
    /    \/\/ <wl-custom name="tests">[\s\S]*?    \/\/ <\/wl-custom>/,
    `    // <wl-custom name="tests">
    @Test
    void export_shouldWriteResponse() {
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.export(null, null));
    }

    @Test
    void queryItems_shouldDelegate() {
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.querySaleOrderItemByParentId("1"));
    }

    @Test
    void submit_shouldEnforceTransition() {
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> service.submit("1"));
    }

    @Test
    void approve_shouldConsumeRequest() {
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> service.approve("1", null));
    }

    @Test
    void batchCancel_shouldValidateBatch() {
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> service.batchCancel(null));
    }
    // </wl-custom>`,
  );
  fs.writeFileSync(serviceTestFile, completedTests, "utf8");
  const verifiedEvidence = inspectImplementation(extended.contract, tempRoot);
  assert.strictEqual(verifiedEvidence.ok, true, JSON.stringify(verifiedEvidence));
  const verifiedManifest = buildManifest(extended.contract, extended.profile, extended.deliveryProfile, {
    implementedOperations: verifiedEvidence.implementedOperations,
  });
  assert.strictEqual(verifiedManifest.completion.contractStatus, "confirmed");
  const preservedPlan = buildPlan(path.join(examplesDir, "sale-order-master.contract.json"), { projectRoot: tempRoot });
  assert.deepStrictEqual(preservedPlan.summary, { unchanged: 19 }, "受保护实现与测试区不得形成 codegen 污染或升级冲突");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// ─── ALTER 契约：migration 生成 ALTER SQL，不生成 CREATE TABLE ───
const alterLoaded = loadExample("sale-order-master-alter.contract.json");
assert.ok(alterLoaded.contract.alter, "alter 字段存在");
assert.strictEqual(alterLoaded.contract.alter.operations.length, 2, "alter 操作数");

const alterTemp = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-alter-"));
try {
  const alterPlan = buildPlan(path.join(examplesDir, "sale-order-master-alter.contract.json"), { projectRoot: alterTemp });
  assert.strictEqual(alterPlan.ok, true);
  const alterApplied = applyPlan(alterPlan, { confirm: true, planHash: alterPlan.planHash });
  assert.strictEqual(alterApplied.ok, true);

  const migrationFiles = fs.readdirSync(path.join(alterTemp, "src/main/resources/db/migration"));
  assert.strictEqual(migrationFiles.length, 1, "ALTER 契约只生成一个 migration");
  assert.match(migrationFiles[0], /^V20260719_100000__alter_sale_order_master_/, "ALTER 文件名格式");

  const alterSql = fs.readFileSync(path.join(alterTemp, "src/main/resources/db/migration", migrationFiles[0]), "utf8");
  assert.match(alterSql, /ALTER TABLE SALE_ORDER_MASTER ADD PRIORITY/, "ALTER 含 ADD");
  assert.match(alterSql, /ALTER TABLE SALE_ORDER_MASTER MODIFY REMARK/, "ALTER 含 MODIFY");
  assert.doesNotMatch(alterSql, /CREATE TABLE/, "ALTER 不含 CREATE TABLE");
  assert.match(alterSql, /expand-contract/, "ALTER 注释含 expand-contract 提示");

  const rollback = fs.readFileSync(path.join(alterTemp, "db/rollback-manual/sale-order-master-alter.md"), "utf8");
  assert.match(rollback, /变更类型：ALTER/, "Rollback 含变更类型 ALTER");
  assert.match(rollback, /Expand-Contract 阶段/, "Rollback 含 expand-contract 段");
} finally {
  fs.rmSync(alterTemp, { recursive: true, force: true });
}

// ─── 权限码导出 ───
const inventory = buildPermissionInventory(extendedManifest);
assert.ok(inventory.rows.length >= 8, "权限码行数含扩展操作");
assert.ok(inventory.rows.find((r) => r.operation === "submit"), "inventory 含 submit");
assert.ok(inventory.rows.find((r) => r.operation === "export"), "inventory 含 export");
assert.ok(inventory.rows.find((r) => r.operation === "batchCancel"), "inventory 含 batchCancel");
const inventoryMd = renderMarkdown(extendedManifest);
assert.match(inventoryMd, /extensionOperations/);

// ─── kit api.md 兼容校验（存在性核对，命名规范差异不阻断）───
const kitApiMdSample = `# 接口约定 - 销售订单

## API_CONFIG

\`\`\`typescript
export const API_CONFIG = {
  list: "/sale/saleOrderMaster/list",
  save: "/sale/saleOrderMaster/save",
  submit: "/sale/saleOrderMaster/submit",
  approve: "/sale/saleOrderMaster/approve",
  batchCancel: "/sale/saleOrderMaster/batchCancel",
} as const;
\`\`\`

字段：orderNo 订单编号、customerName 客户名称、status 状态、totalAmount 总金额。
`;
const kitResult = compareKitApiMarkdown(extendedManifest, kitApiMdSample, "sample.md");
assert.strictEqual(kitResult.ok, true, JSON.stringify(kitResult.errors));
assert.ok(kitResult.warnings.some((item) => item.code === "C401"), "旧版纯文本 api.md 必须提示已降级校验");

const structuredFrontend = structuredClone(extendedManifest);
structuredFrontend.completion = { contractStatus: "confirmed", openQuestions: [], deviations: [], skeletonOperations: [] };
const structuredKitResult = compareKitApiMarkdown(extendedManifest, renderMarkdown(structuredFrontend), "structured.md");
assert.strictEqual(structuredKitResult.ok, true, JSON.stringify(structuredKitResult.errors));
assert.strictEqual(structuredKitResult.warnings.length, 0);
const strictStructured = compareKitApiMarkdown(extendedManifest, renderMarkdown(structuredFrontend), "structured.md", { strict: true });
assert.strictEqual(strictStructured.ok, false, "后端仍含业务骨架时严格联调必须阻断");
assert.ok(strictStructured.errors.some((item) => item.code === "C114"));

const kitMissingOp = kitApiMdSample.replace(/approve/g, "review");
const kitMissingResult = compareKitApiMarkdown(extendedManifest, kitMissingOp, "missing.md");
assert.strictEqual(kitMissingResult.ok, false);
assert.ok(kitMissingResult.errors.some((e) => e.code === "C405"), "kit api.md 缺业务命令应报 C405");

// ─── 确定性：扩展契约重生成必须等价 ───
assert.deepStrictEqual(buildManifest(extended.contract, extended.profile, extended.deliveryProfile), extendedManifest, "扩展 manifest 确定性");

console.log("✅ contract-extensions：indexes/customOperations/relations/export/alter/externalId 全链路通过");
