"use strict";

const fs = require("fs");
const path = require("path");

const YAML_CANDIDATES = [".yml", ".yaml", ".properties"];
const ENVS = ["dev", "sit", "uat", "pre", "prod"];

// 敏感字段名模式（大小写不敏感）
const SENSITIVE_KEY_REGEX = /(password|passwd|pwd|secret|token|apikey|api_key|accesskey|access_key|privatekey|private_key|credential|authorization)(\b|_|$)/i;

// 占位符模式：${VAR} 或 ${VAR:default}
const PLACEHOLDER_REGEX = /\$\{[A-Z_][A-Z0-9_]*(?::[^}]*)?\}/;

// 看似明文密码的值（非占位符、非空、非明显占位标记）
const PLAINTEXT_PASSWORD_HINTS = /^(?!.*\$\{)[^\s*]+$/;
const SAFE_PLACEHOLDER_MARKERS = /^\*{3}|CHANGE_ME|<.+>|\$\{/i;

function extractProfileDefault(value) {
  if (!value) return null;
  const m = value.match(/\$\{[^}:]+(?::([^}]*))?\}/);
  if (m) return m[1] || null;
  return value;
}

function isYamlOrProps(file) {
  return YAML_CANDIDATES.some((ext) => file.toLowerCase().endsWith(ext));
}

function listConfigFiles(root) {
  const result = [];
  const seen = new Set();
  const searchDirs = [
    path.join(root, "src", "main", "resources"),
    root,
  ];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    walk(dir, dir, result);
  }
  return result;

  function walk(base, current, acc) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (["target", "node_modules", ".git", ".idea", ".wl-skills-bd", "deploy", "docs", "logs", "applogs"].includes(entry.name)) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(base, abs, acc);
      else if (entry.isFile() && isYamlOrProps(entry.name)) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        if (seen.has(rel)) continue;
        seen.add(rel);
        acc.push({ rel, abs, name: entry.name });
      }
    }
  }
}

function parseYamlKeyValue(content) {
  // 简易 YAML/properties key: value 解析（不依赖外部 yaml 库，保持零依赖）
  const lines = content.split(/\r?\n/);
  const result = [];
  let currentPath = [];
  const stack = [{ indent: -1, keys: [] }];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNoComment = stripInlineComment(raw);
    if (!lineNoComment.trim()) continue;
    if (/^[\s-]*#/.test(raw)) continue;
    const indent = raw.length - raw.replace(/^\s+/, "").length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const trimmed = lineNoComment.trim();
    const kvMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();
      // 处理引号
      if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
      const pathKeys = [...stack[stack.length - 1].keys, key];
      if (value === "" || value === "|" || value === ">") {
        stack.push({ indent, keys: pathKeys });
      } else {
        result.push({ line: i + 1, path: pathKeys.join("."), key, value, indent });
      }
    } else if (/^-\s+/.test(trimmed)) {
      const item = trimmed.replace(/^-\s+/, "");
      const kv = item.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (kv) {
        const pathKeys = [...stack[stack.length - 1].keys, kv[1]];
        let value = kv[2].trim();
        if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
        result.push({ line: i + 1, path: pathKeys.join("."), key: kv[1], value, indent });
      }
    }
  }
  return result;
}

function stripInlineComment(line) {
  // 移除行内注释（但保留 URL 中的 #）
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if ((c === '"' || c === "'") && !inQuote) { inQuote = true; quoteChar = c; }
    else if (c === quoteChar && inQuote) { inQuote = false; quoteChar = ""; }
    else if (c === "#" && !inQuote) return line.slice(0, i);
  }
  return line;
}

function isSensitiveKey(keyPath) {
  return SENSITIVE_KEY_REGEX.test(keyPath);
}

function isPlaceholder(value) {
  return PLACEHOLDER_REGEX.test(value);
}

function isSafeMarker(value) {
  return SAFE_PLACEHOLDER_MARKERS.test(value);
}

function isPlaintextSecret(value) {
  if (!value || typeof value !== "string") return false;
  if (isPlaceholder(value)) return false;
  if (isSafeMarker(value)) return false;
  return PLAINTEXT_PASSWORD_HINTS.test(value);
}

function scanPlaintextSecrets(files) {
  const issues = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    const kvs = parseYamlKeyValue(content);
    for (const kv of kvs) {
      if (!isSensitiveKey(kv.path)) continue;
      if (isPlaintextSecret(kv.value)) {
        issues.push({
          rule: "config-secret",
          severity: "error",
          file: file.rel,
          line: kv.line,
          key: kv.path,
          value: kv.value,
          message: `敏感字段 ${kv.path} 疑似明文（非占位符）：改为 \${VAR} 占位符或 ***CHANGE_ME***（standards/25 §1.2 L0）`,
        });
      }
    }
  }
  return issues;
}

function scanPlaceholderCompliance(files) {
  const issues = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    const kvs = parseYamlKeyValue(content);
    for (const kv of kvs) {
      if (!isSensitiveKey(kv.path)) continue;
      // 敏感字段必须是占位符或安全标记
      if (!isPlaceholder(kv.value) && !isSafeMarker(kv.value) && kv.value !== "") {
        // 已被 scanPlaintextSecrets 覆盖，这里只做 warn 级别补充
      }
    }
  }
  return issues;
}

