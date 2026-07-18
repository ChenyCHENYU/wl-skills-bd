"use strict";

function typeMatches(type, value) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validateValue(schema, value, location, errors) {
  if (!schema || schema === true) return;
  if (schema === false) {
    errors.push(`${location} 被 schema 禁止`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${location} 必须等于 ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location} 只允许 ${schema.enum.join("/")}`);
  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${location} 应为 ${schema.type}`);
    return;
  }
  if (schema.type === "object") validateObject(schema, value, location, errors);
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location} 至少需要 ${schema.minItems} 项`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location} 最多允许 ${schema.maxItems} 项`);
    value.forEach((item, index) => validateValue(schema.items, item, `${location}[${index}]`, errors));
  }
  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location} 长度不能小于 ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location} 长度不能大于 ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${location} 格式不匹配 ${schema.pattern}`);
  }
  if (["number", "integer"].includes(schema.type)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${location} 不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${location} 不能大于 ${schema.maximum}`);
  }
}

function validateObject(schema, data, location, errors) {
  for (const key of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) errors.push(`${location}.${key} 必填`);
  }
  const properties = schema.properties || {};
  for (const [key, value] of Object.entries(data)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      if (schema.additionalProperties === false) errors.push(`${location}.${key} 非允许字段`);
      continue;
    }
    validateValue(properties[key], value, `${location}.${key}`, errors);
  }
}

function validateSchema(schema, data) {
  const errors = [];
  validateValue(schema, data, "root", errors);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateSchema };
