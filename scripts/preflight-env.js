#!/usr/bin/env node
"use strict";

/**
 * 在测试/发布入口尽早验证 Java 工具链，避免深层 fixture 才暴露“用错 JDK”问题。
 * 默认基线为 Java 8；项目若有更高版本需求，应由项目自身 profile/CI 显式覆盖，
 * 不通过放宽本包的 Java 8 回归基线来掩盖环境漂移。
 */

const path = require("path");
const { spawnSync } = require("child_process");

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function locate(command) {
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(resolver, [command], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? (result.stdout || "").split(/\r?\n/).find(Boolean) || command : command;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0,
    status: result.status,
    output,
    firstLine: output.split(/\r?\n/).find(Boolean) || (result.error && result.error.message) || "不可用",
  };
}

function majorFromJava(output) {
  const text = String(output || "");
  const match = text.match(/version\s+"(?:1\.)?(\d+)/i)
    || text.match(/\bjavac\s+(?:1\.)?(\d+)/i)
    || text.match(/\bjava\s+(?:1\.)?(\d+)/i)
    || text.match(/^(?:1\.)?(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseMavenJava(output) {
  const version = output.match(/Java version:\s*([\w.+-]+)/i);
  const home = output.match(/Java home:\s*(.+)/i) || output.match(/runtime:\s*([^\s,]+)/i);
  return {
    version: version ? version[1] : null,
    major: version ? majorFromJava(version[1]) : null,
    home: home ? home[1].trim() : null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const requiredJava = Number(option(args, "--required-java", "8"));
  const checkMaven = args.includes("--check-maven");
  if (!Number.isInteger(requiredJava) || requiredJava < 1) {
    console.error("--required-java 必须是正整数主版本号");
    process.exitCode = 2;
    return;
  }

  const javaHome = process.env.JAVA_HOME || null;
  const javaCommand = javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java") : locate("java");
  const javacCommand = javaHome ? path.join(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac") : locate("javac");
  const java = run(javaCommand, ["-version"]);
  const javac = run(javacCommand, ["-version"]);
  const javaMajor = majorFromJava(java.output);
  const javacMajor = majorFromJava(javac.output);
  const checks = [
    {
      id: "java",
      ok: java.ok && javaMajor === requiredJava,
      executable: javaCommand,
      major: javaMajor,
      detail: java.firstLine,
    },
    {
      id: "javac",
      ok: javac.ok && javacMajor === requiredJava,
      executable: javacCommand,
      major: javacMajor,
      detail: javac.firstLine,
    },
  ];

  if (checkMaven) {
    const mvnCommand = process.platform === "win32" ? "mvn.cmd" : "mvn";
    const maven = run(mvnCommand, ["-version"]);
    const mavenJava = parseMavenJava(maven.output);
    checks.push({
      id: "maven-java",
      ok: maven.ok && mavenJava.major === requiredJava,
      executable: locate(mvnCommand),
      major: mavenJava.major,
      javaHome: mavenJava.home,
      detail: maven.firstLine,
    });
  }

  const result = {
    ok: checks.every((check) => check.ok),
    requiredJava,
    javaHome,
    checks,
  };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Java 环境预检：要求 Java ${requiredJava}${javaHome ? `；JAVA_HOME=${javaHome}` : ""}`);
    for (const check of checks) {
      const extra = check.javaHome ? `；Maven Java home=${check.javaHome}` : "";
      console.log(`${check.ok ? "✅" : "❌"} ${check.id}: ${check.detail}；可执行文件=${check.executable}${extra}`);
    }
    if (!result.ok) {
      console.error("环境不满足 Java 基线：请设置 JAVA_HOME 到匹配的 JDK，并确保 java/javac/Maven 使用同一主版本。");
    }
  }
  if (!result.ok) process.exitCode = 1;
}

main();

module.exports = { majorFromJava, parseMavenJava };
