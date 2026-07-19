"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadCatalogConfig } = require("./project-catalog");

const HEADER_RE = /^([a-z][a-z0-9-]*)(?:\(([a-z][a-zA-Z0-9-]*)\))(!)?: (.+)$/u;

function validateCommitMessage(messageInput, config) {
  const message = String(messageInput || "").replace(/\r\n/g, "\n");
  const header = (message.split("\n")[0] || "").trimEnd();
  const errors = [];
  const match = HEADER_RE.exec(header);
  if (!match) {
    errors.push({ code: "COMMIT_FORMAT", message: "提交标题必须使用 type(scope): 功能点-具体内容；type/scope/冒号均使用半角字符" });
    return { ok: false, header, errors };
  }
  const [, type, scope, breaking, subject] = match;
  if (!config.commit.types.includes(type)) errors.push({ code: "COMMIT_TYPE", message: `type 不在允许列表：${type}` });
  if (!Object.prototype.hasOwnProperty.call(config.modules, scope)) errors.push({ code: "COMMIT_SCOPE", message: `scope 必须是已登记模块：${scope}` });
  if (header.length > config.commit.maxHeaderLength) errors.push({ code: "COMMIT_LENGTH", message: `标题长度 ${header.length} 超过上限 ${config.commit.maxHeaderLength}` });
  if (config.commit.requireDetailSeparator) {
    const separator = subject.indexOf("-");
    if (separator <= 0 || separator >= subject.length - 1 || !subject.slice(0, separator).trim() || !subject.slice(separator + 1).trim()) {
      errors.push({ code: "COMMIT_SUBJECT", message: "subject 必须包含非空的“功能点-具体内容”" });
    }
  } else if (!subject.trim()) errors.push({ code: "COMMIT_SUBJECT", message: "subject 不能为空" });
  return {
    ok: errors.length === 0,
    header,
    parsed: { type, scope, breaking: Boolean(breaking), subject },
    errors,
  };
}

function loadPolicy(projectRootInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const loaded = loadCatalogConfig(projectRoot, options.configRel);
  if (!loaded.ok) return { ok: false, projectRoot, reason: "catalog-config-invalid", errors: loaded.errors };
  return { ok: true, projectRoot, config: loaded.config, configHash: loaded.configHash };
}

function validateMessage(projectRootInput, message, options = {}) {
  const policy = loadPolicy(projectRootInput, options);
  if (!policy.ok) return policy;
  return { ...validateCommitMessage(message, policy.config), projectRoot: policy.projectRoot, configHash: policy.configHash };
}

function validateFile(projectRootInput, fileInput, options = {}) {
  const projectRoot = path.resolve(projectRootInput || process.cwd());
  const file = path.resolve(fileInput);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return { ok: false, projectRoot, reason: "message-file-missing", errors: [{ code: "COMMIT_FILE", message: `提交消息文件不存在：${fileInput}` }] };
  }
  return validateMessage(projectRoot, fs.readFileSync(file, "utf8"), options);
}

function git(projectRoot, args) {
  return childProcess.execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function validateRange(projectRootInput, range, options = {}) {
  const policy = loadPolicy(projectRootInput, options);
  if (!policy.ok) return policy;
  if (!range || !/^[A-Za-z0-9_./~^{}@:+-]+$/.test(range)) {
    return { ok: false, projectRoot: policy.projectRoot, reason: "invalid-range", errors: [{ code: "COMMIT_RANGE", message: "必须提供安全、明确的 Git range，例如 origin/main..HEAD" }] };
  }
  let output;
  try { output = git(policy.projectRoot, ["log", "--format=%H%x00%s", range]); }
  catch (cause) {
    return { ok: false, projectRoot: policy.projectRoot, reason: "git-log-failed", errors: [{ code: "COMMIT_GIT", message: cause.stderr ? String(cause.stderr).trim() : cause.message }] };
  }
  const commits = output ? output.split("\n").map((line) => {
    const separator = line.indexOf("\0");
    const sha = separator >= 0 ? line.slice(0, separator) : "";
    const header = separator >= 0 ? line.slice(separator + 1) : line;
    return { sha, ...validateCommitMessage(header, policy.config) };
  }) : [];
  return {
    ok: commits.every((commit) => commit.ok),
    projectRoot: policy.projectRoot,
    range,
    checked: commits.length,
    invalid: commits.filter((commit) => !commit.ok),
    commits,
  };
}

function doctor(projectRootInput, options = {}) {
  const policy = loadPolicy(projectRootInput, options);
  if (!policy.ok) return policy;
  let hooksPath = "";
  try { hooksPath = git(policy.projectRoot, ["config", "--get", "core.hooksPath"]); } catch { hooksPath = ""; }
  const expected = ".githooks";
  const hookFile = path.join(policy.projectRoot, expected, "commit-msg");
  const checks = [
    { id: "commit-policy", ok: true, detail: "catalog.config.json 已提供 type 与 module scope 白名单" },
    { id: "hook-file", ok: fs.existsSync(hookFile), detail: fs.existsSync(hookFile) ? ".githooks/commit-msg 已安装" : ".githooks/commit-msg 缺失" },
    { id: "hooks-path", ok: hooksPath.replace(/\\/g, "/") === expected, detail: hooksPath ? `core.hooksPath=${hooksPath}` : "core.hooksPath 未配置" },
  ];
  return {
    ok: checks.every((check) => check.ok),
    projectRoot: policy.projectRoot,
    checks,
    enforcement: {
      local: "开发反馈层，可绕过",
      ci: "权威阻断层；CI 必须执行 commit check --range <base>..HEAD",
    },
    installCommand: "git config core.hooksPath .githooks",
  };
}

module.exports = {
  HEADER_RE,
  doctor,
  loadPolicy,
  validateCommitMessage,
  validateFile,
  validateMessage,
  validateRange,
};
