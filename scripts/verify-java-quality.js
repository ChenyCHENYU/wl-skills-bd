#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const QUALITY = path.join(ROOT, "files", ".github", "java-quality");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertXml(content, name) {
  const cleaned = content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const stack = [];
  const tags = cleaned.match(/<[^>]+>/g) || [];
  for (const tag of tags) {
    if (/^<\?|^<!|^<\//.test(tag)) {
      if (/^<\//.test(tag)) {
        const nameValue = tag.match(/^<\/\s*([^\s>]+)/)[1];
        assert.strictEqual(stack.pop(), nameValue, `${name}: XML 闭合标签不匹配 ${tag}`);
      }
      continue;
    }
    if (/\/>$/.test(tag)) continue;
    stack.push(tag.match(/^<\s*([^\s/>]+)/)[1]);
  }
  assert.deepStrictEqual(stack, [], `${name}: XML 标签未闭合`);
}

const xmlFiles = [
  "files/.github/java-quality/checkstyle/checkstyle.xml",
  "files/.github/java-quality/pmd/pmd-ruleset.xml",
  "files/.github/java-quality/spotbugs/spotbugs-exclude.xml",
  "files/.github/java-quality/maven-snippets/quality-profile.xml",
  "files/.github/java-quality/maven-snippets/p3c-legacy-profile.xml",
];
for (const file of xmlFiles) assertXml(read(file), file);

const qualityProfile = read("files/.github/java-quality/maven-snippets/quality-profile.xml");
assert.match(qualityProfile, /maven-checkstyle-plugin[\s\S]*?<version>3\.6\.0<\/version>/);
assert.match(qualityProfile, /maven-pmd-plugin[\s\S]*?<version>3\.28\.0<\/version>/);
assert.match(qualityProfile, /spotbugs-maven-plugin[\s\S]*?<version>4\.8\.6\.8<\/version>/);
assert.match(qualityProfile, /spotless-maven-plugin[\s\S]*?<version>2\.30\.0<\/version>/);
assert.match(qualityProfile, /jacoco-maven-plugin[\s\S]*?<version>0\.8\.15<\/version>/);
assert.match(qualityProfile, /<include>\*\/service\/\*<\/include>[\s\S]*?<minimum>0\.70<\/minimum>/);
assert.match(qualityProfile, /<include>\*\/controller\/\*<\/include>[\s\S]*?<minimum>0\.50<\/minimum>/);
assert.doesNotMatch(qualityProfile, /p3c-pmd/, "PMD 7 默认门禁不得混入 PMD 6 P3C");

const legacyProfile = read("files/.github/java-quality/maven-snippets/p3c-legacy-profile.xml");
assert.match(legacyProfile, /maven-pmd-plugin[\s\S]*?<version>3\.21\.2<\/version>/);
assert.match(legacyProfile, /p3c-pmd[\s\S]*?<version>2\.1\.1<\/version>/);
assert.match(legacyProfile, /<failOnViolation>false<\/failOnViolation>/);

const checkstyle = read("files/.github/java-quality/checkstyle/checkstyle.xml");
assert.ok(checkstyle.indexOf('<module name="LineLength">') < checkstyle.indexOf('<module name="TreeWalker">'), "LineLength 必须是 Checker 子模块");
assert.match(checkstyle, /<module name="FileLength">[\s\S]*?<property name="max" value="500"\/>/);

const pmd = read("files/.github/java-quality/pmd/pmd-ruleset.xml");
assert.match(pmd, /pmd7/);
assert.doesNotMatch(pmd, /rulesets\/java\/ali-/);

const catalog = JSON.parse(read("files/.wl-skills-bd/rules/catalog.json"));
const j6 = catalog.rules.find((rule) => rule.id === "J6");
assert.strictEqual(j6.gate, false);
assert.strictEqual(j6.severity, "info");

