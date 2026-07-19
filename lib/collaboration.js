"use strict";

const fs = require("fs");
const path = require("path");
const { hashJson, stable, stableJson } = require("./deterministic");
const DEFAULT_DELIVERY_PROFILE = Object.freeze(JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "..", "files", ".wl-skills-bd", "contracts", "wl-delivery-profile.v1.json"),
  "utf8",
)));

const STANDARD_OPERATIONS = ["page", "detail", "create", "update", "remove"];
const OPERATION_ORDER = STANDARD_OPERATIONS;

function joinUrl(base, suffix) {
  return `${base.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
}

function fieldType(field) {
  const scalar = {
    String: { type: "string" },
    Integer: { type: "integer", format: "int32" },
    Long: { type: "integer", format: "int64" },
    Boolean: { type: "boolean" },
    BigDecimal: { type: "number" },
    LocalDate: { type: "string", format: "date" },
    LocalDateTime: { type: "string", format: "date-time" },
  };
  if (field.javaType === "List<String>") return { type: "array", items: { type: "string" } };
  if (field.javaType === "List<Long>") return { type: "array", items: { type: "integer", format: "int64" } };
  return scalar[field.javaType];
}

function contractField(field, required) {
  return stable({
    name: field.name,
    description: field.comment,
    required: required === true,
    ...fieldType(field),
    ...(field.maxLength ? { maxLength: field.maxLength } : {}),
  });
}

function customRequestField(field) {
  return stable({
    name: field.name,
    description: field.comment,
    required: field.required === true,
    ...fieldType({ javaType: field.javaType }),
    ...(field.maxLength ? { maxLength: field.maxLength } : {}),
  });
}

function syntheticField(name, description, type, required, format) {
  return stable({ name, description, required, type, ...(format ? { format } : {}) });
}

function standardOperation(name, contract, profile, basePaths) {
  const defaults = profile.apiDefaults[name];
  const requestModels = {
    page: "pageRequest",
    detail: "idPath",
    create: "createRequest",
    update: "updateRequest",
    remove: "idPath",
  };
  const responseModels = {
    page: "pageResponse",
    detail: "detailResponse",
    create: "idResponse",
    update: "emptyResponse",
    remove: "emptyResponse",
  };
  return {
    method: defaults.method,
    controllerPath: joinUrl(basePaths.controller, defaults.path),
    externalPath: joinUrl(basePaths.external, defaults.path),
    permission: contract.api.permissions[name],
    requestModel: requestModels[name],
    responseModel: responseModels[name],
  };
}

function customOperationManifest(op, contract, profile, basePaths) {
  const requestModel = `custom_${op.name}_request`;
  const responseModel = op.kind === "batch" ? "batchResponse" : "emptyResponse";
  return {
    method: op.method,
    controllerPath: joinUrl(basePaths.controller, op.path),
    externalPath: joinUrl(basePaths.external, op.path),
    permission: op.permission,
    requestModel,
    responseModel,
    kind: op.kind,
    idFrom: op.idFrom,
    summary: op.summary,
  };
}

function relationManifest(rel, basePaths) {
  return {
    type: rel.type,
    detailEntity: rel.detailEntity,
    detailContractId: rel.detailContractId,
    joinColumn: rel.joinColumn,
    cascadeSoftDelete: rel.cascadeSoftDelete === true,
    exposeQuery: rel.exposeQuery !== false,
    ...(rel.exposeQuery !== false ? {
      queryOperation: {
        method: "GET",
        controllerPath: joinUrl(basePaths.controller, `query${rel.detailEntity}ByParentId/{parentId}`),
        externalPath: joinUrl(basePaths.external, `query${rel.detailEntity}ByParentId/{parentId}`),
        responseModel: `relation_${rel.name}_response`,
      },
    } : {}),
    ...(rel.externalId ? { externalId: rel.externalId } : {}),
  };
}

function completionFor(contract, implementedOperations = []) {
  const implemented = new Set(implementedOperations);
  const skeletonOperations = [];
  if (contract.api.permissions && contract.api.permissions.export && !implemented.has("export")) skeletonOperations.push("export");
  for (const relation of contract.relations || []) {
    const name = `relation:${relation.name}`;
    if (relation.exposeQuery !== false && !implemented.has(name)) skeletonOperations.push(name);
  }
  for (const operation of contract.customOperations || []) {
    if (!implemented.has(operation.name)) skeletonOperations.push(operation.name);
  }
  return {
    contractStatus: skeletonOperations.length === 0 ? "confirmed" : "draft",
    openQuestions: skeletonOperations.map((name) => `${name} 仍是可编译骨架，必须补充业务实现与测试`),
    deviations: [],
    skeletonOperations,
  };
}

function buildManifest(contract, profile, deliveryProfile = DEFAULT_DELIVERY_PROFILE, options = {}) {
  const controllerBasePath = `/${contract.api.requestPath}`;
  const externalBasePath = contract.api.externalBasePath || controllerBasePath;
  const basePaths = { controller: controllerBasePath, external: externalBasePath };
  const businessFields = contract.fields;
  const writableFields = businessFields.filter((field) => field.writable);
  const queryFields = businessFields.filter((field) => field.queryMode !== "none");
  const detailFields = businessFields.filter((field) => field.detail);
  const listFields = businessFields.filter((field) => field.list);
  const operations = Object.fromEntries(STANDARD_OPERATIONS.map((name) => [
    name,
    standardOperation(name, contract, profile, basePaths),
  ]));
  const extensionOperations = {};
  if (contract.api.permissions && contract.api.permissions.export && profile.apiDefaults.export) {
    extensionOperations.export = {
      method: profile.apiDefaults.export.method,
      controllerPath: joinUrl(basePaths.controller, profile.apiDefaults.export.path),
      externalPath: joinUrl(basePaths.external, profile.apiDefaults.export.path),
      permission: contract.api.permissions.export,
      requestModel: "pageRequest",
      responseModel: "exportResponse",
    };
  }
  for (const op of contract.customOperations || []) {
    extensionOperations[op.name] = customOperationManifest(op, contract, profile, basePaths);
  }
  const allOperations = { ...operations, ...extensionOperations };

  const models = {
    pageRequest: [
      syntheticField("current", "当前页码", "integer", true, "int64"),
      syntheticField("size", "每页记录条数", "integer", true, "int64"),
      ...queryFields.map((field) => contractField(field, false)),
    ],
    createRequest: writableFields.map((field) => contractField(field, field.requiredOnCreate)),
    updateRequest: [
      syntheticField("id", "主键ID", "string", true),
      syntheticField("revision", "乐观锁版本号", "integer", true, "int32"),
      ...writableFields.map((field) => contractField(field, false)),
    ],
    detailResponse: [
      syntheticField("id", "主键ID", "string", true),
      syntheticField("revision", "乐观锁版本号", "integer", true, "int32"),
      ...detailFields.map((field) => contractField(field, false)),
    ],
    pageResponse: [
      syntheticField("id", "主键ID", "string", true),
      ...listFields.map((field) => contractField(field, false)),
    ],
  };
  if (extensionOperations.export) {
    models.exportResponse = [{ name: "download", description: "导出文件流", required: true, type: "string", format: "binary" }];
  }
  if (Object.values(extensionOperations).some((op) => op.responseModel === "batchResponse")) {
    models.batchResponse = [
      syntheticField("successCount", "成功数量", "integer", true, "int32"),
      syntheticField("failureCount", "失败数量", "integer", true, "int32"),
      { name: "failures", description: "失败项明细", required: false, type: "array", items: { type: "object" } },
    ];
  }
  for (const op of contract.customOperations || []) {
    models[`custom_${op.name}_request`] = [];
    if (op.kind === "batch") {
      models[`custom_${op.name}_request`].push({ name: "ids", description: "主键集合", required: true, type: "array", maxItems: 1000, items: { type: "string" } });
    } else if (op.idFrom === "body") {
      models[`custom_${op.name}_request`].push(syntheticField("id", "主键ID", "string", true));
    }
    for (const rf of op.requestFields || []) {
      models[`custom_${op.name}_request`].push(customRequestField(rf));
    }
  }

  const relations = (contract.relations || []).map((rel) => relationManifest(rel, basePaths));
  for (const rel of relations) {
    if (rel.queryOperation) {
      models[rel.queryOperation.responseModel] = [
        syntheticField("id", "主键ID", "string", true),
      ];
    }
  }

  const apiSurface = stable({
    resource: {
      contractId: contract.contractId,
      ...(contract.externalId ? { externalId: contract.externalId } : {}),
      module: contract.module,
      entity: contract.entity.name,
      description: contract.entity.description,
      permissionPrefix: contract.api.permissionPrefix,
    },
    transport: {
      successCode: profile.response.successCode,
      envelope: profile.response.envelope,
      pagination: {
        recordsPath: profile.response.pageRecordsPath,
        totalPath: profile.response.pageTotalPath,
      },
      controllerBasePath,
      externalBasePath,
    },
    operations: allOperations,
    ...(Object.keys(extensionOperations).length > 0 ? { extensionOperations: Object.keys(extensionOperations) } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    models,
  });

  const apiConfig = {
    list: operations.page.externalPath,
    getById: operations.detail.externalPath,
    save: operations.create.externalPath,
    update: operations.update.externalPath,
    remove: operations.remove.externalPath,
  };
  if (extensionOperations.export) apiConfig.export = extensionOperations.export.externalPath;
  for (const op of contract.customOperations || []) {
    apiConfig[op.name] = extensionOperations[op.name].externalPath;
  }
  for (const rel of relations) {
    if (rel.queryOperation) apiConfig[`query${rel.detailEntity}ByParentId`] = rel.queryOperation.externalPath;
  }

  const notes = [
    "getById/remove 的 {id} 必须在调用前替换，不能作为 query 参数直接传递。",
    "HTTP 方法以 operations 为准；update 使用 PUT，remove 使用 DELETE。",
    "Java Long 为 int64，前端若可能超过 Number.MAX_SAFE_INTEGER，应与后端约定字符串序列化。",
  ];
  if (Object.keys(extensionOperations).length > 0) {
    notes.push("extensionOperations 为业务命令/导出等扩展操作，前端需按 operations[name].method 调用，不可套用默认 CRUD hook。");
  }
  if (relations.length > 0) {
    notes.push("relations 描述主从关联；从表契约独立维护，主表通过 queryXxxByParentId 查询关联数据。");
  }

  return stable({
    schemaVersion: 1,
    kind: "wl-api-contract",
    protocolVersion: deliveryProfile.protocolVersion,
    source: {
      profile: profile.id,
      mode: "backend-contract",
      contractHash: hashJson(contract),
      apiHash: hashJson(apiSurface),
    },
    ...apiSurface,
    frontend: {
      apiConfig,
      pathParameterSyntax: "RFC6570-simple",
      notes,
    },
    completion: completionFor(contract, options.implementedOperations),
  });
}

function markdownType(field) {
  if (field.type === "array") {
    if (field.items && field.items.type) return `${field.items.type}[]`;
    return "array";
  }
  return field.format ? `${field.type}(${field.format})` : field.type;
}

function fieldTable(fields) {
  const lines = ["| 字段 | 类型 | 必填 | 说明 |", "|---|---|---|---|"];
  for (const field of fields) {
    lines.push(`| ${field.name} | ${markdownType(field)} | ${field.required ? "是" : "否"} | ${field.description} |`);
  }
  return lines.join("\n");
}

function operationsTable(manifest) {
  const rows = ["| 操作 | 方法 | 外部 URL | Controller URL | 权限码 |", "|---|---|---|---|---|"];
  const order = [...STANDARD_OPERATIONS, ...(manifest.extensionOperations || [])];
  for (const name of order) {
    const item = manifest.operations[name];
    if (!item) continue;
    rows.push(`| ${name} | ${item.method} | ${item.externalPath} | ${item.controllerPath} | ${item.permission} |`);
  }
  return rows.join("\n");
}

function renderMarkdown(manifest) {
  const extensionOps = manifest.extensionOperations || [];
  const relationSection = manifest.relations && manifest.relations.length > 0
    ? [
      "",
      "## 主从关联",
      "",
      "| 关联 | 类型 | 从实体 | 契约 | 外键 | 暴露查询 |",
      "|---|---|---|---|---|---|",
      ...manifest.relations.map((rel) => `| ${rel.queryOperation ? rel.queryOperation.responseModel.replace("relation_", "").replace("_response", "") : "-"} | ${rel.type} | ${rel.detailEntity} | ${rel.detailContractId} | ${rel.joinColumn} | ${rel.exposeQuery ? "是" : "否"} |`),
    ]
    : [];
  const lines = [
    `# 接口约定 - ${manifest.resource.description}`,
    "",
    "> 本文件由 `wl-skills-bd` 后端契约确定性生成；修改源契约后重新执行 codegen，不要手工改机器块。  ",
    `> 契约：${manifest.resource.contractId} | Profile：${manifest.source.profile}@${manifest.protocolVersion} | 状态：${manifest.completion.contractStatus}`,
    "",
    "## API_CONFIG",
    "",
    "```typescript",
    "export const API_CONFIG = {",
    ...Object.entries(manifest.frontend.apiConfig).map(([name, value]) => `  ${name}: ${JSON.stringify(value)},`),
    "} as const;",
    "```",
    "",
    "> 路径中的 `{id}` 必须先替换；请求方法以接口清单为准，不能套用前端默认 CRUD 方法。",
    "",
    "## 接口清单与权限",
    "",
    operationsTable(manifest),
    ...(extensionOps.length > 0 ? ["", "> 扩展操作（业务命令/导出）需前端按 method 精确调用。"] : []),
    "",
    "## 分页请求",
    "",
    fieldTable(manifest.models.pageRequest),
    "",
    `响应外壳成功码为 \`${manifest.transport.successCode}\`；列表路径为 \`${manifest.transport.pagination.recordsPath}\`，总数路径为 \`${manifest.transport.pagination.totalPath}\`。`,
    "",
    "## 新增请求",
    "",
    fieldTable(manifest.models.createRequest),
    "",
    "## 更新请求",
    "",
    fieldTable(manifest.models.updateRequest),
    "",
    "## 详情响应",
    "",
    fieldTable(manifest.models.detailResponse),
    "",
    "## 列表记录响应",
    "",
    fieldTable(manifest.models.pageResponse),
    "",
    ...relationSection,
    "",
    "## 机器可读契约",
    "",
    "```wl-api-contract",
    JSON.stringify(manifest, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

function generatedArtifacts(contract, profile, deliveryProfile) {
  const manifest = buildManifest(contract, profile, deliveryProfile);
  const root = contract.output.collaboration;
  return [
    {
      rel: `${root}/${contract.contractId}.backend-contract.json`,
      template: "collaboration-manifest",
      content: stableJson(manifest),
    },
    {
      rel: `${root}/${contract.contractId}.api.md`,
      template: "collaboration-api-md",
      content: renderMarkdown(manifest),
    },
  ];
}

function extractManifest(markdown, source = "api.md") {
  const matches = [...String(markdown).matchAll(/```(?:wl-api-contract|wl-backend-contract)\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) throw new Error(`${source}: 必须且只能包含一个 wl-api-contract 机器块`);
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`${source}: wl-api-contract JSON 解析失败: ${error.message}`);
  }
}

function readManifestArtifact(file) {
  const content = fs.readFileSync(file, "utf8");
  return path.extname(file).toLowerCase() === ".json" ? JSON.parse(content) : extractManifest(content, file);
}

function issue(list, code, location, message, expected, actual) {
  list.push({ code, path: location, message, ...(expected !== undefined ? { expected } : {}), ...(actual !== undefined ? { actual } : {}) });
}

function compareFieldModels(expected, actual, errors) {
  for (const [modelName, expectedFields] of Object.entries(expected.models)) {
    const actualFields = actual.models && actual.models[modelName];
    if (!Array.isArray(actualFields)) {
      issue(errors, "C104", `models.${modelName}`, "前端契约缺少字段模型");
      continue;
    }
    const byName = new Map(actualFields.map((field) => [field.name, field]));
    const expectedNames = new Set(expectedFields.map((field) => field.name));
    for (const expectedField of expectedFields) {
      const actualField = byName.get(expectedField.name);
      if (!actualField) {
        issue(errors, "C105", `models.${modelName}.${expectedField.name}`, "前端契约缺少字段");
        continue;
      }
      for (const key of ["type", "format", "required"]) {
        if ((actualField[key] ?? null) !== (expectedField[key] ?? null)) {
          issue(errors, "C106", `models.${modelName}.${expectedField.name}.${key}`, "前后端字段契约不一致", expectedField[key] ?? null, actualField[key] ?? null);
        }
      }
      if (expectedField.type === "array"
        && JSON.stringify(actualField.items || null) !== JSON.stringify(expectedField.items || null)) {
        issue(errors, "C106", `models.${modelName}.${expectedField.name}.items`, "前后端数组元素契约不一致", expectedField.items, actualField.items);
      }
    }
    for (const actualField of actualFields) {
      if (!expectedNames.has(actualField.name)) {
        issue(errors, "C105", `models.${modelName}.${actualField.name}`, "前端契约存在后端未声明字段");
      }
    }
  }
}

function compareManifest(expected, actual, options = {}) {
  const errors = [];
  const warnings = [];
  if (!actual || typeof actual !== "object") issue(errors, "C100", "$", "前端契约必须是对象");
  else {
    if (actual.schemaVersion !== 1) issue(errors, "C100", "schemaVersion", "只支持 schemaVersion=1", 1, actual.schemaVersion);
    if (actual.kind !== expected.kind) issue(errors, "C110", "kind", "契约类型不一致", expected.kind, actual.kind);
    if (actual.protocolVersion !== expected.protocolVersion) {
      issue(errors, "C111", "protocolVersion", "协议版本不一致", expected.protocolVersion, actual.protocolVersion);
    }
    if (!actual.source || actual.source.profile !== expected.source.profile) {
      issue(errors, "C112", "source.profile", "交付 profile 不一致", expected.source.profile, actual.source && actual.source.profile);
    }
    for (const key of ["contractId", "module", "entity", "description", "permissionPrefix"]) {
      const left = expected.resource && expected.resource[key];
      const right = actual.resource && actual.resource[key];
      if (right !== left) issue(errors, "C101", `resource.${key}`, "资源契约不一致", left, right);
    }
    if (expected.resource.externalId && actual.resource && actual.resource.externalId
      && expected.resource.externalId !== actual.resource.externalId) {
      issue(errors, "C101", "resource.externalId", "跨包稳定 ID 不一致", expected.resource.externalId, actual.resource.externalId);
    }
    for (const key of ["successCode", "envelope", "pagination", "externalBasePath"]) {
      const left = expected.transport[key];
      const right = actual.transport && actual.transport[key];
      if (JSON.stringify(right) !== JSON.stringify(left)) {
        issue(errors, "C108", `transport.${key}`, "前后端传输契约不一致", left, right);
      }
    }
    const order = [...STANDARD_OPERATIONS, ...(expected.extensionOperations || [])];
    for (const name of order) {
      const left = expected.operations[name];
      const right = actual.operations && actual.operations[name];
      if (!right) {
        issue(errors, "C102", `operations.${name}`, "前端契约缺少操作");
        continue;
      }
      for (const key of ["method", "externalPath", "permission", "requestModel", "responseModel"]) {
        if (right[key] !== left[key]) issue(errors, "C103", `operations.${name}.${key}`, "前后端操作契约不一致", left[key], right[key]);
      }
    }
    for (const name of Object.keys(actual.operations || {})) {
      if (!expected.operations[name]) issue(errors, "C102", `operations.${name}`, "前端契约存在后端未声明操作");
    }
    compareFieldModels(expected, actual, errors);
    for (const modelName of Object.keys(actual.models || {})) {
      if (!expected.models[modelName]) issue(errors, "C104", `models.${modelName}`, "前端契约存在后端未声明模型");
    }
    for (const [key, value] of Object.entries(expected.frontend.apiConfig)) {
      const actualValue = actual.frontend && actual.frontend.apiConfig && actual.frontend.apiConfig[key];
      if (actualValue !== value) issue(errors, "C109", `frontend.apiConfig.${key}`, "API_CONFIG 与后端外部路径不一致", value, actualValue);
    }
    if (actual.source && actual.source.apiHash && actual.source.apiHash !== expected.source.apiHash) {
      issue(warnings, "C107", "source.apiHash", "API 哈希不一致；详细差异以上述字段为准", expected.source.apiHash, actual.source.apiHash);
    }
    if (expected.resource.externalId && (!actual.resource || !actual.resource.externalId)) {
      issue(warnings, "C113", "resource.externalId", "前端未携带可选 design 稳定 ID；不影响独立闭环");
    }
    if (options.strict) {
      if (expected.completion.contractStatus !== "confirmed") {
        issue(errors, "C114", "completion.contractStatus", "后端仍含业务骨架，不能进入严格联调", "confirmed", expected.completion.contractStatus);
      }
      if (!actual.completion || actual.completion.contractStatus !== "confirmed") {
        issue(errors, "C114", "completion.contractStatus", "前端契约尚未确认", "confirmed", actual.completion && actual.completion.contractStatus);
      }
      if (actual.completion && Array.isArray(actual.completion.openQuestions) && actual.completion.openQuestions.length > 0) {
        issue(errors, "C115", "completion.openQuestions", "严格模式不允许前端未决问题");
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
}

function decodePointerToken(value) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveSchema(document, schema, seen = new Set()) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/")) return schema;
    if (seen.has(schema.$ref)) return schema;
    const target = schema.$ref.slice(2).split("/").map(decodePointerToken).reduce((value, key) => value && value[key], document);
    return resolveSchema(document, target, new Set([...seen, schema.$ref]));
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((result, part) => {
      const resolved = resolveSchema(document, part, seen) || {};
      return {
        ...result,
        ...resolved,
        properties: { ...(result.properties || {}), ...(resolved.properties || {}) },
        required: [...new Set([...(result.required || []), ...(resolved.required || [])])],
      };
    }, {});
  }
  return schema;
}

function operationSchema(document, operationValue) {
  const media = operationValue && operationValue.requestBody && operationValue.requestBody.content;
  const body = media && (media["application/json"] || Object.values(media)[0]);
  return resolveSchema(document, body && body.schema);
}

function schemaAt(document, schema, propertyPath) {
  let current = resolveSchema(document, schema);
  for (const key of propertyPath) {
    if (!current) return null;
    current = key === "[]" ? current.items : current.properties && current.properties[key];
    current = resolveSchema(document, current);
  }
  return current;
}

function compareSchemaFields(document, schema, expectedFields, location, errors, warnings) {
  const resolved = resolveSchema(document, schema);
  if (!resolved || !resolved.properties) {
    issue(warnings, "C205", location, "OpenAPI schema 无可解析 properties，跳过字段级核对");
    return;
  }
  const required = new Set(resolved.required || []);
  for (const field of expectedFields) {
    const actual = resolveSchema(document, resolved.properties[field.name]);
    if (!actual) {
      issue(errors, "C206", `${location}.${field.name}`, "OpenAPI 缺少契约字段");
      continue;
    }
    if (actual.type && actual.type !== field.type) issue(errors, "C207", `${location}.${field.name}.type`, "OpenAPI 字段类型不一致", field.type, actual.type);
    if (field.format && actual.format !== field.format) issue(errors, "C207", `${location}.${field.name}.format`, "OpenAPI 字段 format 不一致", field.format, actual.format || null);
    if (field.type === "array" && field.items && actual.items) {
      const actualItems = resolveSchema(document, actual.items);
      if (actualItems.type && actualItems.type !== field.items.type) {
        issue(errors, "C207", `${location}.${field.name}.items.type`, "OpenAPI 数组元素类型不一致", field.items.type, actualItems.type);
      }
    }
    if (field.required && !required.has(field.name)) issue(errors, "C208", `${location}.${field.name}`, "OpenAPI 未将必填字段列入 required");
  }
}

function successfulResponse(operationValue) {
  const responses = operationValue.responses || {};
  const key = Object.keys(responses).find((name) => /^2\d\d$/.test(name));
  return key && responses[key];
}

function responseSchema(response) {
  const content = response && response.content;
  const media = content && (content["application/json"] || Object.values(content)[0]);
  return media && media.schema;
}

function compareOpenApi(manifest, document) {
  const errors = [];
  const warnings = [];
  if (!document || typeof document !== "object" || !document.openapi || !document.paths) {
    issue(errors, "C200", "$", "文件不是有效的 OpenAPI 3 文档");
    return { ok: false, errors, warnings, summary: { errors: 1, warnings: 0 } };
  }
  const order = [...STANDARD_OPERATIONS, ...(manifest.extensionOperations || [])];
  for (const name of order) {
    const expected = manifest.operations[name];
    if (!expected) continue;
    const pathItem = document.paths[expected.controllerPath];
    const actual = pathItem && pathItem[expected.method.toLowerCase()];
    if (!actual) {
      issue(errors, "C201", `paths.${expected.controllerPath}.${expected.method.toLowerCase()}`, "OpenAPI 缺少后端契约操作");
      continue;
    }
    if (actual["x-permission"] && actual["x-permission"] !== expected.permission) {
      issue(errors, "C202", `operations.${name}.x-permission`, "OpenAPI 权限扩展与契约不一致", expected.permission, actual["x-permission"]);
    } else if (!actual["x-permission"]) {
      issue(warnings, "C203", `operations.${name}.x-permission`, "OpenAPI 未发布 x-permission，权限请用独立权限清单核对");
    }
    const response = successfulResponse(actual);
    if (!response && name !== "export") issue(errors, "C204", `operations.${name}.responses`, "OpenAPI 缺少成功响应");

    if (["page", "create", "update"].includes(name)) {
      const bodySchema = operationSchema(document, actual);
      const expectedModel = name === "page"
        ? manifest.models.pageRequest.filter((field) => !["current", "size"].includes(field.name))
        : manifest.models[expected.requestModel];
      if (!bodySchema) issue(errors, "C205", `operations.${name}.requestBody`, "OpenAPI 缺少 JSON 请求体 schema");
      else compareSchemaFields(document, bodySchema, expectedModel, `operations.${name}.requestBody`, errors, warnings);
    }
    if (name === "page") {
      const parameters = [...(pathItem.parameters || []), ...(actual.parameters || [])].map((item) => resolveSchema(document, item));
      for (const parameterName of ["current", "size"]) {
        if (!parameters.some((parameter) => parameter.in === "query" && parameter.name === parameterName)) {
          issue(errors, "C209", `operations.page.parameters.${parameterName}`, "分页接口缺少 query 参数");
        }
      }
    }
    if (["detail", "remove"].includes(name)) {
      const parameters = [...(pathItem.parameters || []), ...(actual.parameters || [])].map((item) => resolveSchema(document, item));
      if (!parameters.some((parameter) => parameter.in === "path" && parameter.name === "id" && parameter.required === true)) {
        issue(errors, "C210", `operations.${name}.parameters.id`, "路径参数 id 缺失或未标记 required");
      }
    }

    if (response && name !== "export") {
      const envelope = resolveSchema(document, responseSchema(response));
      if (envelope && envelope.properties) {
        for (const key of manifest.transport.envelope) {
          if (!envelope.properties[key]) issue(errors, "C211", `operations.${name}.response.${key}`, "响应外壳缺少字段");
        }
        const codeSchema = resolveSchema(document, envelope.properties.code);
        const declaredCodes = codeSchema && [
          ...(Array.isArray(codeSchema.enum) ? codeSchema.enum : []),
          codeSchema.const,
          codeSchema.example,
          codeSchema.default,
        ].filter((value) => value !== undefined);
        if (declaredCodes && declaredCodes.length > 0 && !declaredCodes.includes(manifest.transport.successCode)) {
          issue(errors, "C213", `operations.${name}.response.code`, "OpenAPI 声明的业务成功码不是 2000", manifest.transport.successCode, declaredCodes);
        } else if (!declaredCodes || declaredCodes.length === 0) {
          issue(warnings, "C213", `operations.${name}.response.code`, "OpenAPI 未用 const/enum/example/default 声明业务成功码 2000");
        }
        if (name === "detail") {
          const detail = schemaAt(document, envelope, ["data"]);
          compareSchemaFields(document, detail, manifest.models.detailResponse, "operations.detail.response.data", errors, warnings);
        }
        if (name === "page") {
          const records = schemaAt(document, envelope, ["data", "records", "[]"]);
          compareSchemaFields(document, records, manifest.models.pageResponse, "operations.page.response.data.records", errors, warnings);
          if (!schemaAt(document, envelope, ["data", "total"])) issue(errors, "C212", "operations.page.response.data.total", "分页响应缺少 total");
        }
      } else {
        issue(warnings, "C211", `operations.${name}.response`, "OpenAPI 成功响应无可解析外壳 schema");
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
}

function permissionsFromJson(value) {
  const rows = Array.isArray(value) ? value : value && (value.permissions || value.actions || value.items);
  if (!Array.isArray(rows)) throw new Error("权限 JSON 必须是数组，或包含 permissions/actions/items 数组");
  return rows.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return null;
    return item.permission || item.permissionCode || item.code || item.strPermission || null;
  }).filter(Boolean);
}

function comparePermissions(manifest, inventory, source = "permission inventory") {
  const errors = [];
  const warnings = [];
  const order = [...STANDARD_OPERATIONS, ...(manifest.extensionOperations || [])];
  const expected = order.map((name) => manifest.operations[name] && manifest.operations[name].permission).filter(Boolean);
  let actual;
  if (typeof inventory === "string") {
    actual = expected.filter((permission) => inventory.includes(permission));
  } else {
    actual = permissionsFromJson(inventory);
  }
  const actualSet = new Set(actual);
  for (const permission of expected) {
    if (!actualSet.has(permission)) issue(errors, "C301", source, `权限清单缺少 ${permission}`);
  }
  if (typeof inventory !== "string") {
    for (const permission of actualSet) {
      if (!expected.includes(permission) && permission.startsWith(`${manifest.resource.permissionPrefix}_`)) {
        issue(warnings, "C302", source, `同一权限前缀下存在契约外权限 ${permission}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
}

const KIT_PERMISSION_LINE = /^\s*\|\s*([a-z_][a-z0-9_:|-]*?)\s*\|\s*([^\|]+?)\s*\|/;

function buildPermissionInventory(manifest) {
  const order = [...STANDARD_OPERATIONS, ...(manifest.extensionOperations || [])];
  const rows = [];
  const labels = {
    page: "分页查询",
    detail: "详情查询",
    create: "新增",
    update: "修改",
    remove: "删除",
    export: "导出",
  };
  for (const name of order) {
    const op = manifest.operations[name];
    if (!op || !op.permission) continue;
    rows.push({
      permission: op.permission,
      name: op.summary || labels[name] || name,
      module: manifest.resource.module,
      resource: manifest.resource.entity,
      operation: name,
    });
  }
  return {
    contractId: manifest.resource.contractId,
    module: manifest.resource.module,
    permissionPrefix: manifest.resource.permissionPrefix,
    rows,
  };
}

function renderPermissionInventoryMarkdown(inventory) {
  const lines = [
    `# 权限基线 - ${inventory.contractId}`,
    "",
    "> 本文件由 `wl-skills-bd` 从后端契约确定性生成，供 wl-skills-kit permission-sync 消费。",
    `> 契约：${inventory.contractId} | 模块：${inventory.module} | 权限前缀：${inventory.permissionPrefix}`,
    "",
    "| permission | name | module | resource | operation |",
    "|---|---|---|---|---|",
    ...inventory.rows.map((row) => `| ${row.permission} | ${row.name} | ${row.module} | ${row.resource} | ${row.operation} |`),
    "",
    "## 使用",
    "",
    "把本表格合并到前端项目 `reports/SYS_PERMISSION_INFO.md` 的权限清单，再执行 `wl-skills permission-sync`。",
    "",
  ];
  return lines.join("\n");
}

function compareKitApiMarkdown(manifest, markdown, source = "kit api.md", options = {}) {
  const errors = [];
  const warnings = [];
  if (!markdown || typeof markdown !== "string") {
    issue(errors, "C400", "$", "kit api.md 必须是字符串");
    return { ok: false, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
  }
  try {
    const frontend = extractManifest(markdown, source);
    return compareManifest(manifest, frontend, options);
  } catch (error) {
    issue(warnings, "C401", "$", `未发现结构化 wl-api-contract，降级为旧版文本核对：${error.message}`);
  }
  const externalBase = manifest.transport.externalBasePath;
  const externalMention = new RegExp(externalBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!externalMention.test(markdown)) {
    issue(warnings, "C403", "externalBasePath", "kit api.md 未提及后端 externalBasePath", externalBase);
  }
  for (const field of manifest.models.detailResponse) {
    const fieldMention = new RegExp(`\\b${field.name}\\b`);
    if (!fieldMention.test(markdown)) {
      issue(warnings, "C404", `detailResponse.${field.name}`, "kit api.md 未提及后端详情字段");
    }
  }
  for (const name of Object.keys(manifest.operations)) {
    if (STANDARD_OPERATIONS.includes(name) || name === "export") continue;
    const opMention = new RegExp(`\\b${name}\\b`);
    if (!opMention.test(markdown)) {
      issue(errors, "C405", `operations.${name}`, `kit api.md 未提及后端业务命令 ${name}；前端需生成对应 hook`);
    }
  }
  if (manifest.relations) {
    for (const rel of manifest.relations) {
      if (!rel.exposeQuery) continue;
      const relMention = new RegExp(`\\b${rel.detailEntity}\\b`, "i");
      if (!relMention.test(markdown)) {
        issue(warnings, "C406", `relations.${rel.detailEntity}`, "kit api.md 未提及后端主从关联从实体");
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, summary: { errors: errors.length, warnings: warnings.length } };
}

module.exports = {
  OPERATION_ORDER,
  STANDARD_OPERATIONS,
  buildManifest,
  buildPermissionInventory,
  compareKitApiMarkdown,
  compareManifest,
  compareOpenApi,
  comparePermissions,
  customOperationManifest,
  extractManifest,
  generatedArtifacts,
  readManifestArtifact,
  renderMarkdown,
  renderPermissionInventoryMarkdown,
  relationManifest,
};
