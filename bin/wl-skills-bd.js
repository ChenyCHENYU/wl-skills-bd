#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * wl-skills-bd CLI（v0.0.1 骨架占位）
 *
 * 计划支持：init / update / diff / clean / check / validate / doctor / export
 * 当前仅打印帮助。
 */

const VERSION = '0.0.1';

function help() {
  console.log(`@agile-team/wl-skills-bd v${VERSION} (skeleton)

USAGE
  wl-skills-bd <command>

COMMANDS (planned)
  init          在后端工程根目录释放 files/.github/* 到目标项目
  update        升级已安装文件（先生成 diff）
  diff          对比已安装文件与本包版本差异
  clean         清理本包安装的资产
  check         工具链 + standards/skills 接入完整性自检
  validate      静态校验后端 Controller/Service/Mapper 合规性
  doctor        体检：包结构、必备审计字段、权限注解、Mapper XML 模式
  export        导出当前项目 standards / Skill 基线（供 review）

REPO
  https://github.com/<placeholder>/wl-skills-bd
`);
}

const [, , cmd] = process.argv;
if (!cmd || cmd === '-h' || cmd === '--help') {
  help();
  process.exit(0);
}
if (cmd === '-v' || cmd === '--version') {
  console.log(VERSION);
  process.exit(0);
}

console.error(`[wl-skills-bd] command "${cmd}" is not implemented yet (skeleton stage).`);
console.error('See README.md / kit-internal/CONTRIBUTING.md for roadmap.');
process.exit(1);
