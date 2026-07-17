"use strict";

/**
 * schema-validator — MCP 工具入参 JSON Schema 校验（精简版）
 * 对标 wl-skills-kit/mcp/schema-validator.js，仅覆盖 bd 用到的类型。
 */

function validateSchema(schema, data) {
  const errors = [];
  if (!schema || schema === true) return { valid: true, errors };
  if (schema === false) {
    return { valid: false, errors: ["schema 为 false，禁止任何输入"] };
  }
  if (schema.type === "object") validateObject(schema, data, "", errors);
  return { valid: errors.length === 0, errors };
}

function validateObject(schema, data, path, errors) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(`${path || "root"} 应为 object`);
    return;
  }
  const required = schema.required || [];
  for (const req of required) {
    if (!(req in data)) errors.push(`${path}.${req} 必填`);
  }
  const props = schema.properties || {};
  for (const key of Object.keys(data)) {
    if (!(key in props)) {
      if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} 非允许字段`);
      }
      continue;
    }
    validateProp(props[key], data[key], `${path ? path + "." : ""}${key}`, errors);
  }
}

function validateProp(schema, value, path, errors) {
  if (!schema) return;
  if (value === undefined || value === null) return;
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") errors.push(`${path} 应为 string`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} 应为 boolean`);
      break;
    case "number":
      if (typeof value !== "number") errors.push(`${path} 应为 number`);
      break;
    case "array":
      if (!Array.isArray(value)) errors.push(`${path} 应为 array`);
      break;
    default:
      break;
  }
}

module.exports = { validateSchema };
