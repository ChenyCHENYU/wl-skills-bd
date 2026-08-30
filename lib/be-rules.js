"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const catalog = require("../files/.wl-skills-bd/rules/catalog.json");
const compatibility = require("../files/.wl-skills-bd/compatibility.json");
const { normalizeRel, resolveWithin } = require("./manifest");
const { createRuleExecutionPlan } = require("./be-rule-plan");
const { createScanContext } = require("./scan-context");
const sourceIndex = require("./source-index");

const RULES = new Map(catalog.rules.filter((rule) => /^B\d+$/.test(rule.id)).map((rule) => [rule.id, rule]));
const DEFAULT_THRESHOLDS = Object.freeze({
  classLines: 500,
  methodLines: 80,
  cyclomaticComplexity: 10,
  directoryWarn: 20,
  directoryError: 30,
});
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function lineOffsets(content) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) if (content[index] === "\n") offsets.push(index + 1);
  return offsets;
}

function lineAt(offsets, index) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= index) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, col: index - offsets[lineIndex] + 1 };
}

function fingerprint(issue) {
  return crypto.createHash("sha256")
    .update([issue.rule, issue.file, issue.line, issue.message].join("\u0000"))
    .digest("hex");
}

function issue(rule, file, line, col, message, overrides = {}) {
  const definition = RULES.get(rule);
  const value = {
    rule,
    severity: definition ? definition.severity : "error",
    file,
    line,
    col,
    endLine: line,
    message,
    standard: definition ? definition.source.join("/") : "tooling",
    ...overrides,
  };
  value.fingerprint = fingerprint(value);
  return value;
}

function globRegex(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function loadExemptions(targetDir) {
  const file = path.join(targetDir, ".be-rules-ignore");
  const entries = [];
  const diagnostics = [];
  if (!fs.existsSync(file)) return { entries, diagnostics, isExempt: () => false };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^((?:B[1-9]\d*)|\*):([^#]+?)\s+#\s+(.{5,})$/);
    if (!match) {
      diagnostics.push(issue("WLS_CONFIG", ".be-rules-ignore", index + 1, 1, "豁免格式必须为 RULE:glob # 至少5字符的原因"));
      return;
    }
    const relGlob = normalizeRel(match[2].trim());
    if (!relGlob || relGlob.startsWith("../") || path.isAbsolute(relGlob)) {
      diagnostics.push(issue("WLS_CONFIG", ".be-rules-ignore", index + 1, 1, "豁免路径必须是项目内相对 glob"));
      return;
    }
    entries.push({ rule: match[1], glob: relGlob, reason: match[3].trim(), regex: globRegex(relGlob), line: index + 1 });
  });
  return {
    entries,
    diagnostics,
    isExempt: (relFile, rule) => entries.find((entry) => (entry.rule === "*" || entry.rule === rule) && entry.regex.test(relFile)),
  };
}

function loadConfig(targetDir) {
  const rel = ".wl-skills-bd/rules.local.json";
  const file = path.join(targetDir, rel);
  const diagnostics = [];
  const result = { thresholds: { ...DEFAULT_THRESHOLDS }, tenant: { mode: "explicit" }, softDelete: { activeValue: 1, deletedValue: 0 } };
  if (!fs.existsSync(file)) return { ...result, diagnostics };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, `JSON 无法解析：${error.message}`));
    return { ...result, diagnostics };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "规则配置根节点必须是对象"));
    return { ...result, diagnostics };
  }
  const allowed = new Set(["schemaVersion", "thresholds", "tenant", "softDelete"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, `不支持配置项 ${key}`));
  if (raw.schemaVersion !== 1) diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "只支持 schemaVersion=1"));
  if (raw.thresholds && typeof raw.thresholds === "object" && !Array.isArray(raw.thresholds)) {
    for (const [key, value] of Object.entries(raw.thresholds)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_THRESHOLDS, key)) {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, `未知阈值 ${key}`));
      } else if (!Number.isInteger(value) || value < 1 || value > DEFAULT_THRESHOLDS[key]) {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, `${key} 只能使用不高于团队基线 ${DEFAULT_THRESHOLDS[key]} 的正整数`));
      } else result.thresholds[key] = value;
    }
  }
  if (raw.tenant !== undefined) {
    if (!raw.tenant || !["explicit", "interceptor"].includes(raw.tenant.mode)) {
      diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "tenant.mode 只允许 explicit/interceptor"));
    } else if (raw.tenant.mode === "interceptor") {
      if (typeof raw.tenant.evidence !== "string") {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "interceptor 模式必须提供 evidence 相对文件"));
      } else {
        try {
          const evidence = resolveWithin(targetDir, raw.tenant.evidence);
          const verified = fs.existsSync(evidence) && /TenantLineInnerInterceptor/.test(fs.readFileSync(evidence, "utf8"));
          if (!verified) diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "tenant evidence 不存在或未包含 TenantLineInnerInterceptor"));
          else result.tenant = { mode: "interceptor", evidence: normalizeRel(raw.tenant.evidence) };
        } catch (error) {
          diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, error.message));
        }
      }
    }
  }
  if (raw.softDelete !== undefined) {
    const sd = raw.softDelete;
    if (!sd || typeof sd !== "object") {
      diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "softDelete 必须是对象"));
    } else {
      const hasActive = Object.prototype.hasOwnProperty.call(sd, "activeValue");
      const hasDeleted = Object.prototype.hasOwnProperty.call(sd, "deletedValue");
      if (!hasActive || !hasDeleted) {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "softDelete 必须同时提供 activeValue 和 deletedValue"));
      } else if (!Number.isInteger(sd.activeValue) || !Number.isInteger(sd.deletedValue)) {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "softDelete.activeValue/deletedValue 必须是整数"));
      } else if (sd.activeValue === sd.deletedValue) {
        diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "softDelete.activeValue 不能等于 deletedValue"));
      } else {
        result.softDelete = { activeValue: sd.activeValue, deletedValue: sd.deletedValue };
      }
    }
  }
  if (result.thresholds.directoryError <= result.thresholds.directoryWarn) {
    diagnostics.push(issue("WLS_CONFIG", rel, 1, 1, "directoryError 必须大于 directoryWarn"));
  }
  return { ...result, diagnostics };
}

function stripJava(content) {
  let output = "";
  let state = "code";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (state === "code" && char === "/" && next === "/") { output += "  "; index += 1; state = "line"; continue; }
    if (state === "code" && char === "/" && next === "*") { output += "  "; index += 1; state = "block"; continue; }
    if (state === "code" && char === '"') { output += " "; state = "string"; continue; }
    if (state === "code" && char === "'") { output += " "; state = "char"; continue; }
    if (state === "line") {
      if (char === "\n") { output += "\n"; state = "code"; } else output += " ";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") { output += "  "; index += 1; state = "code"; }
      else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "string" || state === "char") {
      const quote = state === "string" ? '"' : "'";
      if (char === "\\") { output += " "; if (next !== undefined) { output += next === "\n" ? "\n" : " "; index += 1; } }
      else if (char === quote) { output += " "; state = "code"; }
      else output += char === "\n" ? "\n" : " ";
      continue;
    }
    output += char;
  }
  return output;
}

function stripXmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, " "));
}

function methodDeclarations(content) {
  const scrubbed = stripJava(content);
  const lines = scrubbed.split(/\r?\n/);
  const offsets = lineOffsets(scrubbed);
  const methods = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (!/^\s*(public|protected|private)\s+/.test(lines[start])) continue;
    let signature = lines[start];
    let end = start;
    while (!/[{;]/.test(signature) && end < Math.min(lines.length - 1, start + 9)) {
      end += 1;
      signature += ` ${lines[end].trim()}`;
    }
    const match = signature.match(/^\s*(public|protected|private)\s+(?:(?:static|final|synchronized|abstract|default|native)\s+)*(.+?)\s+(\w+)\s*\(([^{};]*)\)\s*(?:throws\s+[^{}]+)?\s*([\{;])/);
    if (!match || ["if", "for", "while", "switch", "catch"].includes(match[3])) continue;
    const method = { visibility: match[1], returnType: match[2].trim(), name: match[3], startLine: start + 1, signatureEndLine: end + 1, endLine: end + 1, body: "" };
    if (match[5] === "{") {
      const braceIndexInLine = lines.slice(start, end + 1).join("\n").indexOf("{");
      const braceIndex = offsets[start] + braceIndexInLine;
      let depth = 0;
      let closeIndex = braceIndex;
      for (let index = braceIndex; index < scrubbed.length; index += 1) {
        if (scrubbed[index] === "{") depth += 1;
        else if (scrubbed[index] === "}") {
          depth -= 1;
          if (depth === 0) { closeIndex = index; break; }
        }
      }
      method.endLine = lineAt(offsets, closeIndex).line;
      method.body = scrubbed.slice(braceIndex + 1, closeIndex);
    }
    methods.push(method);
    start = end;
  }
  return methods;
}

function annotationBlock(lines, methodStartLine) {
  const collected = [];
  for (let index = methodStartLine - 2; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) break;
    if (/^[}\w].*;?$/.test(trimmed) && !trimmed.startsWith("@")) break;
    collected.unshift(lines[index]);
  }
  return collected.join("\n");
}

