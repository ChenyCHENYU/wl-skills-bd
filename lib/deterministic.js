"use strict";

const { hashBuffer } = require("./manifest");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hashJson(value) {
  return hashBuffer(Buffer.from(JSON.stringify(stable(value)), "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

module.exports = { hashJson, stable, stableJson };
