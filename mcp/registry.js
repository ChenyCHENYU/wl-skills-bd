"use strict";

const fs = require("fs");
const path = require("path");
const { handleValidate } = require("./tools/beRulesTools");
const { handleCatalog, handleCodegen, handleCommit, handleConfig, handleContext, handleContract, handleDbPreview, handleDoctor, handleExportPermissions, handleFix, handleReview, handleTask, handleTest, handleTroubleshoot } = require("./tools/lifecycleTools");
const capabilities = require("../files/.wl-skills-bd/capabilities.json");
const { withResponseControls } = require("./result-budget");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const STANDARDS_ROOT = path.join(PACKAGE_ROOT, "files", ".github", "standards");
const TEMPLATES_ROOT = path.join(PACKAGE_ROOT, "files", ".github", "templates");
const TEMPLATE_MAP = Object.freeze({
  Entity: "Entity.java.tmpl",
  CreateDTO: "CreateDTO.java.tmpl",
  UpdateDTO: "UpdateDTO.java.tmpl",
  PageDTO: "PageDTO.java.tmpl",
  VO: "VO.java.tmpl",
  PageVO: "PageVO.java.tmpl",
  Controller: "Controller.java.tmpl",
  Service: "Service.java.tmpl",
  "Mapper.java": "Mapper.java.tmpl",
  "Mapper.xml": "Mapper.xml.tmpl",
  Migration: "Migration.sql.tmpl",
  Rollback: "Rollback.md.tmpl",
  ServiceTest: "ServiceTest.java.tmpl",
  ControllerTest: "ControllerTest.java.tmpl",
  OperationRequestDTO: "OperationRequestDTO.java.tmpl",
  DdlPreview: "DdlPreview.md.tmpl",
});

const validateTool = {
  name: "wls_be_validate",
  description: `只读扫描后端工程 ${capabilities.backendRules.displayRange}；规则子集在扫描前短路，默认返回摘要，quick/staged/changed 会明确标记 partial 覆盖。`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "项目内相对扫描路径" },
      quick: { type: "boolean", description: "跳过 B9~B12 设计级检查" },
      rules: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: capabilities.backendRules.ids } },
      severity: { type: "string", enum: ["error", "warn", "info"] },
      maxIssues: { type: "integer", minimum: 0, maximum: 500, description: "兼容参数；优先使用 maxItems" },
      includeEndpoints: { type: "boolean", description: "显式返回完整 Controller 端点；默认仅返回数量" },
      staged: { type: "boolean", description: "只扫描 git 暂存文件；跨文件规则会标记为 partial" },
      changed: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "显式指定变更文件相对路径；优先于 staged" },
      detail: { type: "string", enum: ["summary", "compact", "full"], description: "summary 仅计数；compact 带定位；full 追加完整消息" },
      maxItems: { type: "integer", minimum: 1, maximum: 500, description: "返回的问题/端点上限，默认 20" },
      maxBytes: { type: "integer", minimum: 4096, maximum: 200000, description: "text 输出字节上限，默认 20000" },
    },
    additionalProperties: false,
  },
  handle: handleValidate,
};

const reviewTool = {
  name: "wls_be_review",
  description: "变更级审查总控与平台适配闭环：统一 B 规则、项目质量断言、MQ/集成适配、Maven 供应链、JaCoCo 全量/变更行覆盖率及分级修复。平台语义只来自项目描述符；apply 均要求 planHash + confirmApply。",
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["run", "baseline-plan", "baseline-apply", "adapter-inspect", "adapter-plan", "adapter-apply", "assertion-inspect", "assertion-plan", "assertion-apply", "repair-advise", "supply-chain"] },
      base: { type: "string", minLength: 1, description: "run：Git 比较基线，如 origin/main" },
      staged: { type: "boolean", description: "run：只评审暂存变更" },
      module: { type: "string", minLength: 1 },
      quick: { type: "boolean" },
      rules: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: capabilities.backendRules.ids } },
      limit: { type: "integer", minimum: 1, maximum: 500 },
      binding: { type: "string", minLength: 1 },
      recipe: { type: "string", minLength: 1 },
      variables: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
      assertions: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^[A-Z][A-Z0-9_-]{2,63}$" } },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      allowProductionWrites: { type: "boolean" },
    },
    allOf: [
      { if: { properties: { mode: { enum: ["adapter-plan", "adapter-apply"] } } }, then: { required: ["binding", "recipe"] } },
      { if: { properties: { mode: { enum: ["baseline-apply", "adapter-apply", "assertion-apply"] } } }, then: { required: ["planHash", "confirmApply"] } }
    ],
    additionalProperties: false,
  },
  handle: handleReview,
};

