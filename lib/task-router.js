"use strict";

// 任务驱动路由核心：识别用户意图 → 任务类型 → skill 子集 + 规则子集 + 执行步骤。
// 本模块只负责确定性路由；所有写入统一进入 codegen/safe-fix/config 的计划、确认和回滚链。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RULE_CATALOG = require("../files/.wl-skills-bd/rules/catalog.json");
const { planPipeline } = require("./pipeline");

const PACKAGE_STANDARDS_ROOT = path.join(__dirname, "..", "files", ".github", "standards");
const PACKAGE_SKILLS_ROOT = path.join(__dirname, "..", "files", ".github", "skills");

function taskRules(taskId) {
  const mapping = RULE_CATALOG.taskRuleMapping[taskId];
  return {
    rules: mapping.rules.slice(),
    javaGates: mapping.javaGates.slice(),
  };
}

const TASK_TYPES = {
  "new-service": {
    id: "new-service",
    name: "新开发完整后端服务",
    mode: "full",
    triggers: ["新开发", "新建服务", "全套CRUD", "全套 crud", "生成完整", "新接口模块", "新业务", "从零开始", "脚手架"],
    skills: ["api-design-be", "entity-codegen", "service-codegen", "mapper-xml-gen", "db-migration", "convention-audit-be"],
    standards: ["01", "02", "04", "05", "06", "07", "08", "10", "11", "12", "13", "14", "28", "29"],
    ...taskRules("new-service"),
    steps: [
      "1. 先建立 docs/db-spec 文档镜像；优先原名复用基线表，扩展须登记依据并追加在末尾",
      "2. 生成 wl-contract.json，并执行 codegen validate（含 B31 数据库事实源门禁）",
      "3. codegen plan → 评审 17+N 产物（含 DDL 风险报告与命令 DTO）",
      "4. codegen apply --plan-hash <hash> --confirm",
      "5. validate src/main（B1~B32，含退役表引用与跨服务 DTO 反序列化检查）",
      "6. mvn verify -Pwl-quality（J 规则）",
      "7. contract diff --frontend/--openapi（协作核对）",
      "8. permissions export（权限码搬运到 kit）",
    ],
    requiresContract: true,
    tools: ["codegen", "validate", "contract", "permissions"],
  },
  "add-api": {
    id: "add-api",
    name: "加一个接口/方法",
    mode: "incremental-contract",
    triggers: ["加接口", "加方法", "加一个", "新增接口", "加个api", "加查询", "加导出", "补接口", "追加方法", "加个 controller"],
    skills: ["service-codegen"],
    standards: ["04", "05", "07", "10", "11", "13", "14", "28", "29"],
    ...taskRules("add-api"),
    steps: [
      "1. 在 wl-contract.json 的 customOperations/relations/export 声明接口，不直接拼接 Java 文本",
      "2. codegen validate wl-contract.json（校验方法、路径、权限、请求与响应模型）",
      "3. codegen plan wl-contract.json --json，并人工评审 planHash 与目标文件差异",
      "4. codegen apply wl-contract.json --plan-hash <hash> --confirm",
      "5. 在 <wl-custom> 保护区补齐非确定性业务逻辑与对应测试",
      "6. validate <目标文件> --rules B1,B2,B5,B8,B12,B20,B24,B25,B26,B30,B31,B32（含数据库事实源与 JSON DTO 门禁）",
      "7. contract diff --strict 核对 kit/OpenAPI/权限与 completion",
    ],
    requiresContract: false,
    tools: ["codegen", "validate", "contract"],
  },
  "add-field": {
    id: "add-field",
    name: "加字段落库",
    mode: "incremental-contract",
    triggers: ["加字段", "落库", "加列", "加属性", "加个字段", "表加字段", "entity加字段", "alter", "加一列"],
    skills: ["entity-codegen", "mapper-xml-gen", "db-migration"],
    standards: ["06", "07", "12", "28", "29"],
    ...taskRules("add-field"),
    steps: [
      "1. 先更新 docs/db-spec；文档基线字段保持原序，获批扩展字段登记后只能追加在末尾",
      "2. codegen validate wl-contract.json",
      "3. db preview wl-contract.json，评审 ALTER、索引与 Expand-Contract 阶段",
      "4. codegen plan wl-contract.json --json，确认 Entity/DTO/VO/Mapper/DDL 的完整差异",
      "5. codegen apply wl-contract.json --plan-hash <hash> --confirm",
      "6. validate <目标模块> --rules B3,B4,B7,B18,B25,B26,B31（含数据库事实源门禁）",
      "7. 由 DBA/CD 审批并执行 DDL；工具不连接数据库、不自动执行迁移",
    ],
    requiresContract: false,
    tools: ["codegen", "validate", "db"],
  },
  "add-business-cmd": {
    id: "add-business-cmd",
    name: "加业务命令/状态机",
    mode: "incremental-contract",
    triggers: ["加业务命令", "状态机", "加submit", "加approve", "加审批", "加状态变更", "加业务动作", "加工作流", "submit", "approve", "withdraw"],
    skills: ["service-codegen"],
    standards: ["05", "08", "10", "11", "28", "29"],
    ...taskRules("add-business-cmd"),
    steps: [
      "1. 在 wl-contract.json 的 customOperations 声明命令、HTTP 语义、权限码、前置状态和 patch",
      "2. codegen validate/plan，人工评审 Controller、Service、测试与协作契约差异",
      "3. codegen apply --plan-hash <hash> --confirm",
      "4. 在 <wl-custom> 保护区补齐无法确定生成的四段式业务逻辑与 ServiceTest",
      "5. validate <目标文件> --rules B5,B8,B17,B20,B24,B25,B26（精准规则）",
      "6. contract diff --strict，completion confirmed 后才允许交付",
    ],
    requiresContract: false,
    tools: ["codegen", "validate", "contract"],
  },
  "fix-bug": {
    id: "fix-bug",
    name: "修 bug/修复问题",
    mode: "fix",
    triggers: ["改bug", "修复", "fix", "修问题", "改错了", "报错", "异常", "不工作", "失败", "空指针", "npe"],
    skills: ["code-fix-be", "convention-audit-be"],
    standards: ["05", "07", "08", "10", "14", "17", "29"],
    ...taskRules("fix-bug"),
    steps: [
      "1. 定位 bug（用户描述 + 错误堆栈 + 涉及文件）",
      "2. 用 troubleshoot \"<错误关键字>\" 匹配诊断树",
      "3. 精准修复（最小改动原则，不顺手重构）",
      "4. validate <涉及文件> --rules <定向规则>（精准规则）",
      "5. 如涉及 B3/B5：fix plan/apply --rules B3,B5（安全修复）",
      "6. 复扫验证：validate <涉及文件> 确认 error 清零",
      "7. 必要时跑相关单元测试",
    ],
    requiresContract: false,
    tools: ["validate", "fix", "troubleshoot"],
  },
  "refactor": {
    id: "refactor",
    name: "重构/优化",
    mode: "fix",
    triggers: ["重构", "优化", "refactor", "拆分", "整理", "清理", "性能优化", "代码质量"],
    skills: ["code-fix-be", "convention-audit-be"],
    standards: ["02", "05", "15", "16", "17", "19", "28", "29"],
    ...taskRules("refactor"),
    steps: [
      "1. 确认重构目标（拆类/提方法/消除坏味道）",
      "2. 重构前先 validate 建基线",
      "3. 最小步重构（每步可编译可测试）",
      "4. validate src/main（全量 B 规则）",
      "5. mvn verify -Pwl-quality（J 规则）",
      "6. 对比重构前后 error 数（应不增加）",
    ],
    requiresContract: false,
    tools: ["validate", "fix"],
  },
  "audit": {
    id: "audit",
    name: "审计/体检",
    mode: "readonly",
    triggers: ["审计", "体检", "检查", "扫描", "review", "code review", "质量检查", "规范检查", "audit"],
    skills: ["convention-audit-be"],
    standards: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29"],
    ...taskRules("audit"),
    steps: [
      "1. doctor（环境/JDK/Maven/Profile/质量门/租户/契约覆盖/配置）",
      "2. validate src/main --format sarif --output reports/backend.sarif",
      "3. mvn verify -Pwl-quality（J 规则）",
      "4. 按规则汇总 error/warning",
      "5. 输出整改建议（哪些走 fix 自动修，哪些人工）",
    ],
    requiresContract: false,
    tools: ["doctor", "validate"],
  },
  "config-op": {
    id: "config-op",
    name: "配置/环境/部署",
    mode: "config",
    triggers: ["配置", "环境", "部署", "nacos", "redis", "数据库连接", "启动不了", "k8s", "迁移", "切环境", "连不上", "yaml"],
    skills: ["data-safety", "standard-env-config-be"],
    standards: ["24", "25", "28"],
    ...taskRules("config-op"),
    steps: [
      "1. config doctor（L0~L8 配置体检）",
      "2. config doctor --probe（DB/Redis/Nacos 连通性）",
      "3. config fix（明文密码修复）",
      "4. troubleshoot \"<错误>\"（故障诊断）",
      "5. config migrate --to <customer>（客户迁移）",
    ],
    requiresContract: false,
    tools: ["config", "troubleshoot"],
  },
  "generate-tests": {
    id: "generate-tests",
    name: "生成行为契约测试",
    mode: "readonly",
    triggers: ["生成单元测试", "生成单测", "补覆盖率", "controller 测试", "mock 测试", "行为契约测试", "单测"],
    skills: ["unit-test-gen"],
    standards: ["14"],
    ...taskRules("generate-tests"),
    steps: ["1. 读取目标 Service/Controller 与契约，列出正常、边界、异常场景", "2. test scenarios/gen 只生成计划或骨架；实际生成仍需现有写入确认", "3. 执行 mvn verify -Pwl-quality，报告 J8 实测覆盖率"],
    requiresContract: false,
    tools: ["test", "validate"],
  },
  "integration-adapter": {
    id: "integration-adapter",
    name: "MQ/HTTP 集成适配",
    mode: "readonly",
    triggers: ["mq 对接", "接入 mq", "消息封装", "producer", "consumer", "集成适配", "集成质量门"],
    skills: ["integration-adapter-be"],
    standards: ["22", "30"],
    ...taskRules("integration-adapter"),
    steps: ["1. integration adapters 检查项目真实描述符与绑定；缺失时报告 not-configured", "2. integration plan 评审 recipe、模板边界和变量", "3. integration apply 仅按 planHash + --confirm 确认链新增文件", "4. 执行真实适配检查与编译/测试，运行证据另行核验"],
    requiresContract: false,
    tools: ["integration", "review"],
  },
  "project-context": {
    id: "project-context",
    name: "模块上下文治理",
    mode: "readonly",
    triggers: ["模块上下文", "查关联服务", "生成前去重", "刷新项目目录", "避免全仓扫描", "上下文治理"],
    skills: ["project-context-governance"],
    standards: ["27"],
    ...taskRules("project-context"),
    steps: ["1. catalog plan/apply 按模块与 planHash + --confirm 刷新事实快照", "2. context plan 只读取当前模块与一跳快照", "3. catalog check 核对身份与新鲜度；不得扩大扫描预算"],
    requiresContract: false,
    tools: ["catalog", "context"],
  },
  "extract-business-doc": {
    id: "extract-business-doc",
    name: "反向抽取业务文档",
    mode: "readonly",
    triggers: ["抽取业务文档", "业务理解", "接手陌生模块", "整理业务文档", "业务说明", "这模块业务是啥"],
    skills: ["business-doc-extract-be"],
    standards: ["02"],
    ...taskRules("extract-business-doc"),
    steps: ["1. 读取目标模块源码、表注释和旧文档，记录来源", "2. Skill 为骨架；语义抽取和业务确认尚无确定性执行器", "3. 列出待确认项，禁止把推断当业务事实"],
    requiresContract: false,
    tools: ["context"],
  },
  "data-safety": {
    id: "data-safety",
    name: "数据与缓存安全",
    mode: "readonly",
    triggers: ["缺 ttl", "没有 ttl", "缓存安全", "数据安全", "物理删除", "全表删除", "分布式锁", "flushdb", "flushall"],
    skills: ["data-safety"],
    standards: ["20", "21"],
    ...taskRules("data-safety"),
    steps: ["1. validate 按数据安全规则扫描目标代码，记录实际覆盖", "2. 评审数据与缓存风险；修复走现有 plan/confirm 链", "3. 复扫确认问题关闭，数据库执行由独立运维审批"],
    requiresContract: false,
    tools: ["validate", "fix"],
  },
};

