"use strict";

const assert = require("assert");
const path = require("path");
const {
  buildManifest,
  compareManifest,
  compareOpenApi,
  comparePermissions,
  extractManifest,
  renderMarkdown,
} = require("../lib/collaboration");
const { loadContract } = require("../lib/contract");

const ROOT = path.resolve(__dirname, "..");
const file = path.join(ROOT, "files", ".github", "templates", "examples", "feature-category.contract.json");
const loaded = loadContract(file, { projectRoot: ROOT });
assert.strictEqual(loaded.ok, true);
const manifest = buildManifest(loaded.contract, loaded.profile, loaded.deliveryProfile);

assert.strictEqual(manifest.kind, "wl-api-contract");
assert.strictEqual(manifest.protocolVersion, "1.0");
assert.strictEqual(manifest.source.profile, "jh4j3-openapi3");
assert.strictEqual(manifest.completion.contractStatus, "confirmed");
assert.deepStrictEqual(manifest.completion.openQuestions, []);
assert.strictEqual(manifest.transport.successCode, 2000);
assert.strictEqual(manifest.transport.pagination.recordsPath, "data.records");
assert.strictEqual(manifest.transport.pagination.totalPath, "data.total");
assert.strictEqual(manifest.operations.page.externalPath, "/mdm/mdmFeatureCategory/queryPage");
assert.strictEqual(manifest.operations.update.method, "PUT");
assert.ok(manifest.models.detailResponse.some((field) => field.name === "revision"), "详情必须返回乐观锁 revision");
assert.deepStrictEqual(buildManifest(loaded.contract, loaded.profile, loaded.deliveryProfile), manifest, "协作契约必须确定性生成");

const markdown = renderMarkdown(manifest);
assert.match(markdown, /```wl-api-contract/);
assert.deepStrictEqual(extractManifest(markdown), manifest);
assert.strictEqual(compareManifest(manifest, extractManifest(markdown)).ok, true);
assert.strictEqual(compareManifest(manifest, extractManifest(markdown), { strict: true }).ok, true);
const stale = JSON.parse(JSON.stringify(manifest));
stale.operations.update.externalPath = "/wrong/update";
assert.strictEqual(compareManifest(manifest, stale).ok, false);

const wrongProfile = structuredClone(manifest);
wrongProfile.source.profile = "another-profile";
assert.ok(compareManifest(manifest, wrongProfile).errors.some((item) => item.code === "C112"));

const wrongResource = structuredClone(manifest);
wrongResource.resource.module = "other";
assert.ok(compareManifest(manifest, wrongResource).errors.some((item) => item.path === "resource.module"));

const frontendDraft = structuredClone(manifest);
frontendDraft.completion.contractStatus = "draft";
frontendDraft.completion.openQuestions = ["页面字段仍待确认"];
const strictDraft = compareManifest(manifest, frontendDraft, { strict: true });
assert.strictEqual(strictDraft.ok, false);
assert.ok(strictDraft.errors.some((item) => item.code === "C114"));
assert.ok(strictDraft.errors.some((item) => item.code === "C115"));

const tracedBackend = structuredClone(manifest);
tracedBackend.resource.externalId = "ENTITY_FEATURE_CATEGORY";
const untracedFrontend = structuredClone(tracedBackend);
delete untracedFrontend.resource.externalId;
const optionalTrace = compareManifest(tracedBackend, untracedFrontend, { strict: true });
assert.strictEqual(optionalTrace.ok, true, "缺少可选 design 稳定 ID 不得阻断无 design 的严格闭环");
assert.ok(optionalTrace.warnings.some((item) => item.code === "C113"));

const permissions = Object.values(manifest.operations).map((item) => ({ permission: item.permission }));
assert.strictEqual(comparePermissions(manifest, permissions).ok, true);
assert.strictEqual(comparePermissions(manifest, permissions.slice(1)).errors[0].code, "C301");

function objectSchema(fields, required = []) {
  return {
    type: "object",
    required,
    properties: Object.fromEntries(fields.map((field) => [field.name, {
      type: field.type,
      ...(field.format ? { format: field.format } : {}),
      ...(field.items ? { items: field.items } : {}),
    }])),
  };
}

const envelope = (data) => ({
  type: "object",
  required: ["code", "message", "data"],
  properties: { code: { type: "integer", example: 2000 }, message: { type: "string" }, data },
});
const jsonResponse = (schema) => ({ description: "ok", content: { "application/json": { schema } } });
const jsonRequest = (ref) => ({ required: true, content: { "application/json": { schema: { $ref: ref } } } });
const pathId = { name: "id", in: "path", required: true, schema: { type: "string" } };
const refs = {
  page: "#/components/schemas/PageRequest",
  create: "#/components/schemas/CreateRequest",
  update: "#/components/schemas/UpdateRequest",
};
const openapi = {
  openapi: "3.0.3",
  paths: {
    [manifest.operations.page.controllerPath]: {
      post: {
        "x-permission": manifest.operations.page.permission,
        parameters: [
          { name: "current", in: "query", schema: { type: "integer" } },
          { name: "size", in: "query", schema: { type: "integer" } },
        ],
        requestBody: jsonRequest(refs.page),
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/PageEnvelope" }) },
      },
    },
    [manifest.operations.detail.controllerPath]: {
      get: {
        "x-permission": manifest.operations.detail.permission,
        parameters: [pathId],
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/DetailEnvelope" }) },
      },
    },
    [manifest.operations.create.controllerPath]: {
      post: {
        "x-permission": manifest.operations.create.permission,
        requestBody: jsonRequest(refs.create),
        responses: { 200: jsonResponse(envelope({ type: "string" })) },
      },
    },
    [manifest.operations.update.controllerPath]: {
      put: {
        "x-permission": manifest.operations.update.permission,
        requestBody: jsonRequest(refs.update),
        responses: { 200: jsonResponse(envelope({ nullable: true })) },
      },
    },
    [manifest.operations.remove.controllerPath]: {
      delete: {
        "x-permission": manifest.operations.remove.permission,
        parameters: [pathId],
        responses: { 200: jsonResponse(envelope({ nullable: true })) },
      },
    },
  },
  components: {
    schemas: {
      PageRequest: objectSchema(manifest.models.pageRequest.filter((field) => !["current", "size"].includes(field.name))),
      CreateRequest: objectSchema(manifest.models.createRequest, manifest.models.createRequest.filter((field) => field.required).map((field) => field.name)),
      UpdateRequest: objectSchema(manifest.models.updateRequest, manifest.models.updateRequest.filter((field) => field.required).map((field) => field.name)),
      Detail: objectSchema(manifest.models.detailResponse, ["id", "revision"]),
      PageRecord: objectSchema(manifest.models.pageResponse, ["id"]),
      DetailEnvelope: envelope({ $ref: "#/components/schemas/Detail" }),
      PageEnvelope: envelope({
        type: "object",
        properties: {
          records: { type: "array", items: { $ref: "#/components/schemas/PageRecord" } },
          total: { type: "integer", format: "int64" },
        },
      }),
    },
  },
};

const openapiResult = compareOpenApi(manifest, openapi);
assert.strictEqual(openapiResult.ok, true, JSON.stringify(openapiResult, null, 2));
assert.strictEqual(openapiResult.warnings.length, 0);
delete openapi.components.schemas.Detail.properties.revision;
assert.ok(compareOpenApi(manifest, openapi).errors.some((item) => item.code === "C206"));

console.log("✅ collaboration：前端 manifest、api.md、OpenAPI 与权限闭环通过");