const doctorTool = {
  name: "wls_be_doctor",
  description: "只读检查 JDK/Maven、兼容性 Profile、质量门配置、ArchUnit 与租户接入证据。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handle: handleDoctor,
};

const codegenTool = {
  name: "wls_be_codegen",
  description: "契约驱动的 validate/plan/apply。apply 必须携带预览 planHash 与 confirmApply=true；requireComplete 可阻断业务骨架；写前重算，冲突默认整批零写入。",
  inputSchema: {
    type: "object",
    required: ["mode", "contract"],
    properties: {
      mode: { type: "string", enum: ["validate", "plan", "apply"] },
      contract: { type: "string", minLength: 1, description: "项目内后端契约 JSON 相对路径" },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      force: { type: "boolean", description: "发生本地修改冲突时备份后覆盖" },
      requireComplete: { type: "boolean", description: "拒绝 apply completion=draft 的可编译业务骨架" },
      allowProductionWrites: { type: "boolean", description: "生产环境经人工授权后显式放行本地文件写入" },
    },
    additionalProperties: false,
  },
  handle: handleCodegen,
};

const contractTool = {
  name: "wls_be_contract",
  description: "契约种子、分类/兼容迁移、协作差异、集成完备性与字段影响。inspect/impact/integration-inspect 只读；migrate 必须 planHash + confirmApply。",
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["seed", "show", "diff", "inspect", "migrate", "impact", "integration-inspect"] },
      contract: { type: "string", minLength: 1 },
      table: { type: "string", minLength: 1 },
      database: { type: "string", enum: ["oracle", "mysql"] },
      profile: { type: "string", minLength: 1 },
      rootPackage: { type: "string", minLength: 1 },
      module: { type: "string", minLength: 1 },
      entity: { type: "string", minLength: 1 },
      contractId: { type: "string", minLength: 1 },
      format: { type: "string", enum: ["json", "markdown"] },
      detail: { type: "string", enum: ["summary", "full"], description: "默认摘要；full 才在 text 通道返回完整 manifest" },
      frontend: { type: "string", minLength: 1 },
      openapi: { type: "string", minLength: 1 },
      permissions: { type: "string", minLength: 1 },
      kitApiMd: { type: "string", minLength: 1, description: "kit 风格 api.md（含 dict-contract 块），核对 API_CONFIG 与 externalBasePath" },
      strict: { type: "boolean" },
      field: { type: "string", minLength: 1, maxLength: 128, description: "impact：字段名或物理列名" },
      table: { type: "string", minLength: 1, maxLength: 128, description: "impact：可选物理表过滤" },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "impact：单页证据上限，默认 50" },
      cursor: { type: "integer", minimum: 0, description: "impact：证据游标" },
      confirmApply: { type: "boolean", description: "migrate：评审预览后显式确认" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$", description: "migrate：必须与预览一致" },
      allowUnresolved: { type: "boolean", description: "migrate：经人工确认后允许保留非确定项" },
      allowProductionWrites: { type: "boolean", description: "migrate：受保护环境单次授权" },
    },
    allOf: [
      { if: { properties: { mode: { const: "seed" } } }, then: { required: ["table", "database"] } },
      { if: { properties: { mode: { enum: ["show", "diff", "inspect", "migrate", "integration-inspect"] } } }, then: { required: ["contract"] } },
      { if: { properties: { mode: { const: "impact" } } }, then: { required: ["module", "field"] } },
    ],
    additionalProperties: false,
  },
  handle: handleContract,
};

const fixTool = {
  name: "wls_be_safe_fix",
  description: "仅自动修复有确定性前置条件的 B3/B5。默认预览；apply 必须携带 planHash 与 confirmApply=true，并执行备份、写前重算、失败回滚、强制复扫和 FIX_BE 报告。其他规则降级人工。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "项目内相对扫描路径" },
      rules: { type: "array", minItems: 1, items: { type: "string", enum: ["B3", "B5"] } },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      allowProductionWrites: { type: "boolean", description: "pre/prod 环境经人工复核后显式放行" },
    },
    additionalProperties: false,
  },
  handle: handleFix,
};

const standardsTool = {
  name: "wls_be_standards",
  description: `查询 ${capabilities.standards.count} 条后端规范。无参返回索引；id=${capabilities.standards.ids[0]}~${capabilities.standards.latest} 返回指定全文。只读。`,
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", enum: capabilities.standards.ids } },
    additionalProperties: false,
  },
  handle(args) {
    if (!args.id) return { text: fs.readFileSync(path.join(STANDARDS_ROOT, "index.md"), "utf8"), structuredContent: { ok: true, state: "listed" } };
    const files = fs.readdirSync(STANDARDS_ROOT).filter((file) => file.startsWith(`${args.id}-`));
    if (files.length !== 1) return { text: `❌ 无规范 ${args.id}`, isError: true, structuredContent: { ok: false, state: "not-found" } };
    return { text: fs.readFileSync(path.join(STANDARDS_ROOT, files[0]), "utf8"), structuredContent: { ok: true, state: "read", file: files[0] } };
  },
};

