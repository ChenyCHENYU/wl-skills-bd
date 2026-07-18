"use strict";

const fs = require("fs");
const path = require("path");
const { resolveWithin } = require("../lib/manifest");

function projectRoot() {
  const root = path.resolve(process.env.WL_PROJECT_ROOT || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`项目根目录不存在：${root}`);
  return root;
}

function readableProjectFile(root, rel, label = "文件") {
  const file = resolveWithin(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label}不存在：${rel}`);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) throw new Error(`${label}通过符号链接越界：${rel}`);
  return file;
}

module.exports = { projectRoot, readableProjectFile };
