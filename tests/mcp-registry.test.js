"use strict";

const assert = require("assert");
const path = require("path");
const { HANDLERS, TOOLS } = require("../mcp/registry");
const { validateSchema } = require("../mcp/schema-validator");

(async () => {
  process.env.WL_PROJECT_ROOT = path.resolve(__dirname, "..");
  const expected = [
    "wls_be_validate",
    "wls_be_doctor",
    "wls_be_codegen",
    "wls_be_contract",
    "wls_be_safe_fix",
    "wls_be_standards",
    "wls_be_templates",
    "wls_be_db_preview",
    "wls_be_export_permissions",
    "wls_be_config",
    "wls_be_troubleshoot",
    "wls_be_task",
    "wls_be_catalog",
    "wls_be_context",
    "wls_be_commit",
    "wls_be_test",
  ];
  assert.deepStrictEqual(TOOLS.map((tool) => tool.name), expected);
  assert.deepStrictEqual(Object.keys(HANDLERS), expected);

  const validate = await HANDLERS.wls_be_validate.handle({ quick: true });
  assert.ok(validate.structuredContent);
  assert.strictEqual(typeof validate.structuredContent.total, "number");

  const standard = await HANDLERS.wls_be_standards.handle({ id: "04" });
  assert.match(standard.text, /^# 04/m);
  const latestStandard = await HANDLERS.wls_be_standards.handle({ id: "29" });
  assert.match(latestStandard.text, /^# 29/m);
  const template = await HANDLERS.wls_be_templates.handle({ name: "Controller" });
  assert.match(template.text, /class \{\{Entity\}\}Controller/);

  const contract = "files/.github/templates/examples/feature-category.contract.json";
  const codegen = await HANDLERS.wls_be_codegen.handle({ mode: "validate", contract });
  assert.strictEqual(codegen.structuredContent.ok, true);
  const contractShow = await HANDLERS.wls_be_contract.handle({ mode: "show", contract, format: "json" });
  assert.strictEqual(contractShow.structuredContent.manifest.kind, "wl-api-contract");
  assert.strictEqual(contractShow.structuredContent.manifest.protocolVersion, "1.0");
  assert.strictEqual(contractShow.structuredContent.manifest.completion.contractStatus, "confirmed");
  assert.strictEqual(contractShow.structuredContent.manifest.transport.successCode, 2000);
  const contractSchema = TOOLS.find((tool) => tool.name === "wls_be_contract").inputSchema;
  assert.strictEqual(validateSchema(contractSchema, { mode: "seed", table: "MDM_FEATURE_CATEGORY", database: "oracle" }).valid, true);
  assert.strictEqual(validateSchema(contractSchema, { mode: "show", contract }).valid, true);
  assert.strictEqual(validateSchema(contractSchema, { mode: "seed", table: "MDM_FEATURE_CATEGORY" }).valid, false);
  assert.strictEqual(validateSchema(contractSchema, { mode: "show" }).valid, false);
  const missingContract = await HANDLERS.wls_be_contract.handle({ mode: "show" });
  assert.strictEqual(missingContract.structuredContent.state, "invalid-input");
  const fixPreview = await HANDLERS.wls_be_safe_fix.handle({ rules: ["B3"] });
  assert.strictEqual(fixPreview.structuredContent.mode, "preview");
  const doctor = await HANDLERS.wls_be_doctor.handle({});
  assert.ok(Array.isArray(doctor.structuredContent.checks));
  assert.ok(doctor.structuredContent.checks.some((item) => item.id === "contract-coverage"));
  const dbPreview = await HANDLERS.wls_be_db_preview.handle({ contract });
  assert.strictEqual(dbPreview.structuredContent.ok, true);
  assert.strictEqual(dbPreview.structuredContent.migrationKind, "CREATE");
  const exportPreview = await HANDLERS.wls_be_export_permissions.handle({ contract });
  assert.strictEqual(exportPreview.structuredContent.mode, "preview");
  assert.ok(exportPreview.structuredContent.inventory.rows.length >= 5);
  const routedTask = await HANDLERS.wls_be_task.handle({ input: "加个查询接口" });
  assert.strictEqual(routedTask.structuredContent.taskId, "add-api");
  assert.match(routedTask.text, /codegen plan/);

  const codegenSchema = TOOLS.find((tool) => tool.name === "wls_be_codegen").inputSchema;
  assert.strictEqual(validateSchema(codegenSchema, { mode: "wrong", contract }).valid, false);
  assert.strictEqual(validateSchema(codegenSchema, {
    mode: "apply",
    contract,
    confirmApply: true,
    requireComplete: true,
    allowProductionWrites: true,
  }).valid, true);
  assert.strictEqual(validateSchema(codegenSchema, { mode: "plan", contract, unexpected: true }).valid, false);
  const standardsSchema = TOOLS.find((tool) => tool.name === "wls_be_standards").inputSchema;
  assert.strictEqual(validateSchema(standardsSchema, { id: "29" }).valid, true, "最新标准必须通过真实 MCP schema");
  assert.strictEqual(validateSchema(standardsSchema, { id: "30" }).valid, false);
  const validateToolSchema = TOOLS.find((tool) => tool.name === "wls_be_validate").inputSchema;
  assert.strictEqual(validateSchema(validateToolSchema, { rules: ["B31"], severity: "error", maxIssues: 5, includeEndpoints: false }).valid, true);
  assert.strictEqual(validateSchema(validateToolSchema, { rules: ["B32"] }).valid, false);
  const taskSchema = TOOLS.find((tool) => tool.name === "wls_be_task").inputSchema;
  assert.strictEqual(validateSchema(taskSchema, { type: "add-field", targetFile: "src/Foo.java" }).valid, true);
  assert.strictEqual(validateSchema(taskSchema, { type: "add-field", apply: true }).valid, false, "task 不得暴露旁路写入口");
  const escaped = await HANDLERS.wls_be_codegen.handle({ mode: "validate", contract: "../outside.json" });
  assert.strictEqual(escaped.structuredContent.ok, false);
  assert.strictEqual(escaped.structuredContent.state, "invalid-input");

  const generatedTest = await HANDLERS.wls_be_test.handle({ mode: "scenarios", contract });
  assert.strictEqual(generatedTest.structuredContent.ok, true);
  const generatedSourceSummary = await HANDLERS.wls_be_test.handle({ mode: "gen", contract });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(generatedSourceSummary.structuredContent, "content"), false);
  const generatedSourceFull = await HANDLERS.wls_be_test.handle({ mode: "gen", contract, includeSource: true });
  assert.match(generatedSourceFull.structuredContent.content, /class .*ServiceTest/);

  console.log("✅ MCP registry：16 工具、严格 schema、路径边界及核心 handler 通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
