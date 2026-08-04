"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBeRules } = require("../lib/be-rules");

function fixture(mapperLocations) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-mapper-locations-"));
  const files = {
    "src/main/java/com/example/mapper/DemoMapper.java": `package com.example.mapper;
@Mapper
public interface DemoMapper extends BaseMapper<Demo> {}`,
    "src/main/resources/mapper/example/DemoMapper.xml": `<mapper namespace="com.example.mapper.DemoMapper"></mapper>`,
    "src/main/resources/application.yml": `mybatis-plus:\n  mapper-locations: ${mapperLocations}\n`,
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

const bad = fixture("classpath*:mybatis/*Mapper.xml");
try {
  assert.ok(runBeRules(bad).issues.some((item) => item.rule === "B26" && /mapper-locations/.test(item.message)));
} finally {
  fs.rmSync(bad, { recursive: true, force: true });
}

const good = fixture("classpath*:mapper/**/*Mapper.xml");
try {
  assert.strictEqual(runBeRules(good).issues.filter((item) => item.rule === "B26").length, 0);
} finally {
  fs.rmSync(good, { recursive: true, force: true });
}

console.log("✅ B26 mapper resources：本地 mapper-locations 与实际 XML 资源目录闭环通过");
