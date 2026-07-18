"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyFixPlan, buildFixPlan, publicFixPlan } = require("../lib/safe-fix");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-safe-fix-"));

function write(rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
  return file;
}

try {
  const mapper = write("src/main/resources/mapper/DemoMapper.xml", `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="demo.DemoMapper">
  <sql id="BaseColumns">
    t.ID AS id,
    t.COMPANY_ID AS companyId
  </sql>
  <select id="queryPage" resultType="demo.DemoVO">
    SELECT t.* FROM DEMO_TABLE t
    WHERE t.COMPANY_ID = #{companyId}
  </select>
</mapper>
`);
  const service = write("src/main/java/demo/DemoService.java", `package demo;

import org.springframework.stereotype.Service;

@Service
public class DemoService {
    /**
     * 保存数据。
     */
    public void save() {
        System.out.println("save");
    }
}
`);
  write("src/main/resources/mapper/UnsafeMapper.xml", `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="demo.UnsafeMapper">
  <select id="query" resultType="map">
    SELECT * FROM UNSAFE_TABLE t WHERE t.COMPANY_ID = #{companyId}
  </select>
</mapper>
`);

  const plan = buildFixPlan(root, { rules: ["B3", "B5"] });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.actions.length, 2);
  assert.strictEqual(plan.manual.length, 1);
  assert.strictEqual(plan.manual[0].rule, "B3");
  assert.strictEqual(fs.readFileSync(mapper, "utf8").includes("SELECT t.*"), true, "preview 必须零写入");
  assert.strictEqual(publicFixPlan(plan).state, "ready");

  assert.strictEqual(applyFixPlan(plan, { planHash: plan.planHash }).reason, "confirm-required");
  assert.strictEqual(applyFixPlan(plan, { confirm: true, planHash: "bad" }).reason, "plan-hash-mismatch");
  assert.strictEqual(fs.readFileSync(service, "utf8").includes("@Transactional"), false);

  const result = applyFixPlan(plan, { confirm: true, planHash: plan.planHash });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.closure.selectedOk, false, "无 BaseColumns 的 B3 必须保留为人工项");
  assert.strictEqual(result.closure.remaining, 1);
  assert.match(fs.readFileSync(mapper, "utf8"), /<include refid="BaseColumns"\/>/);
  assert.match(fs.readFileSync(service, "utf8"), /import org\.springframework\.transaction\.annotation\.Transactional;/);
  assert.match(fs.readFileSync(service, "utf8"), /@Transactional\(rollbackFor = Exception\.class\)/);
  assert.ok(fs.existsSync(path.join(root, result.reportRel)));
  for (const rel of ["src/main/resources/mapper/DemoMapper.xml", "src/main/java/demo/DemoService.java"]) {
    assert.ok(fs.existsSync(path.join(root, ".wl-skills-bd", ".state", "fix-backups", result.backupId, rel)));
  }

  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-safe-fix-drift-"));
  try {
    const driftFile = path.join(driftRoot, "src/main/java/demo/DriftService.java");
    fs.mkdirSync(path.dirname(driftFile), { recursive: true });
    fs.writeFileSync(driftFile, `package demo;\npublic class DriftService {\n/** Save. */\npublic void save() {}\n}\n`, "utf8");
    const driftPlan = buildFixPlan(driftRoot, { rules: ["B5"] });
    fs.appendFileSync(driftFile, "// changed after preview\n", "utf8");
    const blocked = applyFixPlan(driftPlan, { confirm: true, planHash: driftPlan.planHash });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason, "plan-changed");
    assert.doesNotMatch(fs.readFileSync(driftFile, "utf8"), /@Transactional/);
  } finally {
    fs.rmSync(driftRoot, { recursive: true, force: true });
  }

  const unsupported = buildFixPlan(root, { rules: ["B1"] });
  assert.strictEqual(unsupported.ok, false);
  assert.strictEqual(unsupported.reason, "unsupported-rules");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("✅ safe-fix：B3/B5 白名单、人工降级、确认门、备份、漂移阻断与强制复扫通过");
