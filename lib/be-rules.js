"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const catalog = require("../files/.wl-skills-bd/rules/catalog.json");
const { normalizeRel, resolveWithin } = require("./manifest");

const RULES = new Map(catalog.rules.filter((rule) => /^B\d+$/.test(rule.id)).map((rule) => [rule.id, rule]));
const DEFAULT_THRESHOLDS = Object.freeze({
  classLines: 500,
  methodLines: 80,
  cyclomaticComplexity: 10,
  directoryWarn: 20,
  directoryError: 30,
});
const SCANNED_EXTENSIONS = new Set([".java", ".xml"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function walk(root, current = root, output = []) {
  if (!fs.existsSync(current)) return output;
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (["target", "node_modules", ".git", ".git_disabled", ".idea", ".state"].includes(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(root, absolute, output);
    else if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

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
    const match = trimmed.match(/^((?:B(?:[1-9]|1[0-2]))|\*):([^#]+?)\s+#\s+(.{5,})$/);
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
  const result = { thresholds: { ...DEFAULT_THRESHOLDS }, tenant: { mode: "explicit" } };
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
  const allowed = new Set(["schemaVersion", "thresholds", "tenant"]);
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

function hasJavadoc(lines, methodStartLine) {
  let index = methodStartLine - 2;
  while (index >= 0 && (!lines[index].trim() || lines[index].trim().startsWith("@"))) index -= 1;
  if (index < 0 || !lines[index].includes("*/")) return false;
  while (index >= 0 && !lines[index].includes("/**")) index -= 1;
  return index >= 0;
}

function checkController(content, relFile, output) {
  if (!/class\s+\w*Controller\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  const classIndex = content.search(/class\s+\w*Controller\b/);
  const classAuthorized = classIndex >= 0 && /@PreAuthorize\b/.test(content.slice(0, classIndex));
  for (const method of methodDeclarations(content)) {
    if (method.visibility !== "public") continue;
    const annotations = annotationBlock(lines, method.startLine);
    if (!/@(?:Get|Post|Put|Delete|Patch)Mapping\b|@RequestMapping\b/.test(annotations)) continue;
    if (!classAuthorized && !/@PreAuthorize\b/.test(annotations)) {
      output.push(issue("B1", relFile, method.startLine, 1, `Controller 接口 ${method.name}() 缺 @PreAuthorize；公开接口必须用有理由的豁免登记`));
    }
    if (!/@Operation\b/.test(annotations)) {
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

const PHYSICAL_DELETE_REGEX = /\.(deleteBatchIds|deleteById|deleteByMap)\s*\(/g;
const SQL_DANGEROUS_RAW_REGEX = /\b(TRUNCATE\s+TABLE|DROP\s+TABLE)\b/gi;

function checkPhysicalDelete(content, relFile, output) {
  if (/class\s+\w*Controller\b/.test(content)) return;
  const offsets = lineOffsets(content);
  const scrubbed = stripJava(content);
  let match;
  while ((match = PHYSICAL_DELETE_REGEX.exec(scrubbed)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B17", relFile, pos.line, pos.col, `检测到 ${match[1]}()：业务代码禁止物理删除，团队基线软删 IS_DELETE=0；物理删须走独立运维契约 + DBA 双签`));
  }
  while ((match = SQL_DANGEROUS_RAW_REGEX.exec(content)) !== null) {
    const pos = lineAt(offsets, match.index);
    output.push(issue("B17", relFile, pos.line, pos.col, `检测到 ${match[1]}：业务代码禁止 TRUNCATE/DROP TABLE；DDL 走 standards/12，必须 db-migration + DBA 审批`));
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

function checkMapperXml(content, relFile, output, tenantMode) {
  const executable = stripXmlComments(content);
  const offsets = lineOffsets(executable);
  let match;
  const star = /\bSELECT\s+(?:DISTINCT\s+)?(?:[A-Za-z_][\w]*\.)?\*/gi;
  while ((match = star.exec(executable)) !== null) {
    const position = lineAt(offsets, match.index);
    output.push(issue("B3", relFile, position.line, position.col, "Mapper XML 的可执行 SQL 使用 SELECT 星号，必须显式列出字段"));
  }
  const substitution = /\$\{[^}]+\}/g;
  while ((match = substitution.exec(executable)) !== null) {
    const position = lineAt(offsets, match.index);
    output.push(issue("B4", relFile, position.line, position.col, `Mapper XML 使用文本替换 ${match[0]}；默认基线不允许任何 \${} SQL 片段`));
  }
  if (tenantMode === "interceptor") return;
  const selects = /<select\b[^>]*>([\s\S]*?)<\/select>/gi;
  while ((match = selects.exec(executable)) !== null) {
    const body = match[1];
    const hasTenantPredicate = /(?:\b\w+\.)?COMPANY_ID\s*=\s*#\{(?:[^}]*\.)?companyId\}/i.test(body);
    if (!hasTenantPredicate) {
      const position = lineAt(offsets, match.index);
      output.push(issue("B7", relFile, position.line, position.col, "SELECT 缺少 COMPANY_ID = #{companyId} 租户谓词，且未验证统一租户拦截器"));
    }
  }
}

function checkUpdateDeleteWithoutWhere(content, relFile, output) {
  const executable = stripXmlComments(content);
  const offsets = lineOffsets(executable);
  const updateOrDeleteTags = /<(update|delete)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = updateOrDeleteTags.exec(executable)) !== null) {
    const tag = match[1];
    const body = match[2];
    if (!/\bWHERE\b/i.test(body)) {
      const position = lineAt(offsets, match.index);
      output.push(issue("B18", relFile, position.line, position.col, `<${tag}> 标签缺少 WHERE 子句，存在全表写风险；必须带 WHERE + 租户谓词`));
    }
  }
}

function checkService(content, relFile, output) {
  if (!/class\s+\w*(?:ServiceImpl|Service)\b/.test(content)) return;
  const lines = content.split(/\r?\n/);
  const scrubbed = stripJava(content);
  const scrubbedLines = scrubbed.split(/\r?\n/);
  scrubbedLines.forEach((line, index) => {
    const match = line.match(/throw\s+new\s+(RuntimeException|Exception)\s*\(/);
    if (match) output.push(issue("B8", relFile, index + 1, match.index + 1, `业务层不得抛裸 ${match[1]}，应使用 ServiceAssert/受管业务异常`));
  });
  const classIndex = content.search(/class\s+\w*(?:ServiceImpl|Service)\b/);
  const classTransactional = classIndex >= 0 && /@Transactional\b/.test(content.slice(0, classIndex));
  for (const method of methodDeclarations(content)) {
    if (method.visibility !== "public") continue;
    const write = /^(save|insert|add|create|update|delete|remove|batch|submit|approve|reject|enable|disable|import|sync|release|close|cancel|withdraw|convert|changeStatus|publish|archive|restore|print|send|reset|assign|transfer|lock|unlock|audit|verify)/i.test(method.name);
    if (write && !classTransactional && !/@Transactional\b/.test(annotationBlock(lines, method.startLine))) {
      output.push(issue("B5", relFile, method.startLine, 1, `写用例 ${method.name}() 缺 @Transactional(rollbackFor = Exception.class)`));
    }
  }
}

function checkDesign(content, relFile, output, thresholds) {
  const lines = content.split(/\r?\n/);
  const type = content.match(/\b(class|interface|enum)\s+(\w+)/);
  if (type && lines.length > thresholds.classLines) {
    output.push(issue("B9", relFile, lineAt(lineOffsets(content), type.index).line, 1, `类型 ${type[2]} 共 ${lines.length} 行，超过 ${thresholds.classLines} 行基线`));
  }
  for (const method of methodDeclarations(content)) {
    const length = method.endLine - method.startLine + 1;
    if (length > thresholds.methodLines) output.push(issue("B10", relFile, method.startLine, 1, `方法 ${method.name}() 共 ${length} 行，超过 ${thresholds.methodLines} 行硬上限`));
    const decisions = (method.body.match(/\bif\s*\(/g) || []).length
      + (method.body.match(/\bfor\s*\(/g) || []).length
      + (method.body.match(/\bwhile\s*\(/g) || []).length
      + (method.body.match(/\bcase\b/g) || []).length
      + (method.body.match(/\bcatch\s*\(/g) || []).length
      + (method.body.match(/&&|\|\|/g) || []).length
      + (method.body.match(/\?[^:;]+:/g) || []).length;
    const complexity = 1 + decisions;
    if (complexity > thresholds.cyclomaticComplexity) output.push(issue("B11", relFile, method.startLine, 1, `方法 ${method.name}() 圈复杂度约 ${complexity}，超过 ${thresholds.cyclomaticComplexity}`));
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
  const exemptions = loadExemptions(targetDir);
  const config = loadConfig(targetDir);
  const rawIssues = [...exemptions.diagnostics, ...config.diagnostics];
  let files = [];
  try {
    if (options.stagedFiles && options.stagedFiles.length > 0) {
      files = options.stagedFiles.map((rel) => resolveWithin(targetDir, rel)).filter((file) => fs.existsSync(file));
    } else {
      const root = options.scanRel ? resolveWithin(targetDir, options.scanRel) : targetDir;
      files = walk(root);
    }
  } catch (error) {
    rawIssues.push(issue("WLS_CONFIG", ".", 1, 1, error.message));
  }

  const contents = new Map();
  for (const absolute of files) {
    const rel = normalizeRel(path.relative(targetDir, absolute));
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_FILE_BYTES) {
      rawIssues.push(issue("WLS_CONFIG", rel, 1, 1, `文件超过 ${MAX_FILE_BYTES} 字节扫描上限`));
      continue;
    }
    const content = fs.readFileSync(absolute, "utf8");
    contents.set(rel, content);
    if (rel.endsWith("Controller.java")) checkController(content, rel, rawIssues);
    if (rel.endsWith(".xml") && /(?:^|\/)mapper(?:\/|$)|Mapper\.xml$/i.test(rel)) {
      checkMapperXml(content, rel, rawIssues, config.tenant.mode);
      checkUpdateDeleteWithoutWhere(content, rel, rawIssues);
    }
    if (rel.endsWith(".java") && /(?:ServiceImpl|Service)\.java$/.test(rel)) checkService(content, rel, rawIssues);
    if (rel.endsWith(".java")) {
      checkRedisNoTtl(content, rel, rawIssues);
      checkRedisSelfLock(content, rel, rawIssues);
      checkRedisDangerousCommands(content, rel, rawIssues);
      checkRedisJdkSerializer(content, rel, rawIssues);
      checkPhysicalDelete(content, rel, rawIssues);
      checkSaveBatchOversized(content, rel, rawIssues);
      checkTransactionalWithMqOrHttp(content, rel, rawIssues);
      checkHttpNoTimeout(content, rel, rawIssues);
      checkSwaggerMixed(content, rel, rawIssues);
      checkServiceDependencies(content, rel, rawIssues);
    }
    if (!options.quick && rel.endsWith(".java")) {
      checkDesign(content, rel, rawIssues, config.thresholds);
      checkMethodJavadoc(content, rel, rawIssues);
    }
  }
  if (!options.stagedFiles) checkDirectoryDensity(targetDir, files, rawIssues, config.thresholds);

  const issues = [];
  const suppressed = [];
  const ruleSet = options.rules && Array.isArray(options.rules) && options.rules.length > 0 ? new Set(options.rules) : null;
  for (const value of rawIssues) {
    if (!/^B\d+$/.test(value.rule)) {
      if (!ruleSet) issues.push(value);
      continue;
    }
    if (ruleSet && !ruleSet.has(value.rule)) continue;
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
  return { schemaVersion: 1, targetDir, issues, suppressed, stats, durationMs: Date.now() - started };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  checkHttpNoTimeout,
  checkPhysicalDelete,
  checkRedisDangerousCommands,
  checkRedisJdkSerializer,
  checkRedisNoTtl,
  checkRedisSelfLock,
  checkSaveBatchOversized,
  checkServiceDependencies,
  checkSwaggerMixed,
  checkTransactionalWithMqOrHttp,
  checkUpdateDeleteWithoutWhere,
  loadConfig,
  loadExemptions,
  methodDeclarations,
  runBeRules,
  stripJava,
};
