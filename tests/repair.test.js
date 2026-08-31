"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { adviseRepairs } = require("../lib/repair");

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "wls-repair-")); }
function write(project, rel, content) { const file = path.join(project, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, "utf8"); }

test("repair advice 严格区分自动、安全建议和人工语义", () => {
  const project = root();
  write(project, "src/main/resources/mapper/DemoMapper.xml", `<mapper namespace="x.DemoMapper"><sql id="BaseColumns">id,name</sql><select id="list">SELECT * FROM demo</select></mapper>`);
  const result = adviseRepairs(project, { rules: ["B3"] });
  assert.equal(result.ok, true);
  assert.equal(result.summary.autoSafe, 1);
  assert.equal(result.source[0].remediation, "auto-safe");
  assert.deepEqual(result.safety.autoApply, ["B3", "B5", "project-approved exact safeReplacement"]);
});

test("没有项目适配配置时 repair 不虚构 MQ 修复", () => {
  const project = root();
  write(project, "application.yml", "rocketmq.name-server: broker");
  const result = adviseRepairs(project, { rules: ["B3"] });
  assert.equal(result.integration.length, 0);
  assert.equal(result.summary.platformAdapter, 0);
});