if (!process.argv.includes("--maven")) {
  console.log("✅ java-quality：XML、版本、PMD7/P3C6 隔离与规则配置结构通过");
  process.exit(0);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-quality-"));
try {
  const profileMatch = qualityProfile.match(/<profile>[\s\S]*<\/profile>/);
  assert.ok(profileMatch, "quality-profile.xml 缺 profile");
  const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.jhict.fixture</groupId><artifactId>quality-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.5</version><scope>test</scope></dependency></dependencies>
  <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version></plugin></plugins></build>
  <profiles>${profileMatch[0]}</profiles>
</project>\n`;
  fs.writeFileSync(path.join(tempRoot, "pom.xml"), pom, "utf8");
  fs.cpSync(QUALITY, path.join(tempRoot, ".github", "java-quality"), { recursive: true });
  const source = path.join(tempRoot, "src", "main", "java", "com", "jhict", "fixture", "Sample.java");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, `package com.jhict.fixture;

/**
 * 质量门夹具。
 *
 * @author wl-skills-bd
 */
public final class Sample {

    private Sample() {}

    /**
     * 两数相加。
     *
     * @param left 左值
     * @param right 右值
     * @return 和
     */
    public static int add(int left, int right) {
        return left + right;
    }
}
`, "utf8");
  const coverageService = path.join(tempRoot, "src", "main", "java", "com", "jhict", "fixture", "service", "CoverageService.java");
  fs.mkdirSync(path.dirname(coverageService), { recursive: true });
  fs.writeFileSync(coverageService, `package com.jhict.fixture.service;

/**
 * 覆盖率服务夹具。
 *
 * @author wl-skills-bd
 */
public class CoverageService {

    /**
     * 返回绝对值。
     *
     * @param value 输入值
     * @return 非负值
     */
    public int absolute(int value) {
        if (value < 0) {
            return -value;
        }
        return value;
    }
}
`, "utf8");
  const coverageController = path.join(tempRoot, "src", "main", "java", "com", "jhict", "fixture", "controller", "CoverageController.java");
  fs.mkdirSync(path.dirname(coverageController), { recursive: true });
  fs.writeFileSync(coverageController, `package com.jhict.fixture.controller;

/**
 * 覆盖率控制器夹具。
 *
 * @author wl-skills-bd
 */
public class CoverageController {

    /**
     * 健康状态。
     *
     * @return ok
     */
    public String health() {
        return "ok";
    }
}
`, "utf8");
  const coverageTest = path.join(tempRoot, "src", "test", "java", "com", "jhict", "fixture", "coverage", "CoverageTest.java");
  fs.mkdirSync(path.dirname(coverageTest), { recursive: true });
  fs.writeFileSync(coverageTest, `package com.jhict.fixture.coverage;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.jhict.fixture.controller.CoverageController;
import com.jhict.fixture.service.CoverageService;
import org.junit.jupiter.api.Test;

/**
 * 覆盖率门夹具测试。
 *
 * @author wl-skills-bd
 */
class CoverageTest {

    @Test
    void shouldCoverServiceBranchesAndController() {
        CoverageService service = new CoverageService();
        assertEquals(2, service.absolute(-2));
        assertEquals(2, service.absolute(2));
        assertEquals("ok", new CoverageController().health());
    }
}
`, "utf8");
  const archUnitSource = path.join(tempRoot, "src", "test", "java", "com", "jhict", "fixture", "arch", "LayerRulesTest.java");
  fs.mkdirSync(path.dirname(archUnitSource), { recursive: true });
  fs.writeFileSync(
    archUnitSource,
    read("files/.github/java-quality/archunit/LayerRulesTest.java").replace(/\{\{rootPackage\}\}/g, "com.jhict.fixture"),
    "utf8",
  );
  let command = process.env.WL_MAVEN_COMMAND || "mvn";
  let commandArgs = ["-B", "-ntp", "verify", "-Pwl-quality"];
  if (process.platform === "win32") {
    if (!process.env.WL_MAVEN_COMMAND) {
      const located = spawnSync("where.exe", ["mvn.cmd"], { encoding: "utf8", windowsHide: true });
      assert.strictEqual(located.status, 0, "未找到 mvn.cmd；可设置 WL_MAVEN_COMMAND 为绝对路径");
      command = located.stdout.split(/\r?\n/).find(Boolean);
    }
    command = path.resolve(command);
    assert.ok(/\.cmd$/i.test(command) && fs.existsSync(command), "WL_MAVEN_COMMAND 必须是存在的 .cmd 绝对路径");
    const mavenHome = path.dirname(path.dirname(command));
    const bootJar = fs.readdirSync(path.join(mavenHome, "boot")).find((name) => /^plexus-classworlds-.*\.jar$/.test(name));
    assert.ok(bootJar, "Maven boot/plexus-classworlds JAR 不存在");
    commandArgs = [
      `-Dclassworlds.conf=${path.join(mavenHome, "bin", "m2.conf")}`,
      `-Dmaven.home=${mavenHome}`,
      `-Dmaven.multiModuleProjectDirectory=${tempRoot}`,
      "-classpath",
      path.join(mavenHome, "boot", bootJar),
      "org.codehaus.plexus.classworlds.launcher.Launcher",
      "-B",
      "-ntp",
      "verify",
      "-Pwl-quality",
    ];
    command = path.join(process.env.JAVA_HOME || "", "bin", "java.exe");
    if (!fs.existsSync(command)) command = "java.exe";
  }
  const result = spawnSync(command, commandArgs, {
    cwd: tempRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, `Java 质量 Maven 夹具失败：${result.error ? `\n${result.error.message}` : ""}\n${result.stdout || ""}\n${result.stderr || ""}`);
  const generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-generated-quality-"));
  try {
    const { applyPlan, buildPlan } = require("../lib/codegen");
    const contractFile = path.join(ROOT, "files", ".github", "templates", "examples", "sale-order-master.contract.json");
    const plan = buildPlan(contractFile, { projectRoot: generatedRoot });
    assert.strictEqual(plan.ok, true, JSON.stringify(plan.errors));
    assert.strictEqual(applyPlan(plan, { confirm: true, planHash: plan.planHash }).ok, true);
    const generatedProfile = profileMatch[0]
      .replace("<includeTestSourceDirectory>false</includeTestSourceDirectory>", "<includeTestSourceDirectory>true</includeTestSourceDirectory>")
      .replace("<linkXRef>false</linkXRef>", "<linkXRef>false</linkXRef><includeTests>true</includeTests>");
    fs.writeFileSync(path.join(generatedRoot, "pom.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.jhict.fixture</groupId><artifactId>generated-quality-fixture</artifactId><version>1.0.0</version>
  <properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <profiles>${generatedProfile}</profiles>
</project>
`, "utf8");
    fs.cpSync(QUALITY, path.join(generatedRoot, ".github", "java-quality"), { recursive: true });
    const generatedArgs = commandArgs.map((arg) => arg.startsWith("-Dmaven.multiModuleProjectDirectory=")
      ? `-Dmaven.multiModuleProjectDirectory=${generatedRoot}`
      : arg);
    const lifecycleIndex = generatedArgs.indexOf("verify");
    assert.ok(lifecycleIndex >= 0, "Maven 参数缺 verify 生命周期");
    generatedArgs.splice(
      lifecycleIndex,
      1,
      "validate",
      "com.diffplug.spotless:spotless-maven-plugin:2.30.0:check",
      "org.apache.maven.plugins:maven-pmd-plugin:3.28.0:check",
    );
    const generatedResult = spawnSync(command, generatedArgs, {
      cwd: generatedRoot,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
      windowsHide: true,
    });
    assert.strictEqual(generatedResult.status, 0, `生成产物源码质量门失败：${generatedResult.error ? `\n${generatedResult.error.message}` : ""}\n${generatedResult.stdout || ""}\n${generatedResult.stderr || ""}`);
  } finally {
    fs.rmSync(generatedRoot, { recursive: true, force: true });
  }
  console.log("✅ java-quality Maven：ArchUnit、Checkstyle、PMD7、SpotBugs、Spotless、JaCoCo 在 Java 8 工程真实通过");
  console.log("✅ generated Java quality：扩展契约主代码与测试通过 Checkstyle、Spotless、PMD7 源码门");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
