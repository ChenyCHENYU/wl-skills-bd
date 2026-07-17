#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * wl-skills-bd CLI（v0.3.0）
 *
 * 命令：
 *   init      全量安装（释放 .github 到后端工程）
 *   validate  ★确定性规范校验（接 lib/be-rules.js，B1~B8 规则）
 *   doctor    工具链 + java-quality 接入体检
 *   help      帮助
 *   version   版本
 *
 * 待实现：update / diff / clean / export
 */

const fs = require("fs");
const path = require("path");

const VERSION = "0.3.0";
const PKG_ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(PKG_ROOT, "files");

// ─── helpers ──────────────────────────────────────────────────────────────────

function copyDir(src, dest, dryRun = false, log = []) {
  if (!dryRun) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, dryRun, log);
    } else {
      const exists = fs.existsSync(destPath);
      log.push({ destPath, exists });
      if (!dryRun) fs.copyFileSync(srcPath, destPath);
    }
  }
  return log;
}

function relPath(p) {
  return path.relative(process.cwd(), p);
}

// ─── init ─────────────────────────────────────────────────────────────────────

function cmdInit(args) {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const target = process.cwd();

  console.log(`[wl-skills-bd] init → ${target}${dryRun ? " (dry-run)" : ""}\n`);

  const destGithub = path.join(target, ".github");
  if (fs.existsSync(destGithub) && !force && !dryRun) {
    console.warn("⚠️  .github/ 已存在。使用 --force 强制覆盖，或 --dry-run 预览变更。");
    process.exit(1);
  }

  const log = copyDir(SRC_DIR, target, dryRun);

  let added = 0, overwritten = 0;
  for (const { destPath, exists } of log) {
    const tag = exists ? "~ 覆盖" : "+ 新增";
    if (exists) overwritten++; else added++;
    console.log(`  ${tag}  ${relPath(destPath)}`);
  }

  console.log(`\n${dryRun ? "[dry-run]" : "✅"} 完成：新增 ${added} 个文件，覆盖 ${overwritten} 个文件`);
  if (dryRun) {
    console.log("   去掉 --dry-run 参数后再次运行以实际写入。");
  } else {
    console.log("\n下一步：");
    console.log("  1. git add .github（纳入版本控制）");
    console.log("  2. 接入 java-quality/ 的 Maven 插件（见 .github/java-quality/maven-snippets/README.md）");
    console.log("  3. 运行 wl-skills-bd validate 检查现有代码");
    console.log("  4. 运行 wl-skills-bd doctor 体检工具链接入");
  }
}

// ─── validate ★（接 be-rules）──────────────────────────────────────────────

function cmdValidate(args) {
  const target = process.cwd();
  const scanRel = args.find((a) => !a.startsWith("-"));
  // 支持绝对路径或相对路径
  const root = scanRel ? (path.isAbsolute(scanRel) ? scanRel : path.join(target, scanRel)) : target;

  console.log(`[wl-skills-bd] validate → ${root}\n`);

  let runBeRules;
  try {
    ({ runBeRules } = require("../lib/be-rules"));
  } catch (e) {
    console.error("❌ 无法加载 lib/be-rules.js（npm 包损坏？）：" + e.message);
    process.exit(2);
  }

  if (!fs.existsSync(root)) {
    console.error(`❌ 扫描路径不存在：${root}`);
    process.exit(2);
  }

  // be-rules 的 targetDir 用于相对路径计算；scanRel 用于限制范围
  // 若是绝对路径，转成相对 target 的形式传给 be-rules（它内部用 targetDir 拼）
  const relScan = path.isAbsolute(scanRel || "") ? path.relative(target, scanRel) || undefined : scanRel;
  const { issues, stats } = runBeRules(target, { scanRel: relScan });

  if (issues.length === 0) {
    console.log("✅ 未发现确定性违规（B1~B8 全过）");
    console.log("   注：本工具覆盖框架级注解/SQL/目录密度；命名/架构分层请配合 Checkstyle + ArchUnit。");
    return;
  }

  // 按规则分组输出
  const byRule = {};
  for (const i of issues) {
    if (!byRule[i.rule]) byRule[i.rule] = [];
    byRule[i.rule].push(i);
  }

  console.log("规则编号说明：");
  console.log("  B1 Controller缺@PreAuthorize  B2 缺@ApiOperation  B3 SELECT*  B4 ${}注入");
  console.log("  B5 缺@Transactional  B6 目录文件>20  B7 缺COMPANY_ID  B8 裸RuntimeException\n");

  for (const rule of Object.keys(byRule).sort()) {
    const list = byRule[rule];
    const sev = list[0].severity;
    const icon = sev === "error" ? "🔴" : "🟡";
    console.log(`${icon} ${rule} (${list.length} 项)  [${sev}] standards/${list[0].standard}`);
    for (const i of list.slice(0, 20)) {
      const loc = i.line ? `:${i.line}` : "";
      console.log(`   ${i.file}${loc}  ${i.message}`);
    }
    if (list.length > 20) console.log(`   ... 还有 ${list.length - 20} 项`);
    console.log("");
  }

  console.log("─".repeat(50));
  console.log(`汇总：🔴 error ${stats.error} | 🟡 warn ${stats.warn} | 共 ${stats.total} 项`);

  // 有 error 则非0退出（CI 可阻断）
  if (stats.error > 0) {
    console.log("\n⛔ 存在 error 级违规，CI 应阻断。修复方式见 .github/skills/ops/code-fix-be/SKILL.md");
    process.exit(1);
  } else {
    console.log("\n⚠️  仅有 warn 级提示，CI 不阻断。建议逐步治理。");
  }
}