function detectBootstrapLayer(root) {
  const candidates = [
    path.join(root, "src", "main", "resources", "bootstrap.yml"),
    path.join(root, "src", "main", "resources", "bootstrap.yaml"),
  ];
  for (const file of listConfigFiles(root)) {
    if (/^bootstrap\.ya?ml$/i.test(file.name) && !candidates.includes(file.abs)) candidates.push(file.abs);
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const kvs = parseYamlKeyValue(content);
      const findByPath = (p) => kvs.find((kv) => kv.path.endsWith(p));
      const profile = findByPath("profiles.active") || findByPath("active");
      const nacosAddr = findByPath("nacos.config.server-addr") || findByPath("config.server-addr");
      const namespace = findByPath("nacos.config.namespace") || findByPath("config.namespace");
      const group = findByPath("nacos.config.group") || findByPath("config.group");
      const sharedConfigs = content.includes("shared-configs");
      return {
        layer: "L1",
        file: path.relative(root, file).replace(/\\/g, "/"),
        profile: profile ? extractProfileDefault(profile.value) : null,
        profileRaw: profile ? profile.value : null,
        nacosAddr: nacosAddr ? nacosAddr.value : null,
        namespace: namespace ? namespace.value : null,
        group: group ? group.value : null,
        sharedConfigs,
        compliant: Boolean(profile && nacosAddr && namespace && group),
      };
    } catch { /* ignore */ }
  }
  return null;
}

function detectEnvMatrix(root) {
  const candidates = [
    path.join(root, ".wl-skills-bd", "env-matrix.yml"),
    path.join(root, ".wl-skills-bd", "env-matrix.yaml"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return { file: path.relative(root, file).replace(/\\/g, "/"), abs: file };
  }
  return null;
}

function detectK8sManifests(root) {
  const result = [];
  const searchDirs = [path.join(root, "deploy"), root];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(ya?ml)$/.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      try {
        const content = fs.readFileSync(abs, "utf8");
        if (/kind:\s*(ConfigMap|Deployment|Secret|Service)/i.test(content)) {
          result.push({ rel: path.relative(root, abs).replace(/\\/g, "/"), abs, name: entry.name, content });
        }
      } catch { /* ignore */ }
    }
  }
  return result;
}

function extractK8sConfigMapFields(manifest) {
  const fields = {};
  const dataMatch = manifest.content.match(/kind:\s*ConfigMap[\s\S]*?data:\s*\n([\s\S]*?)(?:\n---|\n[a-z]|\Z)/i);
  if (!dataMatch) return fields;
  const dataBlock = dataMatch[1];
  const re = /^\s*([A-Z_][A-Z0-9_]+)\s*:\s*"?([^"\n]*)"?\s*$/gm;
  let m;
  while ((m = re.exec(dataBlock)) !== null) {
    fields[m[1]] = m[2].trim();
  }
  return fields;
}

function detectPort(root) {
  const candidates = [
    path.join(root, "src", "main", "resources", "application.yml"),
    path.join(root, "src", "main", "resources", "application.yaml"),
  ];
  for (const file of listConfigFiles(root)) {
    if (/^application\.ya?ml$/i.test(file.name) && !candidates.includes(file.abs)) candidates.push(file.abs);
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const kvs = parseYamlKeyValue(content);
      const port = kvs.find((kv) => kv.path.endsWith("server.port"));
      if (port) {
        const m = port.value.match(/^\$\{[^}:]+:(\d+)\}$/) || port.value.match(/^(\d+)$/);
        if (m) return { port: Number(m[1]), file: path.relative(root, file).replace(/\\/g, "/"), raw: port.value };
      }
    } catch { /* ignore */ }
  }
  // K8s containerPort
  const manifests = detectK8sManifests(root);
  for (const m of manifests) {
    const portMatch = m.content.match(/containerPort:\s*(\d+)/);
    if (portMatch) return { port: Number(portMatch[1]), file: m.rel, raw: portMatch[1] };
  }
  return null;
}

const PORT_RANGES = {
  sale: [10000, 10099], quality: [10100, 10199], produce: [10200, 10299],
  cost: [10300, 10339], safe: [10400, 10499], equipment: [10500, 10599],
  env: [10600, 10699], logistics: [10700, 10799], energy: [10800, 10899],
  mdm: [9100, 9199],
};

function checkPortRange(module, port, expectedPort) {
  if (Number.isInteger(expectedPort)) {
    if (port === expectedPort) {
      return { ok: true, detail: `${module} 端口 ${port} 与 env-matrix 冻结值一致` };
    }
    return { ok: false, detail: `${module} 端口 ${port} 与 env-matrix 冻结值 ${expectedPort} 不一致` };
  }
  const range = PORT_RANGES[module];
  if (!range) return { ok: true, detail: `模块 ${module} 未在端口范围表，跳过校验` };
  if (port >= range[0] && port <= range[1]) return { ok: true, detail: `${module} 端口 ${port} 在范围 ${range[0]}-${range[1]}` };
  return { ok: false, detail: `${module} 端口 ${port} 不在范围 ${range[0]}-${range[1]}` };
}

module.exports = {
  ENVS,
  PORT_RANGES,
  SENSITIVE_KEY_REGEX,
  checkPortRange,
  detectBootstrapLayer,
  detectEnvMatrix,
  detectK8sManifests,
  detectPort,
  extractK8sConfigMapFields,
  isPlaceholder,
  isPlaintextSecret,
  isSafeMarker,
  isSensitiveKey,
  isYamlOrProps,
  listConfigFiles,
  parseYamlKeyValue,
  scanPlaintextSecrets,
  stripInlineComment,
};
