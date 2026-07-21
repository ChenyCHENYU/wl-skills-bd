"use strict";

// 任务驱动路由核心：识别用户意图 → 任务类型 → skill 子集 + 规则子集 + 执行步骤。
// 本模块只负责确定性路由；所有写入统一进入 codegen/safe-fix/config 的计划、确认和回滚链。

const RULE_CATALOG = require("../files/.wl-skills-bd/rules/catalog.json");

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
    standards: ["01", "02", "04", "05", "06", "07", "08", "10", "11", "12", "13", "28"],
    ...taskRules("new-service"),
    steps: [
      "1. 评审需求 → 生成 wl-contract.json（含 customOperations/relations/alter 等扩展）",
      "2. codegen validate wl-contract.json（契约校验）",
      "3. codegen plan → 评审 17+N 产物（含 DDL 风险报告与命令 DTO）",
      "4. codegen apply --plan-hash <hash> --confirm",
      "5. validate src/main（B 规则）",
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
    standards: ["04", "05", "10", "11", "13", "28"],
    ...taskRules("add-api"),
    steps: [
      "1. 在 wl-contract.json 的 customOperations/relations/export 声明接口，不直接拼接 Java 文本",
      "2. codegen validate wl-contract.json（校验方法、路径、权限、请求与响应模型）",
      "3. codegen plan wl-contract.json --json，并人工评审 planHash 与目标文件差异",
      "4. codegen apply wl-contract.json --plan-hash <hash> --confirm",
      "5. 在 <wl-custom> 保护区补齐非确定性业务逻辑与对应测试",
      "6. validate <目标文件> --rules B1,B2,B5,B8,B12,B20,B24,B25（精准规则）",
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
    standards: ["06", "07", "12", "28"],
    ...taskRules("add-field"),
    steps: [
      "1. 在 wl-contract.json 增加 fields 与 alter.add/modify/drop，明确表、类型和回退策略",
      "2. codegen validate wl-contract.json",
      "3. db preview wl-contract.json，评审 ALTER、索引与 Expand-Contract 阶段",
      "4. codegen plan wl-contract.json --json，确认 Entity/DTO/VO/Mapper/DDL 的完整差异",
      "5. codegen apply wl-contract.json --plan-hash <hash> --confirm",
      "6. validate <目标模块> --rules B3,B4,B7,B18,B25（精准规则）",
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
    standards: ["05", "08", "10", "11", "28"],
    ...taskRules("add-business-cmd"),
    steps: [
      "1. 在 wl-contract.json 的 customOperations 声明命令、HTTP 语义、权限码、前置状态和 patch",
      "2. codegen validate/plan，人工评审 Controller、Service、测试与协作契约差异",
      "3. codegen apply --plan-hash <hash> --confirm",
      "4. 在 <wl-custom> 保护区补齐无法确定生成的四段式业务逻辑与 ServiceTest",
      "5. validate <目标文件> --rules B5,B8,B17,B20,B24,B25（精准规则）",
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
    standards: ["05", "08", "10", "17"],
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
    standards: ["02", "05", "15", "16", "17", "19", "28"],
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
    standards: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28"],
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

function detectTask(userInput) {
  if (!userInput || typeof userInput !== "string") return null;
  const lower = userInput.toLowerCase();
  const scores = {};
  for (const id of TASK_IDS) {
    const task = TASK_TYPES[id];
    let score = 0;
    // 1. 整词匹配
    for (const trigger of task.triggers) {
      const t = trigger.toLowerCase();
      if (lower.includes(t)) score += t.length >= 3 ? 3 : 2;
    }
    // 2. 关键词组合匹配（动词×名词）
    const matrix = KEYWORD_MATRIX[id];
    if (matrix) {
      const verbHit = matrix.verbs.some((v) => lower.includes(v.toLowerCase()));
      const nounHit = matrix.nouns.some((n) => lower.includes(n.toLowerCase()));
      if (verbHit && nounHit) score += 4;
      else if (verbHit || nounHit) score += 1;
    }
    if (score > 0) scores[id] = score;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const [topId, topScore] = sorted[0];
  return { task: TASK_TYPES[topId], score: topScore, candidates: sorted.slice(0, 3).map(([id, s]) => ({ id, score: s, name: TASK_TYPES[id].name })) };
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

function formatTaskPlan(task, options = {}) {
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
    "⚙️ 执行步骤：",
    ...task.steps,
    "",
    "🛠 可用工具：",
    `  ${task.tools.join(", ")}`,
  ];
  if (options.targetFile) lines.splice(2, 0, `目标：${options.targetFile}`);
  return lines.join("\n");
}

module.exports = {
  TASK_IDS,
  TASK_TYPES,
  buildJavaGateSubset,
  buildRuleSubset,
  buildScopeFilter,
  detectTask,
  formatTaskPlan,
  getTask,
  listTasks,
};