// ─── doctor（工具链 + java-quality 接入体检）──────────────────────────────

function cmdDoctor() {
  const target = process.cwd();
  console.log(`[wl-skills-bd] doctor → ${target}\n`);

  const checks = [];

  // 1. 是否 init 过（.github/standards 存在）
  const hasGithub = fs.existsSync(path.join(target, ".github", "standards"));
  checks.push({ item: "wl-skills-bd 已 init（.github/standards）", ok: hasGithub, hint: "运行 wl-skills-bd init" });

  // 2. 是否 Maven 工程
  const hasPom = fs.existsSync(path.join(target, "pom.xml"));
  checks.push({ item: "Maven 工程（pom.xml）", ok: hasPom, hint: "bd 面向 Maven 后端工程" });

  // 3. java-quality 接入检测
  const jqDir = path.join(target, ".github", "java-quality");
  const archunitReadme = path.join(jqDir, "archunit", "README.md");
  const checkstyleXml = path.join(jqDir, "checkstyle", "checkstyle.xml");
  checks.push({ item: "ArchUnit 规则已就位（J1 架构分层）", ok: fs.existsSync(archunitReadme), hint: "复制 .github/java-quality/archunit/" });
  checks.push({ item: "Checkstyle 规则已就位（J2 命名风格）", ok: fs.existsSync(checkstyleXml), hint: "复制 .github/java-quality/checkstyle/" });

  // 4. ArchUnit 测试是否已拷到 src/test
  let archunitTest = false;
  if (hasPom) {
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return false;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (walk(path.join(dir, e.name))) return true; }
        else if (/LayerRulesTest\.java$/.test(e.name)) return true;
      }
      return false;
    };
    archunitTest = walk(path.join(target, "src", "test"));
  }
  checks.push({ item: "ArchUnit 测试已接入 src/test（J1 生效）", ok: archunitTest, hint: "拷 LayerRulesTest.java 到 src/test/java/.../arch/" });

  // 5. pom 是否含 checkstyle/archunit 插件配置（粗判）
  let pomHasCheckstyle = false, pomHasArchunit = false;
  if (hasPom) {
    const pom = fs.readFileSync(path.join(target, "pom.xml"), "utf8");
    pomHasCheckstyle = /maven-checkstyle-plugin|checkstyle/.test(pom);
    pomHasArchunit = /archunit/.test(pom);
  }
  checks.push({ item: "pom.xml 已配 Checkstyle 插件", ok: pomHasCheckstyle, hint: "见 java-quality/maven-snippets/pom-plugins.xml" });
  checks.push({ item: "pom.xml 已加 ArchUnit 依赖", ok: pomHasArchunit, hint: "见 java-quality/maven-snippets/pom-plugins.xml" });

  // 输出
  let pass = 0;
  for (const c of checks) {
    const icon = c.ok ? "✅" : "❌";
    console.log(`${icon} ${c.item}`);
    if (!c.ok) console.log(`   → ${c.hint}`);
    if (c.ok) pass++;
  }

  console.log("\n" + "─".repeat(50));
  console.log(`体检结果：${pass}/${checks.length} 项就绪`);
  if (pass === checks.length) {
    console.log("🎉 全部就绪。建议跑：mvn clean verify（Checkstyle + ArchUnit + 测试全过）");
  }
}

// ─── help ─────────────────────────────────────────────────────────────────────

function help() {
  console.log(`@agile-team/wl-skills-bd v${VERSION}

USAGE
  wl-skills-bd <command> [options]

COMMANDS
  init [--dry-run] [--force]
        将 AI Skill / 规范 / Java 工具规则集释放到后端工程根目录

  validate [path] [--quick]
        ★ 确定性规范校验（接 lib/be-rules.js，B1~B8）
        - 检查 Controller 缺 @PreAuthorize/@ApiOperation、XML SELECT 星号、
          美元花括号注入、缺 @Transactional、目录文件>20、缺 COMPANY_ID、裸 RuntimeException
        - 有 error 级违规返回非0（CI 可阻断）
        - [path] 指定扫描子目录，默认当前目录

  doctor
        工具链 + java-quality 接入体检（init/插件/ArchUnit 测试是否就位）

  help / --help
        显示本帮助

  version / --version
        显示版本号

EXAMPLES
  cd my-spring-boot-service
  npx @agile-team/wl-skills-bd init --dry-run        # 先预览安装
  npx @agile-team/wl-skills-bd init                  # 实际安装
  npx @agile-team/wl-skills-bd validate              # 校验现有代码
  npx @agile-team/wl-skills-bd validate src/main     # 仅校验主代码
  npx @agile-team/wl-skills-bd doctor                # 体检工具链接入
`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  help(); process.exit(0);
}
if (cmd === "-v" || cmd === "--version" || cmd === "version") {
  console.log(VERSION); process.exit(0);
}
if (cmd === "init") { cmdInit(args); process.exit(0); }
if (cmd === "validate") { cmdValidate(args); process.exit(0); }
if (cmd === "doctor") { cmdDoctor(); process.exit(0); }

console.error(`[wl-skills-bd] 未知命令 "${cmd}"，运行 wl-skills-bd --help 查看帮助。`);
process.exit(1);
