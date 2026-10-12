#!/usr/bin/env node
"use strict";

// 在临时工程验证实际 Java 分析器与所有权边界，不执行业务工程/POM。
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const qualityRoot = path.join(packageRoot, "files", ".github", "java-quality");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wl-bd-codecc-quality-"));
const evidenceRoot = process.env.WL_CODECC_FIXTURE_REPORT_DIR;
const keepFixture = Boolean(evidenceRoot && process.argv.includes("--keep-fixture"));
const selectedRules = ["UseLocaleWithCaseConversions", "HardCodedCryptoKey", "InsecureCryptoIv"];

function write(file, content) {
  const target = path.join(fixtureRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: fixtureRoot, encoding: "utf8", windowsHide: true,
    timeout: 300000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    "隔离质量夹具失败：" + command + " " + args.join(" ") + "\n"
    + (result.error?.message || "") + "\n" + (result.stdout || "") + "\n" + (result.stderr || ""));
  return result.stdout || "";
}

try {
  const profile = fs.readFileSync(path.join(qualityRoot, "maven-snippets", "quality-audit-profile.xml"), "utf8")
    .match(/<profile>[\s\S]*<\/profile>/)?.[0];
  assert.ok(profile, "缺共享 audit profile；不得另造漂移的工具版本");
  write("pom.xml", '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>'
    + '<groupId>com.jhict.fixture</groupId><artifactId>codecc-quality-fixture</artifactId><version>1.0.0</version>'
    + '<properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target>'
    + '<project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><profiles>'
    + profile + '</profiles></project>\n');
  fs.cpSync(qualityRoot, path.join(fixtureRoot, ".github", "java-quality"), { recursive: true });
  write("src/main/java/sample/Positive.java", [
    "package sample;",
    "import java.util.Locale;",
    "import javax.crypto.spec.SecretKeySpec;",
    "import javax.crypto.spec.IvParameterSpec;",
    "public final class Positive {",
    "  public String normalize(String input) { return input.toUpperCase(Locale.ROOT); }",
    "  public SecretKeySpec key(byte[] supplied) { return new SecretKeySpec(supplied, \"AES\"); }",
    "  public IvParameterSpec vector(byte[] supplied) { return new IvParameterSpec(supplied); }",
    "}",
  ].join("\n"));
  write("src/main/java/sample/Negative.java", [
    "package sample;",
    "import java.nio.charset.StandardCharsets;",
    "import javax.crypto.spec.SecretKeySpec;",
    "import javax.crypto.spec.IvParameterSpec;",
    "public final class Negative {",
    "  public String normalize(String input) { return input.toUpperCase(); }",
    "  public SecretKeySpec key() {",
    "    return new SecretKeySpec(\"0123456789abcdef\".getBytes(StandardCharsets.UTF_8), \"AES\");",
    "  }",
    "  public IvParameterSpec vector() {",
    "    return new IvParameterSpec(\"0123456789abcdef\".getBytes(StandardCharsets.UTF_8));",
    "  }",
    "}",
  ].join("\n"));
  write("src/main/java/sample/MutableBoundary.java", [
    "package sample;",
    "import java.util.List;",
    "public final class MutableBoundary {",
    "  private final List<String> rows;",
    "  public MutableBoundary(List<String> input) { this.rows = input; }",
    "  public List<String> getRows() { return rows; }",
    "}",
  ].join("\n"));
  write("src/main/java/sample/OwnershipCheck.java", [
    "package sample;",
    "import java.util.ArrayList;",
    "import java.util.Arrays;",
    "import java.util.Collections;",
    "import java.util.List;",
    "import java.util.Locale;",
    "public final class OwnershipCheck {",
    "  public static void main(String[] args) {",
    "    Locale before = Locale.getDefault();",
    "    try {",
    "      Locale.setDefault(new Locale(\"tr\", \"TR\"));",
    "      if (\"STIR\".equals(\"stir\".toUpperCase())) { throw new AssertionError(\"locale counterexample missing\"); }",
    "      if (!\"STIR\".equals(new Positive().normalize(\"stir\"))) { throw new AssertionError(\"machine code drift\"); }",
    "    } finally { Locale.setDefault(before); }",
    "    List<String> fixed = Arrays.asList(\"original\");",
    "    fixed.set(0, \"changed\");",
    "    if (!\"changed\".equals(fixed.get(0))) { throw new AssertionError(\"Arrays.asList mutability missing\"); }",
    "    List<String> input = new ArrayList<>(Arrays.asList(\"original\"));",
    "    List<String> snapshot = Collections.unmodifiableList(new ArrayList<>(input));",
    "    input.set(0, \"changed\");",
    "    if (!\"original\".equals(snapshot.get(0))) { throw new AssertionError(\"snapshot shares list storage\"); }",
    "    try { snapshot.set(0, \"changed\"); throw new AssertionError(\"snapshot is mutable\"); }",
    "    catch (UnsupportedOperationException expected) { /* 明确只读集合契约。 */ }",
    "    System.out.println(\"locale and collection ownership behavior passed\");",
    "  }",
    "}",
  ].join("\n"));

  let command = process.env.WL_MAVEN_COMMAND || (process.platform === "win32" ? "mvn.cmd" : "mvn");
  const goals = ["-B", "-ntp", "-Dmaven.compiler.source=1.8", "-Dmaven.compiler.target=1.8",
    "-Dmaven.compiler.compilerVersion=1.8", "-Pwl-quality-audit", "compile", "pmd:pmd", "spotbugs:spotbugs"];
  let args = goals;
  if (process.platform === "win32") {
    if (!process.env.WL_MAVEN_COMMAND) {
      const located = spawnSync("where.exe", ["mvn.cmd"], { encoding: "utf8", windowsHide: true });
      assert.equal(located.status, 0, "未找到 Maven .cmd");
      command = located.stdout.split(/\r?\n/).find(Boolean);
    }
    assert.ok(path.isAbsolute(command) && /\.cmd$/i.test(command) && fs.existsSync(command), "Maven 须为有效 .cmd 绝对路径");
    const mavenHome = path.dirname(path.dirname(command));
    const bootJar = fs.readdirSync(path.join(mavenHome, "boot")).find((name) => /^plexus-classworlds-.*\.jar$/.test(name));
    assert.ok(bootJar, "缺 Maven boot JAR");
    args = ["-Dclassworlds.conf=" + path.join(mavenHome, "bin", "m2.conf"), "-Dmaven.home=" + mavenHome,
      "-Dmaven.multiModuleProjectDirectory=" + fixtureRoot, "-classpath", path.join(mavenHome, "boot", bootJar),
      "org.codehaus.plexus.classworlds.launcher.Launcher", ...goals];
    command = path.join(process.env.JAVA_HOME || "", "bin", "java.exe");
    assert.ok(fs.existsSync(command), "缺 JDK8 java.exe");
  }
  const log = run(command, args);
  assert.doesNotMatch(log, /Removed misconfigured rule|Could not find rule|RuleSetNotFoundException/i);
  const pmd = fs.readFileSync(path.join(fixtureRoot, "target", "pmd.xml"), "utf8");
  assert.doesNotMatch(pmd, /<(?:\w+:)?(?:error|configerror)\b/i, "不能把解析失败当零问题");
  const files = [...pmd.matchAll(/<file\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/file>/g)];
  const negative = files.find((match) => /[/\\]Negative\.java$/.test(match[1]));
  assert.ok(negative, "负例必须有分析结果");
  for (const rule of selectedRules) {
    assert.ok(negative[2].includes('rule="' + rule + '"'), "真实 PMD 未触发 " + rule);
  }
  const positive = files.find((match) => /[/\\]Positive\.java$/.test(match[1]));
  for (const rule of selectedRules) {
    assert.ok(!positive || !positive[2].includes('rule="' + rule + '"'), "正例误报 " + rule);
  }
  const spotbugs = fs.readFileSync(path.join(fixtureRoot, "target", "spotbugsXml.xml"), "utf8");
  assert.doesNotMatch(spotbugs, /<(?:\w+:)?(?:Error|MissingClass)\b/, "SpotBugs 分析必须完整");
  assert.match(spotbugs, /type=["']EI_EXPOSE_REP2["']/);
  assert.match(spotbugs, /type=["']EI_EXPOSE_REP["']/);
  const java = path.join(process.env.JAVA_HOME || "", "bin", process.platform === "win32" ? "java.exe" : "java");
  const behavior = run(java, ["-cp", "target/classes", "sample.OwnershipCheck"]);
  assert.match(behavior, /locale and collection ownership behavior passed/);
  if (evidenceRoot) {
    fs.mkdirSync(path.resolve(evidenceRoot), { recursive: true });
    fs.writeFileSync(path.join(evidenceRoot, "maven.log"), log);
    fs.writeFileSync(path.join(evidenceRoot, "behavior.log"), behavior);
    fs.copyFileSync(path.join(fixtureRoot, "target", "pmd.xml"), path.join(evidenceRoot, "pmd.xml"));
    fs.copyFileSync(path.join(fixtureRoot, "target", "spotbugsXml.xml"), path.join(evidenceRoot, "spotbugsXml.xml"));
    fs.cpSync(path.join(fixtureRoot, "src"), path.join(evidenceRoot, "source-snapshot"), { recursive: true });
    fs.writeFileSync(path.join(evidenceRoot, "source-root.json"), JSON.stringify({ root: fixtureRoot, kept: keepFixture }) + "\n");
    fs.writeFileSync(path.join(evidenceRoot, "result.json"), JSON.stringify({
      ok: true, scope: "isolated-fixture", java: 8, selectedRules,
      mutableInputAndOutputDetected: true, behaviorPassed: true,
      businessProjectExecuted: false,
    }, null, 2) + "\n");
  }
  console.log("✅ CodeCC 精选检测：PMD7 locale/密钥/IV 正反例、真实 SpotBugs 双向可变暴露、Java8 所有权行为通过");
} finally {
  if (!keepFixture) fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