const templatesTool = {
  name: "wls_be_templates",
  description: "查询 16 个确定性代码/DDL/测试模板。无参返回 README；name 必须来自固定白名单。只读。",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", enum: Object.keys(TEMPLATE_MAP) } },
    additionalProperties: false,
  },
  handle(args) {
    if (!args.name) return { text: fs.readFileSync(path.join(TEMPLATES_ROOT, "README.md"), "utf8"), structuredContent: { ok: true, state: "listed", names: Object.keys(TEMPLATE_MAP) } };
    const file = TEMPLATE_MAP[args.name];
    return { text: fs.readFileSync(path.join(TEMPLATES_ROOT, file), "utf8"), structuredContent: { ok: true, state: "read", file } };
  },
};

const dbPreviewTool = {
  name: "wls_be_db_preview",
  description: "只读预览契约生成的 DDL（CREATE 或 ALTER）、Expand-Contract 阶段标注与自定义索引。不写盘。",
  inputSchema: {
    type: "object",
    required: ["contract"],
    properties: {
      contract: { type: "string", minLength: 1, description: "项目内后端契约 JSON 相对路径" },
      detail: { type: "string", enum: ["summary", "full"], description: "默认只返回 DDL 元数据；full 才在 text 通道返回 SQL" },
    },
    additionalProperties: false,
  },
  handle: handleDbPreview,
};

const exportPermissionsTool = {
  name: "wls_be_export_permissions",
  description: "从后端契约导出权限码为 wl-skills-kit 的 SYS_PERMISSION_INFO.md 片段。默认预览；apply 必须传 planHash + confirmApply=true，写前重算并可回滚。",
  inputSchema: {
    type: "object",
    required: ["contract"],
    properties: {
      contract: { type: "string", minLength: 1 },
      output: { type: "string", minLength: 1, description: "项目内相对输出路径，默认 reports/SYS_PERMISSION_INFO_{contractId}.md" },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      allowProductionWrites: { type: "boolean", description: "pre/prod 环境经人工复核后显式放行" },
    },
    additionalProperties: false,
  },
  handle: handleExportPermissions,
};

const configTool = {
  name: "wls_be_config",
  description: "配置分层与多环境管理（v0.12）：doctor 体检 L0~L8、init 生成骨架、migrate 客户迁移、fix 明文密码修复。详见 standards/25。",
  inputSchema: {
    type: "object",
    required: ["subcommand"],
    properties: {
      subcommand: { type: "string", enum: ["doctor", "init", "migrate", "fix"] },
      probe: { type: "boolean", description: "doctor 子命令：开启 DB/Redis/Nacos TCP 连通性探测" },
      probeTimeoutMs: { type: "number", description: "doctor 探测超时毫秒，默认 3000" },
      project: { type: "string", description: "init 子命令：工程名" },
      module: { type: "string", description: "init 子命令：业务模块" },
      port: { type: "number", description: "init 子命令：端口" },
      datasourceType: { type: "string", enum: ["oracle", "mysql"] },
      dbCluster: { type: "string", enum: ["cx", "non_cx", "pt"], description: "init 子命令：数据库集群；无法从业务域推断时必填" },
      customer: { type: "string", description: "init 子命令：初始客户名" },
      overwrite: { type: "boolean", description: "init 子命令：覆盖已存在文件" },
      to: { type: "string", description: "migrate 子命令：目标客户" },
      from: { type: "string", description: "migrate 子命令：源客户（默认 env-matrix.current）" },
      planHash: { type: "string", description: "migrate/fix apply 的计划哈希" },
      confirmApply: { type: "boolean", description: "写操作确认" },
      allowProductionWrites: { type: "boolean", description: "pre/prod 环境经人工复核后显式放行" },
    },
    additionalProperties: false,
  },
  handle: handleConfig,
};

const troubleshootTool = {
  name: "wls_be_troubleshoot",
  description: "故障排查导引（v0.12）：根据错误关键字匹配诊断树，输出可能原因与排查步骤。覆盖 DB/Redis/Nacos/K8s/端口/Bean/Profile/Flyway/Feign/MQ 常见错误。",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "错误关键字（如 Communications link failure / NacosException / CrashLoopBackOff）" },
      list: { type: "boolean", description: "列出所有诊断项" },
    },
    additionalProperties: false,
  },
  handle: handleTroubleshoot,
};