const TASK_IDS = Object.keys(TASK_TYPES);

// 关键词组合矩阵：动词组 × 名词组，输入同时命中动词和名词即加分（解决中文"加个查询接口"类断词）
const KEYWORD_MATRIX = {
  "new-service": { verbs: ["新开发", "新建", "新建服务", "生成完整", "从零", "脚手架", "全套"], nouns: ["服务", "crud", "模块", "业务", "工程", "接口模块"] },
  "add-api": { verbs: ["加", "新增", "补", "追加", "写", "增加", "添加"], nouns: ["接口", "方法", "api", "controller", "查询", "导出", "保存", "删除", "修改"] },
  "add-field": { verbs: ["加", "新增", "增加", "添加", "补", "落"], nouns: ["字段", "列", "属性", "库", "表", "entity", "alter"] },
  "add-business-cmd": { verbs: ["加", "新增", "增加", "添加", "实现", "写"], nouns: ["业务命令", "状态机", "submit", "approve", "审批", "状态变更", "业务动作", "工作流", "withdraw", "拒绝", "reject"] },
  "fix-bug": { verbs: ["改", "修", "修复", "fix", "解决", "处理"], nouns: ["bug", "问题", "错", "异常", "报错", "不工作", "失败", "空指针", "npe", "bug"] },
  "refactor": { verbs: ["重构", "优化", "refactor", "拆分", "整理", "清理"], nouns: ["代码", "质量", "性能", "结构", "类", "方法"] },
  "audit": { verbs: ["审计", "体检", "检查", "扫描", "review", "audit", "规范检查", "质量检查"], nouns: ["代码", "规范", "质量", "项目", "工程"] },
  "config-op": { verbs: ["配置", "环境", "部署", "迁移", "切换", "连不上", "连不了", "启动不了", "起不来", "k8s"], nouns: ["nacos", "redis", "数据库", "db", "环境", "yaml", "yml", "配置", "k8s"] },
};