function mappingPaths(argumentsText) {
  if (argumentsText === undefined) return [""];
  const assigned = /(?:value|path)\s*=\s*(\{[\s\S]*?\}|"[^"]*")/.exec(argumentsText);
  const trimmed = String(argumentsText).trim();
  const positional = trimmed.startsWith("{")
    ? /^\{[\s\S]*?\}/.exec(trimmed)?.[0]
    : /^"[^"]*"/.exec(trimmed)?.[0];
  const source = assigned?.[1] || positional;
  if (!source) return [""];
  const paths = [...source.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  return paths.length > 0 ? paths : [""];
}

function classMappingPaths(annotations) {
  const match = /@RequestMapping\b(?:\s*\(([\s\S]*?)\))?/.exec(annotations);
  return match ? mappingPaths(match[1]) : [""];
}

function methodMappingDescriptors(annotations) {
  const result = [];
  const direct = /@(Get|Post|Put|Delete|Patch)Mapping\b(?:\s*\(([\s\S]*?)\))?/g;
  let match;
  while ((match = direct.exec(annotations)) !== null) {
    for (const mappingPath of mappingPaths(match[2])) {
      result.push({ method: match[1].toUpperCase(), path: mappingPath });
    }
  }
  const request = /@RequestMapping\b(?:\s*\(([\s\S]*?)\))?/g;
  while ((match = request.exec(annotations)) !== null) {
    const methods = [...String(match[1] || "").matchAll(/RequestMethod\.(GET|POST|PUT|DELETE|PATCH)/g)]
      .map((value) => value[1]);
    for (const method of methods.length > 0 ? methods : ["ANY"]) {
      for (const mappingPath of mappingPaths(match[1])) result.push({ method, path: mappingPath });
    }
  }
  return result;
}

function normalizeEndpointPath(classPath, methodPath) {
  const joined = [classPath, methodPath]
    .map((value) => String(value || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return joined ? `/${joined}`.replace(/\/{2,}/g, "/") : "/";
}

function collectControllerEndpoints(contents) {
  const endpoints = [];
  for (const [rel, content] of contents) {
    if (!rel.endsWith("Controller.java") || !/class\s+\w*Controller\b/.test(content)) continue;
    const offsets = lineOffsets(content);
    const lines = content.split(/\r?\n/);
    const classIndex = content.search(/class\s+\w*Controller\b/);
    const classPaths = classMappingPaths(annotationBlockBefore(content, classIndex));
    for (const method of methodDeclarations(content)) {
      if (method.visibility !== "public") continue;
      const mappings = methodMappingDescriptors(annotationBlock(lines, method.startLine));
      for (const mapping of mappings) {
        for (const classPath of classPaths) {
          endpoints.push({
            method: mapping.method,
            path: normalizeEndpointPath(classPath, mapping.path),
            file: rel,
            line: method.startLine,
            handler: method.name,
          });
        }
      }
    }
  }
  return endpoints.sort((left, right) =>
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method)
      || left.file.localeCompare(right.file) || left.line - right.line);
}

// 由统一 Source Index 汇聚契约物理表描述（B31 用）；目录配置存在时不全仓猜根。
function collectContractTables(projectRoot) {
  const dbSpec = require("./db-spec");
  const tables = new Map();
  const index = sourceIndex.buildSourceIndex(projectRoot);
  for (const entry of index.contracts) tables.set(entry.table, dbSpec.descriptorFromContract(entry.raw, entry.rel));
  return tables;
}

function checkDuplicateControllerEndpoints(endpoints, output) {  const firstByKey = new Map();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path}`;
    const anyKey = `ANY ${endpoint.path}`;
    const first = firstByKey.get(key) || firstByKey.get(anyKey)
      || (endpoint.method === "ANY"
        ? [...firstByKey.entries()].find(([candidate]) => candidate.endsWith(` ${endpoint.path}`))?.[1]
        : undefined);
    if (!first) {
      firstByKey.set(key, endpoint);
      continue;
    }
    output.push(issue(
      "B30",
      endpoint.file,
      endpoint.line,
      1,
      `Controller 路由重复：${key} 已由 ${first.file}:${first.line}#${first.handler} 声明`,
    ));
  }
}

function hasJavadoc(lines, methodStartLine) {
  let index = methodStartLine - 2;
  while (index >= 0 && (!lines[index].trim() || lines[index].trim().startsWith("@"))) index -= 1;
  if (index < 0 || !lines[index].includes("*/")) return false;
  while (index >= 0 && !lines[index].includes("/**")) index -= 1;
  return index >= 0;
}

function checkController(content, relFile, output, enabled = () => true) {
  if (!/class\s+\w*Controller\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  const classIndex = content.search(/class\s+\w*Controller\b/);
  const classAuthorized = classIndex >= 0 && /@PreAuthorize\b/.test(content.slice(0, classIndex));
  for (const method of methodDeclarations(content)) {
    if (method.visibility !== "public") continue;
    const annotations = annotationBlock(lines, method.startLine);
    if (!/@(?:Get|Post|Put|Delete|Patch)Mapping\b|@RequestMapping\b/.test(annotations)) continue;
    if (enabled("B1") && !classAuthorized && !/@PreAuthorize\b/.test(annotations)) {
      output.push(issue("B1", relFile, method.startLine, 1, `Controller 接口 ${method.name}() 缺 @PreAuthorize；公开接口必须用有理由的豁免登记`));
    }
    if (enabled("B2") && !/@Operation\b/.test(annotations)) {
      output.push(issue("B2", relFile, method.startLine, 1, `Controller 接口 ${method.name}() 缺 OpenAPI 3 @Operation`));
    }
  }
}

const REDIS_OPS_REGEX = /\.(opsForValue|opsForHash|opsForList|opsForSet|opsForZSet)\s*\(\s*\)\s*\.\s*(set|setIfAbsent)\s*\(/g;
const STRING_REDIS_REGEX = /\.(opsForValue|opsForHash|opsForList|opsForSet|opsForZSet)\s*\(\s*\)\s*\.\s*set\s*\(/g;

function findCallText(content, startIndex) {
  const openIdx = content.indexOf("(", startIndex);
  if (openIdx < 0) return null;
  let depth = 1;
  let i = openIdx + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === "(") depth += 1;
    else if (content[i] === ")") depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  return content.slice(openIdx, i);
}

function countCommasInCallArgs(callText) {
  if (!callText) return -1;
  let depth = 0;
  let commas = 0;
  let started = false;
  for (let i = 0; i < callText.length; i += 1) {
    const c = callText[i];
    if (c === "(") {
      depth += 1;
      started = true;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0 && started) break;
    } else if (c === "," && depth === 1 && started) {
      commas += 1;
    }
  }
  return commas;
}

function checkRedisNoTtl(content, relFile, output) {
  if (!/RedisTemplate|StringRedisTemplate|\.opsFor(Value|Hash|List|Set|ZSet)\s*\(\s*\)/.test(content)) return;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const opsRegex = /\.(opsForValue|opsForHash|opsForList|opsForSet|opsForZSet)\s*\(\s*\)\s*\.\s*(set|setIfAbsent)/g;
  let match;
  while ((match = opsRegex.exec(scrubbed)) !== null) {
    const callText = findCallText(scrubbed, match.index + match[0].length);
    if (!callText) continue;
    const commas = countCommasInCallArgs(callText);
    const pos = lineAt(offsets, match.index);
    if (commas < 2) {
      output.push(issue("B13", relFile, pos.line, pos.col, `Redis ${match[2]}() 调用缺少 TTL 参数（至少 3 个参数：key/value/过期时间）`));
    }
  }
  const directSetRegex = /\bredisTemplate\s*\.\s*set\b/g;
  while ((match = directSetRegex.exec(scrubbed)) !== null) {
    const callText = findCallText(scrubbed, match.index + match[0].length);
    if (!callText) continue;
    const commas = countCommasInCallArgs(callText);
    const pos = lineAt(offsets, match.index);
    if (commas < 2) {
      output.push(issue("B13", relFile, pos.line, pos.col, "RedisTemplate.set() 缺少 TTL 参数"));
    }
  }
}

function checkRedisSelfLock(content, relFile, output) {
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const patterns = [
    { regex: /\bsetnx\s*\(/gi, label: "setnx" },
    { regex: /\.setIfAbsent\s*\(\s*[^,)]+\s*,\s*[^,)]+\s*\)/g, label: "setIfAbsent 两参数自实现锁" },
  ];
  for (const { regex, label } of patterns) {
    let match;
    while ((match = regex.exec(scrubbed)) !== null) {
      const pos = lineAt(offsets, match.index);
      output.push(issue("B14", relFile, pos.line, pos.col, `检测到 ${label}，自实现分布式锁不安全（无续期/无重入/无原子释放）；必须用 Redisson RLock`));
    }
  }
  // B14 扩展：setIfAbsent 三参数 + 长 TTL（>10min）缺 watchdog 续期
  const longTtlRegex = /\.setIfAbsent\s*\(\s*[^,)]+\s*,\s*[^,)]+\s*,\s*(\d+)\s*,\s*TimeUnit\.(\w+)\s*\)/g;
  const unitToSeconds = { SECONDS: 1, MINUTES: 60, HOURS: 3600, DAYS: 86400, MILLISECONDS: 0.001, MICROSECONDS: 0.000001, NANOSECONDS: 0.000000001 };
  let m;
  while ((m = longTtlRegex.exec(content)) !== null) {
    const value = Number(m[1]);
    const unit = m[2];
    const seconds = value * (unitToSeconds[unit] || 0);
    if (seconds >= 600) {
      const pos = lineAt(offsets, m.index);
      output.push(issue("B14", relFile, pos.line, pos.col, `setIfAbsent TTL=${value} ${unit}（≥10min）长任务锁：业务超时可能 > 锁超时导致并发执行；用 Redisson RLock + watchdog 自动续期`));
    }
  }
}