const taskTool = {
  name: "wls_be_task",
  description: "只读任务路由（v0.13）：识别新服务/加接口/落库/业务命令/修复/重构/审计/配置，输出 skill、规则子集和统一安全写链；实际写入必须走 codegen/safe-fix/config 的计划、确认与回滚门。",
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "string", description: "自然语言描述（如\"加个查询接口\"\"加字段落库\"\"改空指针bug\"）" },
      type: { type: "string", enum: ["new-service", "add-api", "add-field", "add-business-cmd", "fix-bug", "refactor", "audit", "config-op"], description: "直接指定任务类型" },
      list: { type: "boolean", description: "列出所有任务类型" },
      targetFile: { type: "string", description: "可选目标文件，仅作为计划上下文，不读取或写入" },
    },
    additionalProperties: false,
  },
  handle: handleTask,
};

const catalogTool = {
  name: "wls_be_catalog",
  description: "模块目录治理与重复集成工具审计。默认摘要；show 可按 section/cursor 有界读取。扫描默认只限当前模块；apply 需要同一 planHash 与确认。",
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["plan", "apply", "show", "check", "integration-audit"] },
      module: { type: "string", pattern: "^[a-z][a-zA-Z0-9]*$" },
      full: { type: "boolean" },
      detail: { type: "string", enum: ["summary", "full"], description: "show/check 默认 summary；full 显式返回完整快照" },
      section: { type: "string", enum: ["resources", "services", "apis", "databases", "relations", "sourceEvidence"], description: "show：只返回指定分区" },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "show：分区单页上限，默认 50" },
      cursor: { type: "integer", minimum: 0, description: "show：分区游标" },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      allowProductionWrites: { type: "boolean" },
    },
    allOf: [
      { if: { properties: { mode: { enum: ["check", "integration-audit"] } } }, then: { required: ["module"] } },
    ],
    additionalProperties: false,
  },
  handle: handleCatalog,
};

const contextTool = {
  name: "wls_be_context",
  description: "为当前模块构建有界上下文：扫描当前模块，最多加载一跳上下游快照，不遍历关联模块源码目录；返回文件/字节/token 预算和 contextHash。只读。",
  inputSchema: {
    type: "object",
    required: ["module"],
    properties: {
      module: { type: "string", pattern: "^[a-z][a-zA-Z0-9]*$" },
      task: { type: "string" },
      keywords: { type: "array", items: { type: "string" }, uniqueItems: true },
      maxFiles: { type: "integer", minimum: 3, maximum: 200 },
      maxBytes: { type: "integer", minimum: 16384, maximum: 10485760 },
      maxTokens: { type: "integer", minimum: 512, maximum: 200000 },
      maxHops: { type: "integer", minimum: 0, maximum: 1 },
    },
    additionalProperties: false,
  },
  handle: handleContext,
};

const commitTool = {
  name: "wls_be_commit",
  description: "按 catalog 配置校验 type(scope): 功能点-具体内容。validate 校验单条消息，check 校验 Git range，doctor 检查版本受控 Hook 接入。只读。",
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["validate", "check", "doctor"] },
      message: { type: "string", minLength: 1 },
      range: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  handle: handleCommit,
};

const testTool = {
  name: "wls_be_test",
  description: "行为契约测试生成：从 customOperations 生成正常路径、前置拒绝、状态转移及 batch 全成全败测试。gen 生成可执行 ServiceTest；scenarios 列出场景。禁止 TODO、空断言和部分成功语义。",
  inputSchema: {
    type: "object",
    required: ["mode", "contract"],
    properties: {
      mode: { type: "string", enum: ["gen", "scenarios"] },
      contract: { type: "string", minLength: 1, description: "项目内后端契约 JSON 相对路径" },
      includeSource: { type: "boolean", description: "gen 时显式返回生成源码；默认仅返回摘要" },
      detail: { type: "string", enum: ["summary", "full"], description: "gen 默认只返回场景计数；full 才在 text 通道返回测试源码" },
    },
    additionalProperties: false,
  },
  handle: handleTest,
};

const DEFINITIONS = [validateTool, reviewTool, doctorTool, codegenTool, contractTool, fixTool, standardsTool, templatesTool, dbPreviewTool, exportPermissionsTool, configTool, troubleshootTool, taskTool, catalogTool, contextTool, commitTool, testTool].map(withResponseControls);
const HANDLERS = Object.fromEntries(DEFINITIONS.map((tool) => [tool.name, tool]));
const TOOLS = DEFINITIONS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

module.exports = { HANDLERS, TOOLS };