const ROUTING_POLICY = { minimumScore: 3, minimumMargin: 2 };
const BACKEND_DOMAIN = /后端|java|spring|maven|mybatis|controller|service|mapper|数据库|redis|nacos|mq|kafka|rocketmq|sql|crud|接口|字段|单测|单元测试|覆盖率|业务|模块上下文|上下文治理|项目目录|代码|配置|部署|缓存|ttl|事务|租户/i;
const FOREIGN_DOMAIN = /vue|react|前端|页面|组件|css|样式|原型|流程图|泳道图|设计说明书|天气|旅游|翻译|写诗|菜谱|股票|图片/i;

function phraseHit(text, phrase) {
  const value = phrase.toLowerCase();
  let index = text.indexOf(value);
  while (index !== -1) {
    const before = text.slice(Math.max(0, index - 24), index);
    const after = text[index + value.length] || "";
    const boundary = !/^[a-z0-9_-]+$/i.test(value) || !/[a-z0-9_-]/i.test((text[index - 1] || "") + after);
    const negated = /(?:不要|不用|无需|禁止|别|不是|不做|do not|don't|without)(?:生成|创建|做|进行)?\s*$/i.test(before);
    if (boundary && !negated) return true;
    index = text.indexOf(value, index + value.length);
  }
  return false;
}

function classifyTask(userInput, explicitType, context = {}) {
  const text = typeof userInput === "string" ? userInput.normalize("NFKC").toLowerCase().trim() : "";
  if (explicitType) {
    const task = getTask(explicitType);
    return { status: task ? "matched" : "gap", task, candidates: [], reasons: [task ? "explicit-task-type" : "unknown-task-type"], policy: ROUTING_POLICY };
  }
  const targetEvidence = (context.targets || []).some((file) => /\.java$|(?:^|\/)pom\.xml$|mapper[^/]*\.xml$/i.test(file));
  const backendEvidence = /后端|java|spring|maven|mybatis|mapper|redis|nacos|kafka|rocketmq|outbox|幂等|重试|重抛|投递|集成可靠性/i.test(text) || targetEvidence;
  const related = BACKEND_DOMAIN.test(text) || backendEvidence;
  if (FOREIGN_DOMAIN.test(text) && !backendEvidence) {
    return { status: "not-applicable", task: null, candidates: [], reasons: ["outside-backend-domain"], policy: ROUTING_POLICY };
  }
  const commentsOnly = /注释|javadoc|职责说明/i.test(text) && !/新增.*接口|实现.*(?:接口|功能|逻辑)|修复.*(?:bug|故障|异常)|重构|创建.*(?:服务|模块)/i.test(text);
  if (backendEvidence && commentsOnly) {
    const baseline = { ...TASK_TYPES.audit, name: "后端注释基础约束", skills: [], standards: ["03", "19"], rules: ["B12"], javaGates: ["J2"],
      steps: ["1. 根据真实模块、业务边界与调用关系补充职责说明，缺少事实单独报告", "2. validate <实际文件> --rules B12 --run-id <id>；格式检查另跑 J2", "3. status --run-id <id> 核对真实覆盖与未验证的语义"], tools: ["validate"], baselineKind: "comments" };
    return { status: "baseline", task: baseline, candidates: [], reasons: ["backend-comment-baseline", "semantic-comment-review-not-proven-by-static-check"], policy: ROUTING_POLICY };
  }
  if (phraseHit(text, "抽取业务文档") || phraseHit(text, "整理业务文档")) {
    return { status: "matched", task: getTask("extract-business-doc"), candidates: [], reasons: ["explicit-business-document-intent"], policy: ROUTING_POLICY };
  }
  if (backendEvidence && /outbox|集成|抛送|投递|\bmq\b|\bhttp\b/i.test(text) && /审查|审计|核对|梳理|可靠性|幂等|重试|重抛|边界|质量门/i.test(text)) {
    return { status: "matched", task: getTask("integration-adapter"), candidates: [], reasons: ["backend-integration-review-intent"], policy: ROUTING_POLICY };
  }
  const candidates = TASK_IDS.map((id) => {
    const task = TASK_TYPES[id];
    const hits = task.triggers.filter((t) => phraseHit(text, t));
    let score = hits.reduce((n, t) => n + (t.length >= 3 ? 3 : 2), 0);
    const matrix = KEYWORD_MATRIX[id];
    if (matrix) {
      const verbHit = matrix.verbs.some((v) => phraseHit(text, v));
      const nounHit = matrix.nouns.some((n) => phraseHit(text, n));
      score += verbHit && nounHit ? 4 : verbHit || nounHit ? 1 : 0;
    }
    // 缓存行为风险由 data-safety 负责，连接/环境问题仍交给 config-op。
    if (id === "fix-bug" && /检查|审计/.test(text) && /修复|fix/.test(text)) score += 3;
    if (id === "data-safety" && /redis|缓存/.test(text) && /ttl|锁|flush|序列化/.test(text)) score += 8;
    return { id, name: task.name, score, hits };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const first = candidates[0];
  const second = candidates[1];
  if (first && first.score >= ROUTING_POLICY.minimumScore) {
    if (second && first.score - second.score < ROUTING_POLICY.minimumMargin) return { status: "ambiguous", task: null, candidates: candidates.slice(0, 5), reasons: ["insufficient-score-margin"], policy: ROUTING_POLICY };
    return { status: "matched", task: getTask(first.id), score: first.score, candidates: candidates.slice(0, 5), reasons: ["trigger-threshold-and-margin-satisfied"], policy: ROUTING_POLICY };
  }
  if ((backendEvidence || targetEvidence) && /开发|修改|改动|实现|代码/.test(text) && !/未知|不支持/.test(text)) return { status: "baseline", task: getTask("audit"), candidates, reasons: ["backend-baseline-rules-only", "specific-skill-unresolved"], policy: ROUTING_POLICY };
  return { status: related ? "gap" : "needs-context", task: null, candidates, reasons: [related ? "related-task-without-covered-route" : "insufficient-task-context"], policy: ROUTING_POLICY };
}

function detectTask(userInput) {
  const result = classifyTask(userInput);
  return result.status === "matched" ? { task: result.task, score: result.score, candidates: result.candidates } : null;
}

function getTask(taskId) {
  return TASK_TYPES[taskId] || null;
}

function listTasks() {
  return TASK_IDS.map((id) => ({
    id,
    name: TASK_TYPES[id].name,
    mode: TASK_TYPES[id].mode,
    triggerExamples: TASK_TYPES[id].triggers.slice(0, 4),
    ruleCount: TASK_TYPES[id].rules.length,
    skillCount: TASK_TYPES[id].skills.length,
    requiresContract: TASK_TYPES[id].requiresContract,
  }));
}

function buildRuleSubset(taskId) {
  const task = getTask(taskId);
  if (!task) return [];
  return task.rules;
}

function buildJavaGateSubset(taskId) {
  const task = getTask(taskId);
  if (!task) return [];
  return task.javaGates;
}

function buildScopeFilter(taskId) {
  const task = getTask(taskId);
  if (!task) return null;
  return { rules: task.rules, javaGates: task.javaGates, skills: task.skills, standards: task.standards };
}

// Pre-flight 证据：把任务要求的 standards/skills 变成可校验的文件清单（路径 + sha256）。
// 哈希证明工具可定位文件及其内容版本，不证明模型发现、选中或读取了文件。
function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function regularCanonical(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return null;
  if (fs.realpathSync(root) !== path.resolve(root)) return null;
  // canonical 路径及其祖先不得借符号链接读取另一包或项目外内容。
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) return null;
  }
  return fs.statSync(file).isFile() ? file : null;
}

function locateStandards(root, id) {
  const canonicalName = fs.readdirSync(PACKAGE_STANDARDS_ROOT).find((file) => file.startsWith(`${id}-`) && file.endsWith(".md"));
  return canonicalName ? regularCanonical(root, canonicalName) : null;
}

function locateSkill(root, name) {
  for (const category of fs.readdirSync(PACKAGE_SKILLS_ROOT, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const relative = path.join(category.name, name, "SKILL.md");
    if (fs.existsSync(path.join(PACKAGE_SKILLS_ROOT, relative))) return regularCanonical(root, relative);
  }
  return null;
}

function buildPreflightEvidence(taskId, projectRootInput) {
  const task = typeof taskId === "object" ? taskId : getTask(taskId);
  if (!task) return null;
  taskId = task.id;
  const installed = Boolean(projectRootInput);
  const root = installed ? (fs.existsSync(projectRootInput) ? fs.realpathSync(projectRootInput) : path.resolve(projectRootInput)) : null;
  const standardsRoot = installed ? path.join(root, ".github", "standards") : PACKAGE_STANDARDS_ROOT;
  const skillsRoot = installed ? path.join(root, ".github", "skills") : PACKAGE_SKILLS_ROOT;
  const standards = task.standards.map((id) => {
    const file = locateStandards(standardsRoot, id);
    if (!file) return { id, file: null, state: "missing" };
    const rel = installed ? path.relative(root, file).replace(/\\/g, "/") : `files/.github/standards/${path.basename(file)}`;
    return { id, file: rel, sha256: hashFile(file), state: "present" };
  });
  const skills = task.skills.map((name) => {
    const file = locateSkill(skillsRoot, name);
    if (!file) return { name, file: null, state: "missing" };
    const rel = installed ? path.relative(root, file).replace(/\\/g, "/") : `files/.github/skills/${path.relative(PACKAGE_SKILLS_ROOT, file).replace(/\\/g, "/")}`;
    return { name, file: rel, sha256: hashFile(file), state: "present" };
  });
  const digestSource = JSON.stringify({ taskId, standards, skills });
  return {
    taskId,
    source: installed ? "project" : "package",
    evidenceKind: "file-snapshot",
    modelRead: "unverified",
    ready: !standards.some((item) => item.state === "missing") && !skills.some((item) => item.state === "missing"),
    standardsTotal: standards.length,
    standardsMissing: standards.filter((item) => item.state === "missing").length,
    skillsTotal: skills.length,
    skillsMissing: skills.filter((item) => item.state === "missing").length,
    preflightHash: crypto.createHash("sha256").update(digestSource).digest("hex"),
    standards,
    skills,
  };
}

function buildTaskPipeline(taskId) {
  const task = typeof taskId === "object" ? taskId : getTask(taskId);
  if (!task) return null;
  const readonly = task.mode === "readonly";
  const nodes = [
    { id: "discover", kind: "discover", maxRetries: 1, timeoutMs: 15000, outputContract: "project-slice@1" },
    { id: "context", kind: "context", dependsOn: ["discover"], maxRetries: 1, timeoutMs: 15000, outputContract: "context-plan@1" },
    { id: "validate", kind: "validate", dependsOn: ["context"], maxRetries: 1, timeoutMs: 30000, outputContract: "validation-result@1" },
  ];
  if (readonly) {
    nodes.push({ id: "verify", kind: "verify", dependsOn: ["validate"], maxRetries: 1, timeoutMs: 60000, outputContract: "assurance-result@1" });
  } else {
    nodes.push(
      { id: "plan", kind: "plan", dependsOn: ["validate"], maxRetries: 1, timeoutMs: 30000, outputContract: "write-plan@1" },
      { id: "approval", kind: "approval", dependsOn: ["plan"], requiresConfirmation: true, outputContract: "approval@1" },
      { id: "apply", kind: "apply", dependsOn: ["approval"], sideEffect: "local-write", requiresConfirmation: true, outputContract: "apply-result@1" },
      { id: "verify", kind: "verify", dependsOn: ["apply"], maxRetries: 1, timeoutMs: 60000, outputContract: "assurance-result@1" },
    );
  }
  return planPipeline({ id: `${task.id}-pipeline`, nodes });
}

function formatTaskPlan(task, options = {}) {
  const pipeline = buildTaskPipeline(task.id);
  const lines = [
    `🎯 任务类型：${task.name}（${task.id}）`,
    `模式：${task.mode}${task.requiresContract ? "（需要 wl-contract.json）" : ""}`,
    "",
    "📋 涉及 Skill：",
    ...task.skills.map((s) => `  - ${s}`),
    "",
    "📖 必读 Standards：",
    `  ${task.standards.join(", ")}`,
    "",
    `🔍 必跑规则子集（${task.rules.length} 条）：`,
    `  ${task.rules.join(", ") || "（配置类，由 config doctor 兜底）"}`,
    "",
    `🏗 Java 质量门：${task.javaGates.join(", ") || "（无额外 Maven 门）"}`,
    "",
    "⚙️ 计划步骤（尚未执行）：",
    ...task.steps,
    "",
    "🛠 可用工具：",
    `  ${task.tools.join(", ")}`,
    "",
    "🧭 计划节点（尚未执行）：",
    `  ${pipeline.nodes.map((node) => node.id).join(" → ")}`,
    `  pipelineHash: ${pipeline.pipelineHash}`,
    "",
    "🔐 文件快照（可定位和哈希；模型是否读取尚未验证）：",
    `  使用 wl-skills-bd task --type ${task.id} --json 或 MCP wls_be_task 获取 preflight.preflightHash 与文件哈希清单`,
  ];
  if (options.targetFile) lines.splice(2, 0, `目标：${options.targetFile}`);
  return lines.join("\n");
}

module.exports = {
  ROUTING_POLICY,
  classifyTask,
  TASK_IDS,
  TASK_TYPES,
  buildJavaGateSubset,
  buildPreflightEvidence,
  buildRuleSubset,
  buildScopeFilter,
  buildTaskPipeline,
  detectTask,
  formatTaskPlan,
  getTask,
  listTasks,
};
