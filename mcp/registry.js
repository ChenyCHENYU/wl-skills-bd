"use strict";

const fs = require("fs");
const path = require("path");
const { handleValidate } = require("./tools/beRulesTools");
const { handleCatalog, handleCodegen, handleCommit, handleConfig, handleContext, handleContract, handleDbPreview, handleDoctor, handleExportPermissions, handleFix, handleTask, handleTest, handleTroubleshoot } = require("./tools/lifecycleTools");

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
  description: "只读扫描后端工程 B1~B12；返回规则、位置、指纹、抑制数和分级统计。quick=true 时跳过设计级慢规则。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, description: "项目内相对扫描路径" },
      quick: { type: "boolean", description: "跳过 B9~B12 设计级检查" },
    },
    additionalProperties: false,
  },
  handle: handleValidate,
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
  description: "渲染后端协作契约，或核对前端 wl-api-contract、运行时 OpenAPI 3、权限清单与 kit 风格 api.md；只读。",
  inputSchema: {
    type: "object",
    required: ["mode", "contract"],
    properties: {
      mode: { type: "string", enum: ["show", "diff"] },
      contract: { type: "string", minLength: 1 },
      format: { type: "string", enum: ["json", "markdown"] },
      frontend: { type: "string", minLength: 1 },
      openapi: { type: "string", minLength: 1 },
      permissions: { type: "string", minLength: 1 },
      kitApiMd: { type: "string", minLength: 1, description: "kit 风格 api.md（含 dict-contract 块），核对 API_CONFIG 与 externalBasePath" },
      strict: { type: "boolean" },
    },
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
  description: "查询 27 条后端规范。无参返回索引；id=01~27 返回指定全文。只读。",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", pattern: "^(0[1-9]|1[0-9]|2[0-7])$" } },
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
  description: "模块目录治理。默认必须指定 module，只扫描当前模块契约/源码根并复用其他模块快照；full 仅供显式 CI/初始化。apply 需要同一 planHash 与 confirmApply=true。",
  inputSchema: {
    type: "object",
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["plan", "apply", "show", "check"] },
      module: { type: "string", pattern: "^[a-z][a-zA-Z0-9]*$" },
      full: { type: "boolean" },
      confirmApply: { type: "boolean" },
      planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      allowProductionWrites: { type: "boolean" },
    },
    additionalProperties: false,
  },
  handle: handleCatalog,
};

const contextTool = {
  name: "wls_be_context",
  description: "为当前模块构建有界上下文：扫描当前模块，最多加载一跳上下游快照，不遍历关联模块源码目录；返回文件选择、预算和 contextHash。只读。",
  inputSchema: {
    type: "object",
    required: ["module"],
    properties: {
      module: { type: "string", pattern: "^[a-z][a-zA-Z0-9]*$" },
      task: { type: "string" },
      keywords: { type: "array", items: { type: "string" }, uniqueItems: true },
      maxFiles: { type: "integer", minimum: 3, maximum: 200 },
      maxBytes: { type: "integer", minimum: 16384, maximum: 10485760 },
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
  description: "行为契约测试生成（v0.16）：从契约 customOperations 生成关键场景测试（正常路径/前置拒绝/状态转移/batch 计数）。gen 生成完整 ServiceTest；scenarios 列出场景清单。测行为契约不测代码镜像，避免冗余。",
  inputSchema: {
    type: "object",
    required: ["mode", "contract"],
    properties: {
      mode: { type: "string", enum: ["gen", "scenarios"] },
      contract: { type: "string", minLength: 1, description: "项目内后端契约 JSON 相对路径" },
    },
    additionalProperties: false,
  },
  handle: handleTest,
};

const DEFINITIONS = [validateTool, doctorTool, codegenTool, contractTool, fixTool, standardsTool, templatesTool, dbPreviewTool, exportPermissionsTool, configTool, troubleshootTool, taskTool, catalogTool, contextTool, commitTool, testTool];
const HANDLERS = Object.fromEntries(DEFINITIONS.map((tool) => [tool.name, tool]));
const TOOLS = DEFINITIONS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

module.exports = { HANDLERS, TOOLS };
