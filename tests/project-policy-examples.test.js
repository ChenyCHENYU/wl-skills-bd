"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { validateAdapterConfig } = require("../lib/integration-adapter");
const { validateConfig: validateAssertions } = require("../lib/policy-assertions");
const { validateConfig: validateQualityGate } = require("../lib/quality-gate");
const { validatePolicy } = require("../lib/supply-chain");

const machineRoot = path.resolve(__dirname, "..", "files", ".wl-skills-bd");

function json(rel) {
  return JSON.parse(fs.readFileSync(path.join(machineRoot, rel), "utf8"));
}

test("四类项目策略示例与运行时校验器保持一致", () => {
  assert.equal(validateAdapterConfig(json("integration-adapters.example.json")).ok, true);
  assert.equal(validateAssertions(json("quality-assertions.example.json")).ok, true);
  assert.equal(validatePolicy(json("supply-chain.example.json")).ok, true);
  const diagnostics = [];
  validateQualityGate(json("quality-gate.example.json"), diagnostics);
  assert.deepEqual(diagnostics, []);
});

test("四类项目策略 JSON Schema 均可解析且保持 additionalProperties=false", () => {
  for (const rel of ["quality-gate", "integration-adapters", "quality-assertions", "supply-chain"]) {
    const schema = json(`schemas/${rel}.schema.json`);
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schemaVersion.const, 1);
  }
});
