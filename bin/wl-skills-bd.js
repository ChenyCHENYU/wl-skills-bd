#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * wl-skills-bd CLI（v0.0.2）
 *
 * 支持：init / help / version
 * 待实现：update / diff / clean / check / validate / doctor / export
 */

const fs   = require('fs');
const path = require('path');

const VERSION  = '0.0.2';
const PKG_ROOT = path.join(__dirname, '..');
const SRC_DIR  = path.join(PKG_ROOT, 'files');

// ─── helpers ──────────────────────────────────────────────────────────────────

function copyDir(src, dest, dryRun = false, log = []) {
  if (!dryRun) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
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

// ─── commands ─────────────────────────────────────────────────────────────────

function cmdInit(args) {
  const dryRun  = args.includes('--dry-run');
  const force   = args.includes('--force');
  const target  = process.cwd();

  console.log(`[wl-skills-bd] init → ${target}${dryRun ? ' (dry-run)' : ''}\n`);

  // Pre-check: warn if .github/ already exists and no --force
  const destGithub = path.join(target, '.github');
  if (fs.existsSync(destGithub) && !force && !dryRun) {
    console.warn('⚠️  .github/ 已存在。使用 --force 强制覆盖，或 --dry-run 预览变更。');
    process.exit(1);
  }

  const log = copyDir(SRC_DIR, target, dryRun);

  // Print summary
  let added = 0, overwritten = 0;
  for (const { destPath, exists } of log) {
    const tag = exists ? '~ 覆盖' : '+ 新增';
    if (exists) overwritten++; else added++;
    console.log(`  ${tag}  ${relPath(destPath)}`);
  }

  console.log(`\n${dryRun ? '[dry-run]' : '✅'} 完成：新增 ${added} 个文件，覆盖 ${overwritten} 个文件`);
  if (dryRun) {
    console.log('   去掉 --dry-run 参数后再次运行以实际写入。');
  } else {
    console.log('\n下一步：');
    console.log('  1. 将 .github/ 纳入项目 git 追踪（git add .github）');
    console.log('  2. 在 AI 编辑器中确认 copilot-instructions.md 已被读取');
    console.log('  3. 运行 wl-skills-bd check 检查接入完整性（待实现）');
  }
}

function help() {
  console.log(`@agile-team/wl-skills-bd v${VERSION}

USAGE
  wl-skills-bd <command> [options]

COMMANDS
  init [--dry-run] [--force]
        将 AI Skill / 规范 / 配置文件释放到当前后端工程根目录
        --dry-run  仅预览变更，不实际写入
        --force    .github/ 已存在时强制覆盖

  (planned) update    升级已安装文件
  (planned) diff      对比已安装版本与本包版本差异
  (planned) check     工具链 + standards/skills 接入完整性自检
  (planned) validate  静态校验 Controller/Service/Mapper 合规性
  (planned) doctor    包结构 + 审计字段 + 权限注解体检
  (planned) export    导出当前 standards / Skill 基线

EXAMPLES
  cd my-spring-boot-service
  npx @agile-team/wl-skills-bd init --dry-run   # 先预览
  npx @agile-team/wl-skills-bd init             # 实际安装
`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  help(); process.exit(0);
}
if (cmd === '-v' || cmd === '--version' || cmd === 'version') {
  console.log(VERSION); process.exit(0);
}
if (cmd === 'init') {
  cmdInit(args); process.exit(0);
}

console.error(`[wl-skills-bd] 未知命令 "${cmd}"，运行 wl-skills-bd --help 查看帮助。`);
process.exit(1);