function checkRedisDangerousCommands(content, relFile, output) {
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const patterns = [
    { regex: /\.keys\s*\(\s*["'`]?\s*\*\s*["'`]?\s*\)/g, label: "keys(\"*\")", useRaw: false },
    { regex: /\bFLUSHDB\b/gi, label: "FLUSHDB", useRaw: false },
    { regex: /\bFLUSHALL\b/gi, label: "FLUSHALL", useRaw: false },
  ];
  for (const { regex, label } of patterns) {
    let match;
    while ((match = regex.exec(scrubbed)) !== null) {
      const pos = lineAt(offsets, match.index);
      output.push(issue("B15", relFile, pos.line, pos.col, `禁用 Redis 命令 ${label}（阻塞主线程或清库）；生产应 rename 或禁用，业务用 SCAN 替代 KEYS`));
    }
  }
  const rawPatterns = [
    { regex: /\.keys\s*\(\s*["'`]\s*\*\s*["'`]\s*\)/g, label: "keys(\"*\")" },
    { regex: /execute\s*\(\s*["'`][^"'`]*FLUSH/gi, label: "execute FLUSH*" },
  ];
  for (const { regex, label } of rawPatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const pos = lineAt(offsets, match.index);
      output.push(issue("B15", relFile, pos.line, pos.col, `禁用 Redis 命令 ${label}（阻塞主线程或清库）；生产应 rename 或禁用`));
    }
  }
}

function checkRedisJdkSerializer(content, relFile, output) {
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const regex = /\bJdkSerializationRedisSerializer\b/g;
  let match;
  while ((match = regex.exec(scrubbed)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B16", relFile, pos.line, pos.col, "显式使用 JdkSerializationRedisSerializer：二进制不可读、跨语言不兼容、历史 RCE 漏洞；统一 Jackson + JavaTimeModule"));
  }
}

const PHYSICAL_DELETE_REGEX = /(?:\.|\b)(deleteBatchIds|deleteById|deleteByMap|removeById|removeByIds|removeBatchByIds|removeByMap)\s*\(/g;
const SQL_DANGEROUS_RAW_REGEX = /\b(TRUNCATE\s+TABLE|DROP\s+TABLE)\b/gi;
const JAVA_PHYSICAL_DELETE_REGEX = /(?:@Delete\s*\(|\b(?:jdbcTemplate|namedParameterJdbcTemplate|entityManager|session)\s*\.\s*(?:update|execute|executeUpdate|createNativeQuery)\s*\()[\s\S]{0,300}?["']\s*DELETE\s+FROM\b/gi;

function checkPhysicalDelete(content, relFile, output, softDelete) {
  if (/class\s+\w*Controller\b/.test(content)) return;
  const deletedValue = softDelete && Number.isInteger(softDelete.deletedValue) ? softDelete.deletedValue : 0;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  let match;
  while ((match = PHYSICAL_DELETE_REGEX.exec(scrubbed)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B17", relFile, pos.line, pos.col, `检测到 ${match[1]}()：业务代码禁止物理删除，团队基线软删 IS_DELETE=${deletedValue}；物理删须走独立运维契约 + DBA 双签`));
  }
  while ((match = SQL_DANGEROUS_RAW_REGEX.exec(content)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B17", relFile, pos.line, pos.col, `检测到 ${match[1]}：业务代码禁止 TRUNCATE/DROP TABLE；DDL 走 standards/12，必须 db-migration + DBA 审批`));
  }
  while ((match = JAVA_PHYSICAL_DELETE_REGEX.exec(content)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B17", relFile, pos.line, pos.col, `检测到 Java SQL 物理 DELETE FROM；业务数据必须使用 IS_DELETE=${deletedValue} 原子软删除`));
  }
}

function checkJavaSqlWriteSafety(content, relFile, output) {
  const offsets = lineOffsets(content);
  const patterns = [
    /@(?:Update|Delete)\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/gi,
    /\b(?:jdbcTemplate|namedParameterJdbcTemplate)\s*\.\s*(?:update|execute)\s*\(\s*"((?:\\.|[^"\\])*)"/gi,
    /\b(?:createNativeQuery|createQuery)\s*\(\s*"((?:\\.|[^"\\])*)"/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const sql = match[1].replace(/\\[rnt]/g, " ");
      if (!/^\s*(?:UPDATE|DELETE)\b/i.test(sql)) continue;
      if (!/\bWHERE\b/i.test(sql) || /\bWHERE\s+(?:1\s*=\s*1|TRUE)\b/i.test(sql)) {
        const pos = lineAt(offsets, match.index);
        output.push(issue("B18", relFile, pos.line, pos.col, "Java SQL 写入缺少有效 WHERE，或使用 WHERE 1=1/TRUE，存在全表写风险"));
      }
    }
  }
}

function checkJavaTenantAccess(content, relFile, output, tenantMode) {
  if (tenantMode === "interceptor" || /(?:Test|Tests)\.java$/.test(relFile)) return;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const direct = /\bbaseMapper\s*\.\s*(selectById|selectBatchIds)\s*\(/g;
  let match;
  while ((match = direct.exec(scrubbed)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B7", relFile, pos.line, pos.col, `${match[1]}() 无法显式证明 COMPANY_ID 租户隔离；使用带 companyId 参数的 Mapper 方法`));
  }
  const chain = /(?:\blambdaQuery\s*\(\)|\bWrappers\s*\.\s*lambdaQuery\s*\([^)]*\)|\bnew\s+LambdaQueryWrapper(?:<[^>]+>)?\s*\([^)]*\))([\s\S]{0,2000}?)(?:\.one\s*\(|\.list\s*\(|\.page\s*\(|\.count\s*\(|baseMapper\s*\.\s*select(?:One|List|Page)\s*\()/g;
  while ((match = chain.exec(scrubbed)) !== null) {
    if (/getCompanyId\b|\bCOMPANY_ID\b/.test(match[0])) continue;
    const pos = lineAt(offsets, match.index);
    output.push(issue("B7", relFile, pos.line, pos.col, "Java QueryWrapper/lambdaQuery 查询缺少显式 companyId 条件，存在跨租户读取风险"));
  }
}

function checkWrapperWriteSafety(content, relFile, output, tenantMode) {
  if (/(?:Test|Tests)\.java$/.test(relFile)) return;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const wrappers = /(?:\blambdaUpdate\s*\(\)|\bWrappers\s*\.\s*lambdaUpdate\s*\([^)]*\)|\bnew\s+(?:Lambda)?UpdateWrapper(?:<[^>]+>)?\s*\([^)]*\))([\s\S]{0,2500}?)(?:\.update\s*\(|baseMapper\s*\.\s*update\s*\()/g;
  let match;
  while ((match = wrappers.exec(scrubbed)) !== null) {
    const missing = [];
    if (tenantMode !== "interceptor" && !/getCompanyId\b|\bCOMPANY_ID\b/.test(match[0])) missing.push("companyId");
    if (!/getIsDelete\b|\bIS_DELETE\b/.test(match[0])) missing.push("IS_DELETE");
    if (!/getRevision\b|\bREVISION\b/.test(match[0])) missing.push("revision");
    if (missing.length === 0) continue;
    const pos = lineAt(offsets, match.index);
    output.push(issue("B18", relFile, pos.line, pos.col, `Wrapper 写入缺少 ${missing.join("/")} 约束；受管写必须使用 ID + COMPANY_ID + IS_DELETE + REVISION 原子 SQL`));
  }
}

function checkSensitiveToString(content, relFile, output) {
  if (!/@ToString\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  const sensitive = /(?:password|passwd|pwd|secret|token|credential|privateKey|idCard|identityNo|bankCard|mobile|phone|email)/i;
  lines.forEach((line, index) => {
    const field = line.match(/\bprivate\s+[\w<>,?.\[\]]+\s+(\w+)\s*;/);
    if (!field || !sensitive.test(field[1])) return;
    const annotations = lines.slice(Math.max(0, index - 4), index).join("\n");
    if (!/@ToString\.Exclude\b/.test(annotations)) {
      output.push(issue("B25", relFile, index + 1, 1, `疑似敏感字段 ${field[1]} 会进入 Lombok toString；必须 @ToString.Exclude 并配置日志脱敏`));
    }
  });
}

function checkMethodSecurityActivation(contents, output) {
  const protectedControllers = [...contents.entries()]
    .filter(([rel, content]) => rel.endsWith("Controller.java") && /@PreAuthorize\b/.test(content));
  if (protectedControllers.length === 0) return;
  const activated = [...contents.values()].some((content) => (
    /@EnableGlobalMethodSecurity\s*\((?=[^)]*\bprePostEnabled\s*=\s*true)[^)]*\)/s.test(content)
    || /@EnableMethodSecurity\b/.test(content)
    || /@EnableJhResourceServer\b/.test(content)
  ));
  if (activated) return;
  const [rel] = protectedControllers[0];
  output.push(issue("B24", rel, 1, 1, "检测到 @PreAuthorize，但项目源码未证明方法级授权已启用；Spring Boot 2 必须配置 @EnableGlobalMethodSecurity(prePostEnabled = true)"));
}

function checkMapperDiscoverability(contents, output) {
  const javaTypes = new Map();
  const mapperScans = [];
  const xmlNamespaces = new Map();

  for (const [rel, content] of contents) {
    if (rel.endsWith(".java")) {
      const packageName = (content.match(/^\s*package\s+([a-zA-Z_][\w.]*)\s*;/m) || [])[1];
      const typeName = (content.match(/\b(?:class|interface|enum)\s+([A-Z]\w*)\b/) || [])[1];
      if (packageName && typeName) javaTypes.set(`${packageName}.${typeName}`, { rel, content, packageName, typeName });

      const scanRegex = /@MapperScan\s*\(([\s\S]*?)\)/g;
      let scanMatch;
      while ((scanMatch = scanRegex.exec(content)) !== null) {
        const packages = [...scanMatch[1].matchAll(/["']([a-zA-Z_][\w.*]*)["']/g)].map((match) => match[1]);
        const pos = lineAt(lineOffsets(content), scanMatch.index);
        for (const packageValue of packages.filter((value) => value.includes("*"))) {
          output.push(issue(
            "B26",
            rel,
            pos.line,
            pos.col,
            `MapperScan basePackages 必须是 Java 包前缀，禁止 Ant 通配符 ${packageValue}`,
          ));
        }
        mapperScans.push({
          packages: packages.filter((value) => !value.includes("*")),
          annotationRestricted: /\bannotationClass\s*=\s*(?:org\.apache\.ibatis\.annotations\.)?Mapper\s*\.class/.test(scanMatch[1]),
        });
      }
    } else if (rel.endsWith(".xml") && /(?:^|\/)mapper(?:\/|$)|Mapper\.xml$/i.test(rel)) {
      const namespaceMatch = content.match(/<mapper\b[^>]*\bnamespace\s*=\s*["']([^"']+)["']/i);
      if (!namespaceMatch) continue;
      const pos = lineAt(lineOffsets(content), namespaceMatch.index);
      if (xmlNamespaces.has(namespaceMatch[1])) {
        output.push(issue("B26", rel, pos.line, pos.col, `Mapper XML namespace 重复：${namespaceMatch[1]}`));
      } else {
        xmlNamespaces.set(namespaceMatch[1], { rel, line: pos.line, col: pos.col });
      }
    }
  }

  for (const [namespace, xml] of xmlNamespaces) {
    if (!javaTypes.has(namespace)) {
      output.push(issue("B26", xml.rel, xml.line, xml.col, `Mapper XML namespace ${namespace} 找不到同名 Java Mapper 接口`));
    }
  }

  for (const [fqn, info] of javaTypes) {
    if (!info.rel.endsWith("Mapper.java")) continue;
    const declaration = info.content.match(/\binterface\s+\w+\s*(<[\s\S]*?>)?\s*(?:extends\s+([^{]+))?\{/);
    if (!declaration) continue;
    const matchingXml = xmlNamespaces.has(fqn);
    const mapperInheritance = /(?:JhBaseMapper|BaseMapper|\w+Mapper)\s*</.test(declaration[2] || "");
    if (!matchingXml && !mapperInheritance) continue;

    const hasMapperAnnotation = /@Mapper\b/.test(info.content);
    const isGenericContract = Boolean(declaration[1]);
    const declarationIndex = info.content.indexOf(declaration[0]);
    const pos = lineAt(lineOffsets(info.content), Math.max(0, declarationIndex));
    if (isGenericContract && hasMapperAnnotation) {
      output.push(issue(
        "B26",
        info.rel,
        pos.line,
        pos.col,
        `泛型 Mapper 契约 ${info.typeName} 禁止标注 @Mapper，否则 Spring/MyBatis 会尝试实例化未绑定的泛型接口`,
      ));
      continue;
    }
    if (isGenericContract || hasMapperAnnotation) continue;

    const coveredByUnrestrictedScan = mapperScans.some((scan) => (
      !scan.annotationRestricted
      && scan.packages.some((basePackage) => info.packageName === basePackage || info.packageName.startsWith(`${basePackage}.`))
    ));
    if (!coveredByUnrestrictedScan) {
      output.push(issue(
        "B26",
        info.rel,
        pos.line,
        pos.col,
        `具体 Mapper ${info.typeName} 未标注 @Mapper，且不存在覆盖其包的非注解限制 @MapperScan`,
      ));
    }
  }
}

function mapperLocationRegex(pattern) {
  const normalized = String(pattern || "")
    .trim()
    .replace(/^classpath\*?:/i, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  if (!normalized || normalized.includes("${")) return null;
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "i");
}

function checkMapperResourceLocations(contents, output) {
  const configured = [];
  for (const [rel, content] of contents) {
    if (!/\.(?:ya?ml|properties)$/i.test(rel)) continue;
    const regex = /(?:^|\s)mapper-locations\s*[:=]\s*([^\r\n#]+)/gim;
    let match;
    while ((match = regex.exec(content)) !== null) {
      for (const raw of match[1].split(",")) {
        const value = raw.trim().replace(/^['"]|['"]$/g, "");
        const matcher = mapperLocationRegex(value);
        if (matcher) configured.push({ matcher, rel, value, index: match.index });
      }
    }
  }
  if (configured.length === 0) return;
  for (const [rel] of contents) {
    if (!rel.endsWith(".xml") || !/(?:^|\/)mapper(?:\/|$)|Mapper\.xml$/i.test(rel)) continue;
    const resourcePath = rel.replace(/^.*?src\/main\/resources\//, "");
    if (configured.some((item) => item.matcher.test(resourcePath))) continue;
    const first = configured[0];
    const configContent = contents.get(first.rel) || "";
    const pos = lineAt(lineOffsets(configContent), first.index);
    output.push(issue(
      "B26",
      first.rel,
      pos.line,
      pos.col,
      `mapper-locations=${configured.map((item) => item.value).join(",")} 无法装载 ${resourcePath}；须覆盖实际资源目录并在启动期校验 statement`,
    ));
  }
}

function checkSaveBatchOversized(content, relFile, output) {
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const regex = /\.saveBatch\s*\(\s*[^,)]+\s*,\s*(\d{2,})\s*\)/g;
  let match;
  while ((match = regex.exec(scrubbed)) !== null) {
    const size = Number(match[1]);
    if (size > 1000) {
      const pos = lineAt(offsets, match.index);
      output.push(issue("B19", relFile, pos.line, pos.col, `saveBatch 显式批量大小 ${size} 超过 1000 基线；大表批量须按主键游标分批 + 限速`));
    }
  }
}

const MQ_HTTP_IN_TX_REGEX = /(rocketMQTemplate|kafkaTemplate|amqpTemplate|StringRedisTemplate\s*\.\s*convertAndSend|HttpUtil\.|RestTemplate|HttpClient|WebClient)\b/g;

function methodBodyEnd(content, methodStart) {
  const lines = content.split(/\r?\n/);
  const upTo = content.indexOf("{", methodStart);
  if (upTo < 0) return null;
  let depth = 0;
  for (let i = upTo; i < content.length; i += 1) {
    if (content[i] === "{") depth += 1;
    else if (content[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

function checkTransactionalWithMqOrHttp(content, relFile, output) {
  if (!/class\s+\w*(?:ServiceImpl|Service)\b/.test(content)) return;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const methods = methodDeclarations(content);
  for (const method of methods) {
    if (method.visibility !== "public") continue;
    const bodyEnd = methodBodyEnd(scrubbed, method.startIndex >= 0 ? method.startIndex : offsets.reduce((acc, off, idx) => (idx + 1 <= method.startLine ? off + (method.startLine === idx + 1 ? 0 : 0) : acc), 0));
    const annBlock = annotationBlock(content.split(/\r?\n/), method.startLine);
    if (!/@Transactional\b/.test(annBlock)) continue;
    const bodyStart = scrubbed.indexOf("{", method.startLine > 0 ? offsets[method.startLine - 1] || 0 : 0);
    if (bodyStart < 0) continue;
    const bodyEndIdx = methodBodyEnd(scrubbed, bodyStart);
    if (bodyEndIdx == null) continue;
    const body = scrubbed.slice(bodyStart, bodyEndIdx);
    const hits = new Set();
    let m;
    MQ_HTTP_IN_TX_REGEX.lastIndex = 0;
    while ((m = MQ_HTTP_IN_TX_REGEX.exec(body)) !== null) {
      hits.add(m[1].replace(/\s+/g, "").replace(/\.$/, ""));
    }
    if (hits.size > 0) {
      output.push(issue("B20", relFile, method.startLine, 1, `@Transactional 方法 ${method.name}() 内调用 ${[...hits].join("/")}：事务回滚后消息/调用已发出，导致数据不一致或长事务锁占用；移出事务边界或用事务消息 + afterCommit`));
    }
  }
}

function checkHttpNoTimeout(content, relFile, output) {
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  const httpUtilRegex = /(HttpUtil\.(?:createGet|createPost|create[A-Z]\w*))\s*\([^)]*\)/g;
  let m;
  while ((m = httpUtilRegex.exec(scrubbed)) !== null) {
    const nextExecute = scrubbed.indexOf(".execute(", m.index);
    if (nextExecute < 0 || nextExecute - m.index > 600) continue;
    const chain = scrubbed.slice(m.index, nextExecute);
    if (!/\.timeout\s*\(/.test(chain)) {
      const pos = lineAt(offsets, m.index);
      output.push(issue("B21", relFile, pos.line, pos.col, `HttpUtil 裸调用无超时：默认无限等待，下游慢拖垮线程池；加 .timeout(N) 或用 Feign + 熔断`));
    }
  }
  const restTemplateRegex = /(\brestTemplate|RestTemplate)\s*\.\s*(?:getForObject|postForObject|exchange|execute)\s*\(/g;
  while ((m = restTemplateRegex.exec(scrubbed)) !== null) {
    const pos = lineAt(offsets, m.index);
    output.push(issue("B21", relFile, pos.line, pos.col, `RestTemplate 裸调用：未配置超时可能导致线程耗尽；确认 ClientHttpRequestFactory 配置了 connectTimeout/readTimeout`));
  }
}

const SWAGGER2_IMPORT_REGEX = /import\s+io\.swagger\.annotations\./g;
const SWAGGER3_IMPORT_REGEX = /import\s+io\.swagger\.v3\.oas\.annotations\./g;
const SWAGGER2_USAGE_REGEX = /@(?:Api|ApiOperation|ApiImplicitParams|ApiImplicitParam|ApiModel|ApiModelProperty|ApiIgnore)\b/g;

function checkSwaggerMixed(content, relFile, output) {
  if (!/\.java$/.test(relFile) && !/Controller\.java$/.test(relFile)) return;
  const offsets = lineOffsets(content);
  const hasSwagger2 = SWAGGER2_USAGE_REGEX.test(content) || SWAGGER2_IMPORT_REGEX.test(content);
  SWAGGER2_USAGE_REGEX.lastIndex = 0;
  SWAGGER2_IMPORT_REGEX.lastIndex = 0;
  const hasSwagger3 = SWAGGER3_IMPORT_REGEX.test(content) || /@(?:Tag|Operation|Parameter|Parameters|Schema)\b/.test(content);
  if (hasSwagger2 && hasSwagger3) {
    const m = content.match(/class\s+\w+/);
    const pos = m ? lineAt(offsets, m.index) : { line: 1, col: 1 };
    output.push(issue("B22", relFile, pos.line, pos.col, "同类同时混用 Swagger 2（@Api/@ApiOperation/@ApiModel）与 OpenAPI 3（@Tag/@Operation/@Schema）：文档冗余、Knife4j/Apifox 解析歧义；统一用 OpenAPI 3"));
    return;
  }
  if (hasSwagger2 && /Controller\.java$/.test(relFile)) {
    const m = content.match(/class\s+\w*Controller\b/);
    if (m) {
      const pos = lineAt(offsets, m.index);
      output.push(issue("B22", relFile, pos.line, pos.col, "Controller 使用 Swagger 2 注解（io.swagger.annotations）：新代码用 OpenAPI 3（io.swagger.v3.oas.annotations）；存量允许保留，迁移按 standards/13 §8.2"));
    }
  }
}

function checkServiceDependencies(content, relFile, output) {
  if (!/class\s+\w*(?:ServiceImpl|Service)\b/.test(content)) return;
  const offsets = lineOffsets(content);
  const fieldRegex = /^\s*(?:private|protected)\s+(?:final\s+)?\w+(?:<[^>]*>)?\s+(\w+)\s*;/gm;
  const fields = [];
  let m;
  while ((m = fieldRegex.exec(content)) !== null) {
    if (["serialVersionUID"].includes(m[1])) continue;
    fields.push(m[1]);
  }
  const injectedAnnotations = (content.match(/@(?:[\w.]*\.)?(?:Resource|Autowired|Inject)\b/g) || []).length;
  const requiredArgsConstructor = /@RequiredArgsConstructor/.test(content);
  const hasInjectionEvidence = injectedAnnotations > 0 || requiredArgsConstructor;
  if (fields.length > 10 && hasInjectionEvidence) {
    const classMatch = content.match(/class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : "Service";
    const pos = classMatch ? lineAt(offsets, classMatch.index) : { line: 1, col: 1 };
    output.push(issue("B23", relFile, pos.line, pos.col, `${className} 注入依赖 ${fields.length} 个（>10）：职责过载信号，建议按子域拆分（如 OrderQueryService/OrderWriteService/OrderSyncService）`));
  }
}

function checkMapperXml(content, relFile, output, tenantMode, softDelete, enabled = () => true) {
  const executable = stripXmlComments(content);
  const offsets = lineOffsets(executable);
  let match;
  const star = /\bSELECT\s+(?:DISTINCT\s+)?(?:[A-Za-z_][\w]*\.)?\*/gi;
  while (enabled("B3") && (match = star.exec(executable)) !== null) {
    const position = lineAt(offsets, match.index);
    output.push(issue("B3", relFile, position.line, position.col, "Mapper XML 的可执行 SQL 使用 SELECT 星号，必须显式列出字段"));
  }
  const substitution = /\$\{[^}]+\}/g;
  while (enabled("B4") && (match = substitution.exec(executable)) !== null) {
    const position = lineAt(offsets, match.index);
    output.push(issue("B4", relFile, position.line, position.col, `Mapper XML 使用文本替换 ${match[0]}；默认基线不允许任何 \${} SQL 片段`));
  }
  if (!enabled("B7") || tenantMode === "interceptor") return;
  const selects = /<select\b[^>]*>([\s\S]*?)<\/select>/gi;
  while ((match = selects.exec(executable)) !== null) {
    const body = match[1];
    const hasTenantPredicate = /(?:\b\w+\.)?COMPANY_ID\s*=\s*#\{(?:[A-Za-z_]\w*\.)?companyId(?:\s*,[^}]*)?\}/i.test(body);
    if (!hasTenantPredicate) {
      const position = lineAt(offsets, match.index);
      output.push(issue("B7", relFile, position.line, position.col, "SELECT 缺少 COMPANY_ID = #{companyId} 租户谓词，且未验证统一租户拦截器"));
    }
  }
}

function checkUpdateDeleteWithoutWhere(content, relFile, output, tenantMode = "explicit", softDelete, enabled = () => true) {
  const executable = stripXmlComments(content);
  const offsets = lineOffsets(executable);
  const updateOrDeleteTags = /<(update|delete)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = updateOrDeleteTags.exec(executable)) !== null) {
    const tag = match[1];
    const body = match[2];
    const invalidWhere = !/\bWHERE\b/i.test(body) || /\bWHERE\s+(?:1\s*=\s*1|TRUE)\b/i.test(body);
    const dynamicOnly = /<where\b/i.test(body)
      && !/(?:\bAND|\bOR)\s+(?:[A-Za-z_]\w*\.)?[A-Z][A-Z0-9_]*\s*(?:=|<>|!=|IN\b|IS\b|LIKE\b)/i.test(body.replace(/<if\b[\s\S]*?<\/if>/gi, ""));
    const missingTenant = tenantMode !== "interceptor"
      && !/(?:\b\w+\.)?COMPANY_ID\s*=\s*#\{(?:[A-Za-z_]\w*\.)?companyId(?:\s*,[^}]*)?\}/i.test(body);
    if (enabled("B18") && (invalidWhere || dynamicOnly || missingTenant)) {
      const position = lineAt(offsets, match.index);
      const causes = [
        ...(invalidWhere ? ["缺少有效 WHERE（禁止 WHERE 1=1/TRUE）"] : []),
        ...(dynamicOnly ? ["WHERE 只由可选动态条件构成"] : []),
        ...(missingTenant ? ["缺少 COMPANY_ID 租户谓词"] : []),
      ];
      output.push(issue("B18", relFile, position.line, position.col, `<${tag}> ${causes.join("、")}，存在全表或跨租户写风险`));
    }
    if (enabled("B17") && tag.toLowerCase() === "delete") {
      const position = lineAt(offsets, match.index);
      const deletedValue = softDelete && Number.isInteger(softDelete.deletedValue) ? softDelete.deletedValue : 0;
      output.push(issue("B17", relFile, position.line, position.col, `Mapper XML <delete> 是物理删除；业务数据必须 UPDATE IS_DELETE=${deletedValue}`));
    }
  }
}

function checkService(content, relFile, output, enabled = () => true) {
  if (!/class\s+\w*(?:ServiceImpl|Service)\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  const scrubbed = stripJava(content);
  const scrubbedLines = scrubbed.split(/\r?\n/);
  scrubbedLines.forEach((line, index) => {
    const match = line.match(/throw\s+new\s+(RuntimeException|Exception)\s*\(/);
    if (enabled("B8") && match) output.push(issue("B8", relFile, index + 1, match.index + 1, `业务层不得抛裸 ${match[1]}，应使用 ServiceAssert/受管业务异常`));
  });
  const classIndex = content.search(/class\s+\w*(?:ServiceImpl|Service)\b/);
  const classTransactional = classIndex >= 0 && /@Transactional\b/.test(content.slice(0, classIndex));
  for (const method of methodDeclarations(content)) {
    if (method.visibility !== "public") continue;
    const write = /^(save|insert|add|create|update|delete|remove|batch|submit|approve|reject|enable|disable|import|sync|release|close|cancel|withdraw|convert|changeStatus|publish|archive|restore|print|send|reset|assign|transfer|lock|unlock|audit|verify)/i.test(method.name);
    if (enabled("B5") && write && !classTransactional && !/@Transactional\b/.test(annotationBlock(lines, method.startLine))) {
      output.push(issue("B5", relFile, method.startLine, 1, `写用例 ${method.name}() 缺 @Transactional(rollbackFor = Exception.class)`));
    }
  }
}

function checkDesign(content, relFile, output, thresholds, enabled = () => true) {
  const lines = content.split(/\r?\n/);
  const type = content.match(/\b(class|interface|enum)\s+(\w+)/);
  if (enabled("B9") && type && lines.length > thresholds.classLines) {
    output.push(issue("B9", relFile, lineAt(lineOffsets(content), type.index).line, 1, `类型 ${type[2]} 共 ${lines.length} 行，超过 ${thresholds.classLines} 行基线`));
  }
  for (const method of methodDeclarations(content)) {
    const length = method.endLine - method.startLine + 1;
    if (enabled("B10") && length > thresholds.methodLines) output.push(issue("B10", relFile, method.startLine, 1, `方法 ${method.name}() 共 ${length} 行，超过 ${thresholds.methodLines} 行硬上限`));
    const decisions = (method.body.match(/\bif\s*\(/g) || []).length
      + (method.body.match(/\bfor\s*\(/g) || []).length
      + (method.body.match(/\bwhile\s*\(/g) || []).length
      + (method.body.match(/\bcase\b/g) || []).length
      + (method.body.match(/\bcatch\s*\(/g) || []).length
      + (method.body.match(/&&|\|\|/g) || []).length
      + (method.body.match(/\?[^:;]+:/g) || []).length;
    const complexity = 1 + decisions;
    if (enabled("B11") && complexity > thresholds.cyclomaticComplexity) output.push(issue("B11", relFile, method.startLine, 1, `方法 ${method.name}() 圈复杂度约 ${complexity}，超过 ${thresholds.cyclomaticComplexity}`));
  }
}

function checkMethodJavadoc(content, relFile, output) {
  const isService = /class\s+\w*(?:ServiceImpl|Service)\b/.test(content);
  const isMapper = /(?:public\s+)?interface\s+\w*Mapper\b/.test(content);
  if (!isService && !isMapper) return;
  const lines = content.split(/\r?\n/);
  let methods = methodDeclarations(content);
  if (isMapper) {
    const scrubbedLines = stripJava(content).split(/\r?\n/);
    methods = [];
    for (let start = 0; start < scrubbedLines.length; start += 1) {
      if (!/^\s*[\w<>,?.\[\]]+(?:\s+[\w<>,?.\[\]]+)*\s+\w+\s*\(/.test(scrubbedLines[start])) continue;
      let signature = scrubbedLines[start];
      let end = start;
      while (!/;/.test(signature) && end < Math.min(scrubbedLines.length - 1, start + 9)) {
        end += 1;
        signature += ` ${scrubbedLines[end].trim()}`;
      }
      const match = signature.match(/^\s*[\w<>,?.\[\]\s]+\s+(\w+)\s*\([^;{}]*\)\s*;/);
      if (match) methods.push({ name: match[1], visibility: "public", startLine: start + 1 });
      start = end;
    }
  }
  for (const method of methods) {
    if (isService && method.visibility !== "public") continue;
    if (!hasJavadoc(lines, method.startLine)) output.push(issue("B12", relFile, method.startLine, 1, `${isMapper ? "Mapper 接口" : "Service 业务"}方法 ${method.name}() 缺 Javadoc`));
  }
}

function checkDirectoryDensity(targetDir, files, output, thresholds) {
  const counts = new Map();
  for (const file of files.filter((value) => value.endsWith(".java"))) {
    const directory = path.dirname(file);
    counts.set(directory, (counts.get(directory) || 0) + 1);
  }
  for (const [directory, count] of counts) {
    if (count <= thresholds.directoryWarn) continue;
    const rel = normalizeRel(path.relative(targetDir, directory)) || ".";
    output.push(issue("B6", rel, 1, 1, `单个源码目录含 ${count} 个 Java 文件，超过 ${thresholds.directoryWarn} 个分域建议`, {
      severity: count > thresholds.directoryError ? "error" : "warn",
    }));
  }
}

function pomUsesVerifiedParent(content, expectedParent) {
  if (!expectedParent) return false;
  const parent = content.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/i)?.[1];
  if (!parent) return false;
  return tagValue(parent, "groupId") === expectedParent.groupId
    && tagValue(parent, "artifactId") === expectedParent.artifactId
    && tagValue(parent, "version") === expectedParent.version;
}

function verifiedProfilesForProject(contents) {
  const pomSources = [...contents]
    .filter(([rel]) => path.basename(rel).toLowerCase() === "pom.xml")
    .map(([, content]) => content);
  return compatibility.verified
    .filter((profile) => pomSources.some((content) => pomUsesVerifiedParent(content, profile.parentBom)));
}

function parentManagedDependencySet(contents) {
  const dependencies = verifiedProfilesForProject(contents)
    .flatMap((profile) => profile.parentManagedDependencies || []);
  return new Set(dependencies);
}

function maskDependencyManagement(content) {
  return content.replace(/<dependencyManagement\b[\s\S]*?<\/dependencyManagement>/gi, (block) =>
    block.replace(/[^\r\n]/g, " "));
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

function checkParentManagedDependencyVersions(contents, output) {
  const managed = parentManagedDependencySet(contents);
  if (managed.size === 0) return;
  for (const [rel, content] of contents) {
    if (path.basename(rel).toLowerCase() !== "pom.xml") continue;
    const searchable = maskDependencyManagement(content);
    const offsets = lineOffsets(content);
    const dependencyPattern = /<dependency\b[^>]*>[\s\S]*?<\/dependency>/gi;
    let match;
    while ((match = dependencyPattern.exec(searchable)) !== null) {
      const block = match[0];
      const groupId = tagValue(block, "groupId");
      const artifactId = tagValue(block, "artifactId");
      const version = tagValue(block, "version");
      if (!groupId || !artifactId || !version || !managed.has(`${groupId}:${artifactId}`)) continue;
      const versionIndex = match.index + block.search(/<version>/i);
      const pos = lineAt(offsets, versionIndex);
      output.push(issue(
        "B27",
        rel,
        pos.line,
        pos.col,
        `${groupId}:${artifactId} 由 jh4j-cloud 父 BOM 管理，子模块禁止显式锁定 ${version}；否则可能编译成功但运行包缺类`,
      ));
    }
  }
}

function annotationBlockBefore(content, index) {
  const prefix = content.slice(0, index);
  const boundary = Math.max(prefix.lastIndexOf("}"), prefix.lastIndexOf(";"));
  return prefix.slice(boundary + 1);
}

function qualifiedDelegateNames(content, beanName) {
  const escapedBeanName = beanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifierPattern = new RegExp(
    `@Qualifier\\s*\\(\\s*["']${escapedBeanName}["']\\s*\\)\\s*MetaObjectHandler\\s+(\\w+)`,
    "g",
  );
  const names = new Set();
  let match;
  while ((match = qualifierPattern.exec(content)) !== null) {
    names.add(match[1]);
    const assignment = new RegExp(`this\\.(\\w+)\\s*=\\s*${match[1]}\\s*;`).exec(content);
    if (assignment) names.add(assignment[1]);
  }
  return names;
}

function delegatesAllMethods(content, delegateNames, methods) {
  return methods.every((method) => [...delegateNames].some((name) =>
    new RegExp(`\\b${name}\\s*\\.\\s*${method}\\s*\\(`).test(content)));
}

function hasSpringContextResolutionTest(contents, interfaceSimpleName, implementationName) {
  return [...contents].some(([rel, content]) => {
    if (!rel.endsWith(".java") || !/(?:^|\/)src\/test\//.test(rel)) return false;
    if (!content.includes(interfaceSimpleName) && !content.includes(implementationName)) return false;
    const resolvesByType = new RegExp(
      `getBean\\s*\\(\\s*${interfaceSimpleName}\\.class\\s*\\)`,
    ).test(content);
    const startsApplicationContext = /@SpringBootTest\b|ApplicationContextRunner\b/.test(content);
    return resolvesByType && startsApplicationContext;
  });
}

function hasDelegateInvocationTest(contents, implementationName, methods) {
  return [...contents].some(([rel, content]) => {
    if (!rel.endsWith(".java") || !/(?:^|\/)src\/test\//.test(rel)) return false;
    if (!content.includes(implementationName) || !/\bverify\s*\(/.test(content)) return false;
    return methods.every((method) => new RegExp(`\\.\\s*${method}\\s*\\(`).test(content));
  });
}

function checkFrameworkExtensionBeanSafety(contents, output) {
  const extensionPoints = verifiedProfilesForProject(contents)
    .flatMap((profile) => profile.frameworkExtensionPoints || []);
  if (extensionPoints.length === 0) return;

  const mainJavaSources = [...contents].filter(([rel]) =>
    rel.endsWith(".java") && !/(?:^|\/)src\/test\//.test(rel));

  for (const extension of extensionPoints) {
    const simpleName = extension.interface.split(".").pop();
    const implementationPattern = new RegExp(
      `\\bclass\\s+(\\w+)[^{]*\\bimplements\\s+(?:[\\w.]+\\.)?${simpleName}\\b`,
      "g",
    );
    for (const [rel, content] of mainJavaSources) {
      let match;
      while ((match = implementationPattern.exec(content)) !== null) {
        if (match[1] === extension.frameworkImplementation.split(".").pop()) continue;
        const annotations = annotationBlockBefore(content, match.index);
        if (!/@(?:Component|Service|Configuration|Repository)\b/.test(annotations)) continue;
        const pos = lineAt(lineOffsets(content), match.index);
        if (!/@Primary\b/.test(annotations)) {
          output.push(issue(
            "B28",
            rel,
            pos.line,
            pos.col,
            `${simpleName} 已由平台 Bean ${extension.frameworkBeanName} 提供；新增 Spring Bean ${match[1]} 必须明确唯一选择，否则应用启动会发生 NoUniqueBeanDefinitionException`,
          ));
          continue;
        }

        const delegateNames = qualifiedDelegateNames(content, extension.frameworkBeanName);
        const methods = extension.delegateMethods || [];
        if (delegateNames.size === 0 || !delegatesAllMethods(content, delegateNames, methods)) {
          output.push(issue(
            "B28",
            rel,
            pos.line,
            pos.col,
            `${match[1]} 虽为 @Primary，但未通过 @Qualifier("${extension.frameworkBeanName}") 委托平台 ${methods.join("/")}；直接替换会丢失平台审计或上下文语义`,
          ));
          continue;
        }

        if (!hasSpringContextResolutionTest(contents, simpleName, match[1])) {
          output.push(issue(
            "B28",
            rel,
            pos.line,
            pos.col,
            `${match[1]} 缺少完整 Spring 容器测试；必须启动真实上下文并按 ${simpleName}.class 唯一取 Bean，以覆盖扩展点 Bean 冲突`,
            { severity: "warn" },
          ));
        }
        if (!hasDelegateInvocationTest(contents, match[1], methods)) {
          output.push(issue(
            "B28",
            rel,
            pos.line,
            pos.col,
            `${match[1]} 缺少平台委托回归测试；必须 mock/spy 并 verify ${methods.join("/")} 均调用 @Qualifier("${extension.frameworkBeanName}") 委托`,
            { severity: "warn" },
          ));
        }
      }
    }
  }
}

function activePaginationProfile(targetDir) {
  const projectFile = path.join(targetDir, ".wl-skills-bd", "contracts", "wl-delivery-profile.v1.json");
  const packageFile = path.resolve(__dirname, "..", "files", ".wl-skills-bd", "contracts", "wl-delivery-profile.v1.json");
  try {
    const profile = JSON.parse(fs.readFileSync(fs.existsSync(projectFile) ? projectFile : packageFile, "utf8"));
    const pagination = profile?.transport?.pagination;
    if (!pagination || !Number.isInteger(pagination.defaultCurrent)
      || !Number.isInteger(pagination.defaultSize) || !Number.isInteger(pagination.maxSize)) return null;
    return pagination;
  } catch {
    return null;
  }
}

function checkPageDtoPagination(targetDir, contents, output) {
  const pagination = activePaginationProfile(targetDir);
  if (!pagination) return;
  for (const [rel, content] of contents) {
    if (!rel.endsWith("PageDTO.java") || /(?:^|\/)src\/test\//.test(rel)) continue;
    const sizeField = /private\s+(?:Long|Integer|long|int)\s+size\b/.exec(content);
    if (!sizeField) continue;
    const maxMatch = /@Max\s*\(\s*(?:value\s*=\s*)?(\d+)[\s\S]{0,600}?private\s+(?:Long|Integer|long|int)\s+size\b/.exec(content);
    if (maxMatch && Number(maxMatch[1]) !== pagination.maxSize) {
      const pos = lineAt(lineOffsets(content), maxMatch.index);
      output.push(issue("B29", rel, pos.line, pos.col, `分页 size 上限为 ${maxMatch[1]}，与生效 Profile maxSize=${pagination.maxSize} 不一致`));
    }
    const currentMatch = /private\s+(?:Long|Integer|long|int)\s+current\s*=\s*(\d+)L?\s*;/.exec(content);
    if (currentMatch && Number(currentMatch[1]) !== pagination.defaultCurrent) {
      const pos = lineAt(lineOffsets(content), currentMatch.index);
      output.push(issue("B29", rel, pos.line, pos.col, `分页 current 默认值为 ${currentMatch[1]}，与生效 Profile defaultCurrent=${pagination.defaultCurrent} 不一致`));
    }
    const defaultSizeMatch = /DEFAULT_PAGE_SIZE\s*=\s*(\d+)L?\s*;/.exec(content)
      || /private\s+(?:Long|Integer|long|int)\s+size\s*=\s*(\d+)L?\s*;/.exec(content);
    if (defaultSizeMatch && Number(defaultSizeMatch[1]) !== pagination.defaultSize) {
      const pos = lineAt(lineOffsets(content), defaultSizeMatch.index);
      output.push(issue("B29", rel, pos.line, pos.col, `分页 size 默认值为 ${defaultSizeMatch[1]}，与生效 Profile defaultSize=${pagination.defaultSize} 不一致`));
    }
  }
}

function inlineExemption(content, value) {
  const lines = content.split(/\r?\n/);
  const candidates = [lines[value.line - 1] || "", lines[value.line - 2] || ""];
  for (const candidate of candidates) {
    const match = candidate.match(/wl-skills-bd-disable-next-line\s+([B\d,* ]+)\s+--\s+(.{5,})/);
    if (!match) continue;
    const rules = match[1].split(/[, ]+/).filter(Boolean);
    if (rules.includes("*") || rules.includes(value.rule)) return match[2].trim();
  }
  return null;
}

function runBeRules(targetDirInput, options = {}) {
  const started = Date.now();
  const targetDir = path.resolve(targetDirInput);
  const stagedMode = Array.isArray(options.stagedFiles);
  const executionPlan = createRuleExecutionPlan({
    rules: options.rules,
    quick: options.quick === true,
    staged: stagedMode,
  });
  const enabled = executionPlan.enabled;
  const exemptions = loadExemptions(targetDir);
  const config = loadConfig(targetDir);
  const rawIssues = [...exemptions.diagnostics, ...config.diagnostics];
  if (executionPlan.unknownRules.length > 0) {
    rawIssues.push(issue("WLS_CONFIG", ".", 1, 1, `未知规则：${executionPlan.unknownRules.join(", ")}`));
  }
  let scanContext = {
    files: [],
    contents: new Map(),
    diagnostics: [],
    metrics: { discoveredFiles: 0, loadedFiles: 0, loadedBytes: 0, oversizedFiles: 0, contentCacheHits: 0, contentCacheMisses: 0 },
  };
  try {
    scanContext = createScanContext(targetDir, {
      scanRel: options.scanRel,
      stagedFiles: stagedMode ? options.stagedFiles : undefined,
      discoverExtensions: executionPlan.discoverExtensions,
      readExtensions: executionPlan.readExtensions,
      maxFileBytes: MAX_FILE_BYTES,
    });
  } catch (error) {
    rawIssues.push(issue("WLS_CONFIG", ".", 1, 1, error.message));
  }
  const { files, contents } = scanContext;
  for (const diagnostic of scanContext.diagnostics) {
    rawIssues.push(issue("WLS_CONFIG", diagnostic.rel, 1, 1, diagnostic.message));
  }
  for (const [rel, content] of contents) {
    if (executionPlan.groupEnabled("controller") && rel.endsWith("Controller.java")) {
      checkController(content, rel, rawIssues, enabled);
    }
    if (rel.endsWith(".xml") && /(?:^|\/)mapper(?:\/|$)|Mapper\.xml$/i.test(rel)) {
      if (executionPlan.groupEnabled("mapperSql")) {
        checkMapperXml(content, rel, rawIssues, config.tenant.mode, config.softDelete, enabled);
      }
      if (executionPlan.groupEnabled("physicalDelete") || executionPlan.groupEnabled("writeSafety")) {
        checkUpdateDeleteWithoutWhere(content, rel, rawIssues, config.tenant.mode, config.softDelete, enabled);
      }
    }
    if (executionPlan.groupEnabled("service") && rel.endsWith(".java") && /(?:ServiceImpl|Service)\.java$/.test(rel)) {
      checkService(content, rel, rawIssues, enabled);
    }
    if (rel.endsWith(".java")) {
      if (executionPlan.groupEnabled("redisTtl")) checkRedisNoTtl(content, rel, rawIssues);
      if (executionPlan.groupEnabled("redisLock")) checkRedisSelfLock(content, rel, rawIssues);
      if (executionPlan.groupEnabled("redisDangerous")) checkRedisDangerousCommands(content, rel, rawIssues);
      if (executionPlan.groupEnabled("redisSerializer")) checkRedisJdkSerializer(content, rel, rawIssues);
      if (executionPlan.groupEnabled("physicalDelete")) checkPhysicalDelete(content, rel, rawIssues, config.softDelete);
      if (executionPlan.groupEnabled("writeSafety")) {
        checkJavaSqlWriteSafety(content, rel, rawIssues);
        checkWrapperWriteSafety(content, rel, rawIssues, config.tenant.mode);
      }
      if (executionPlan.groupEnabled("batchSize")) checkSaveBatchOversized(content, rel, rawIssues);
      if (executionPlan.groupEnabled("transactionBoundary")) checkTransactionalWithMqOrHttp(content, rel, rawIssues);
      if (executionPlan.groupEnabled("httpTimeout")) checkHttpNoTimeout(content, rel, rawIssues);
      if (executionPlan.groupEnabled("openApi")) checkSwaggerMixed(content, rel, rawIssues);
      if (executionPlan.groupEnabled("serviceDependencies")) checkServiceDependencies(content, rel, rawIssues);
      if (executionPlan.groupEnabled("javaTenant")) checkJavaTenantAccess(content, rel, rawIssues, config.tenant.mode);
      if (executionPlan.groupEnabled("sensitiveLog")) checkSensitiveToString(content, rel, rawIssues);
      if (executionPlan.groupEnabled("design")) checkDesign(content, rel, rawIssues, config.thresholds, enabled);
      if (executionPlan.groupEnabled("javadoc")) checkMethodJavadoc(content, rel, rawIssues);
    }
  }
  if (executionPlan.groupEnabled("methodSecurity")) checkMethodSecurityActivation(contents, rawIssues);
  if (executionPlan.groupEnabled("mapperDiscovery")) {
    checkMapperDiscoverability(contents, rawIssues);
    checkMapperResourceLocations(contents, rawIssues);
  }
  if (executionPlan.groupEnabled("managedDependencies")) checkParentManagedDependencyVersions(contents, rawIssues);
  if (executionPlan.groupEnabled("extensionBeans")) checkFrameworkExtensionBeanSafety(contents, rawIssues);
  if (executionPlan.groupEnabled("pagination")) checkPageDtoPagination(targetDir, contents, rawIssues);
  const endpoints = executionPlan.groupEnabled("endpoints") ? collectControllerEndpoints(contents) : [];
  if (executionPlan.groupEnabled("endpoints")) checkDuplicateControllerEndpoints(endpoints, rawIssues);
  if (executionPlan.groupEnabled("directoryDensity")) checkDirectoryDensity(targetDir, files, rawIssues, config.thresholds);

  // B31：需求文档表结构镜像（docs/db-spec）↔ 契约 源头一致性（豁免登记可追溯）
  if (executionPlan.groupEnabled("databaseSource")) {
    const dbSpec = require("./db-spec");
    const contractTables = collectContractTables(targetDir);
    const b31 = dbSpec.checkDocContractConsistency(targetDir, contractTables);
    for (const value of b31.issues) {
      rawIssues.push(issue("B31", value.file, value.line, value.col, value.message, { severity: value.severity }));
    }
    const codeTables = dbSpec.checkCodeTableReferences(targetDir);
    for (const value of codeTables.issues) {
      rawIssues.push(issue("B31", value.file, value.line, value.col, value.message, { severity: value.severity }));
    }
  }

  const issues = [];
  const suppressed = [];
  const ruleSet = options.rules && Array.isArray(options.rules) && options.rules.length > 0 ? new Set(options.rules) : null;
  for (const value of rawIssues) {
    if (!/^B\d+$/.test(value.rule)) {
      issues.push(value);
      continue;
    }
    if (ruleSet && !ruleSet.has(value.rule)) continue;
    if (value.rule === "B31") {
      issues.push(value);
      continue;
    }
    const fileExemption = exemptions.isExempt(value.file, value.rule);
    const inlineReason = inlineExemption(contents.get(value.file) || "", value);
    if (fileExemption || inlineReason) suppressed.push({ ...value, suppressionReason: inlineReason || fileExemption.reason });
    else issues.push(value);
  }
  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  suppressed.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const stats = {
    error: issues.filter((value) => value.severity === "error").length,
    warn: issues.filter((value) => value.severity === "warn").length,
    info: issues.filter((value) => value.severity === "info").length,
    total: issues.length,
    suppressed: suppressed.length,
    byRule: issues.reduce((acc, value) => { acc[value.rule] = (acc[value.rule] || 0) + 1; return acc; }, {}),
  };
  const { coverage, evaluatedRules, skippedRules } = executionPlan;
  const execution = {
    requestedRules: executionPlan.requestedRules,
    executedRules: evaluatedRules,
    executedGroups: executionPlan.groups,
    skippedRules,
    unknownRules: executionPlan.unknownRules,
    scan: scanContext.metrics,
  };
  return {
    schemaVersion: 1,
    targetDir,
    endpoints,
    issues,
    suppressed,
    stats,
    status: coverage.status,
    coverage,
    evaluatedRules,
    skippedRules,
    execution,
    durationMs: Date.now() - started,
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  checkHttpNoTimeout,
  checkPhysicalDelete,
  checkJavaSqlWriteSafety,
  checkMapperDiscoverability,
  checkMapperResourceLocations,
  checkFrameworkExtensionBeanSafety,
  checkParentManagedDependencyVersions,
  checkRedisDangerousCommands,
  checkRedisJdkSerializer,
  checkRedisNoTtl,
  checkRedisSelfLock,
  checkSaveBatchOversized,
  checkServiceDependencies,
  checkSwaggerMixed,
  checkTransactionalWithMqOrHttp,
  checkUpdateDeleteWithoutWhere,
  collectControllerEndpoints,
  loadConfig,
  loadExemptions,
  methodDeclarations,
  runBeRules,
  stripJava,
};
