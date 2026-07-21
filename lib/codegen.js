"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { buildManifest, generatedArtifacts } = require("./collaboration");
const { buildContext, loadContract } = require("./contract");
const { hashJson, stable } = require("./deterministic");
const { hashBuffer, hashFile, normalizeRel, resolveWithin, writeJsonAtomic } = require("./manifest");
const { render } = require("./template-engine");
const writeGuard = require("./write-guard");

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "files", ".github", "templates");
const STATE_REL = ".wl-skills-bd/.state/codegen-manifest.json";
const ASSURANCE_EVIDENCE_KEYS = [
  "threatModelRef",
  "authorizationReviewRef",
  "loadTestRef",
  "runbookRef",
  "restoreDrillRef",
  "dataReviewRef",
];

function template(name) {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, name), "utf8");
}

function sqlLiteral(value) {
  return String(value).replace(/'/g, "''").replace(/[\r\n]+/g, " ");
}

// 治理列默认策略（兜底，与 jh4j3 基线一致：1有效/0删除、时间 VARCHAR(19)）
// profile.softDelete/auditTime 可覆盖；未提供时完全等价于历史行为（向后兼容）
const DEFAULT_GOVERNANCE = {
  softDelete: {
    column: "IS_DELETE",
    activeValue: 1,
    deletedValue: 0,
    mysqlType: "TINYINT(1)",
    oracleType: "NUMBER(1)",
  },
  auditTime: {
    column: "DATE_TIME",
    mysqlType: "VARCHAR(19)",
    oracleType: "VARCHAR2(19 CHAR)",
  },
};

function resolveGovernance(profile) {
  const out = {
    softDelete: { ...DEFAULT_GOVERNANCE.softDelete },
    auditTime: { ...DEFAULT_GOVERNANCE.auditTime },
  };
  if (profile && profile.softDelete && typeof profile.softDelete === "object") {
    const sd = profile.softDelete;
    if (typeof sd.activeValue === "number") out.softDelete.activeValue = sd.activeValue;
    if (typeof sd.deletedValue === "number") out.softDelete.deletedValue = sd.deletedValue;
    if (typeof sd.column === "string" && sd.column) out.softDelete.column = sd.column;
    if (typeof sd.mysqlType === "string" && sd.mysqlType) out.softDelete.mysqlType = sd.mysqlType;
    if (typeof sd.oracleType === "string" && sd.oracleType) out.softDelete.oracleType = sd.oracleType;
  }
  if (profile && profile.auditTime && typeof profile.auditTime === "object") {
    const at = profile.auditTime;
    if (typeof at.mysqlType === "string" && at.mysqlType) out.auditTime.mysqlType = at.mysqlType;
    if (typeof at.oracleType === "string" && at.oracleType) out.auditTime.oracleType = at.oracleType;
  }
  return out;
}

function softDeleteComment(activeValue, deletedValue) {
  return `有效标记：${activeValue}=有效，${deletedValue}=已删除`;
}

function sqlName(prefix, table, suffix, limit) {
  const candidate = [prefix, table, suffix].filter(Boolean).join("_").toUpperCase();
  if (candidate.length <= limit) return candidate;
  const digest = crypto.createHash("sha1").update(candidate).digest("hex").slice(0, 8).toUpperCase();
  return `${candidate.slice(0, limit - digest.length - 1)}_${digest}`;
}

function indexLine(database, index, table, limit) {
  const columns = index.columns.join(", ");
  const prefix = index.unique ? "UK" : "IDX";
  const rawName = index.name || sqlName(prefix, table, index.columns.join("_"), limit);
  if (database === "oracle") return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${rawName} ON ${table} (${columns});`;
  return `    ${index.unique ? "UNIQUE " : ""}KEY ${rawName} (${columns}) USING BTREE`;
}

function initialSqlValue(field) {
  if (!Object.prototype.hasOwnProperty.call(field, "initialValue")) return "";
  if (field.javaType === "String") return `'${sqlLiteral(field.initialValue)}'`;
  if (field.javaType === "Boolean") return field.initialValue ? "1" : "0";
  return String(field.initialValue);
}

function columnDefinition(field) {
  const initial = initialSqlValue(field);
  if (initial) return `${field.column} ${field.dbType} DEFAULT ${initial} NOT NULL`;
  return `${field.column} ${field.dbType}${field.requiredOnCreate ? " NOT NULL" : ""}`;
}

function renderOracleMigration(contract, profile) {
  const gov = resolveGovernance(profile);
  const table = contract.entity.table;
  const sd = gov.softDelete;
  const at = gov.auditTime;
  const lines = [
    "    ID VARCHAR2(64 CHAR) NOT NULL",
    ...contract.fields.map((field) => `    ${columnDefinition(field)}`),
    "    COMPANY_ID VARCHAR2(64 CHAR) NOT NULL",
    `    ${sd.column} ${sd.oracleType} DEFAULT ${sd.activeValue} NOT NULL`,
    "    REVISION NUMBER(10) DEFAULT 0 NOT NULL",
    "    CREATE_USER_NO VARCHAR2(64 CHAR)",
    "    UPDATE_USER_NO VARCHAR2(64 CHAR)",
    `    CREATE_DATE_TIME ${at.oracleType}`,
    `    UPDATE_DATE_TIME ${at.oracleType}`,
    `    CONSTRAINT ${sqlName("PK", table, "", 30)} PRIMARY KEY (ID)`,
  ];
  const comments = [
    `COMMENT ON TABLE ${table} IS '${sqlLiteral(contract.entity.description)}';`,
    "COMMENT ON COLUMN " + table + ".ID IS '主键ID';",
    ...contract.fields.map((field) => `COMMENT ON COLUMN ${table}.${field.column} IS '${sqlLiteral(field.comment)}';`),
    "COMMENT ON COLUMN " + table + ".COMPANY_ID IS '公司/租户ID';",
    `COMMENT ON COLUMN ${table}.${sd.column} IS '${softDeleteComment(sd.activeValue, sd.deletedValue)}';`,
    "COMMENT ON COLUMN " + table + ".REVISION IS '乐观锁版本号';",
    "COMMENT ON COLUMN " + table + ".CREATE_USER_NO IS '创建人工号';",
    "COMMENT ON COLUMN " + table + ".UPDATE_USER_NO IS '更新人工号';",
    "COMMENT ON COLUMN " + table + ".CREATE_DATE_TIME IS '创建时间';",
    "COMMENT ON COLUMN " + table + ".UPDATE_DATE_TIME IS '更新时间';",
  ];
  const indexes = (contract.indexes || []).map((index) => indexLine("oracle", index, table, 30));
  return [
    `-- contract: ${contract.contractId}`,
    "-- generated by wl-skills-bd; review the diff before Flyway executes it",
    `CREATE TABLE ${table} (`,
    `${lines.join(",\n")}\n);`,
    "",
    ...comments,
    "",
    `CREATE INDEX ${sqlName("IDX", table, "TENANT_ACTIVE", 30)} ON ${table} (COMPANY_ID, ${sd.column});`,
    ...indexes,
    "",
  ].join("\n");
}

function renderMysqlMigration(contract, profile) {
  const gov = resolveGovernance(profile);
  const table = contract.entity.table;
  const sd = gov.softDelete;
  const at = gov.auditTime;
  const indexLines = (contract.indexes || []).map((index) => indexLine("mysql", index, table, 64));
  const lines = [
    "    ID VARCHAR(64) NOT NULL COMMENT '主键ID'",
    ...contract.fields.map((field) => `    ${columnDefinition(field)} COMMENT '${sqlLiteral(field.comment)}'`),
    "    COMPANY_ID VARCHAR(64) NOT NULL COMMENT '公司/租户ID'",
    `    ${sd.column} ${sd.mysqlType} NOT NULL DEFAULT ${sd.activeValue} COMMENT '${softDeleteComment(sd.activeValue, sd.deletedValue)}'`,
    "    REVISION INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号'",
    "    CREATE_USER_NO VARCHAR(64) NULL COMMENT '创建人工号'",
    "    UPDATE_USER_NO VARCHAR(64) NULL COMMENT '更新人工号'",
    `    CREATE_DATE_TIME ${at.mysqlType} NULL COMMENT '创建时间'`,
    `    UPDATE_DATE_TIME ${at.mysqlType} NULL COMMENT '更新时间'`,
    `    PRIMARY KEY (ID)`,
    `    KEY ${sqlName("IDX", table, "TENANT_ACTIVE", 64)} (COMPANY_ID, ${sd.column})`,
    ...indexLines,
  ];
  return [
    `-- contract: ${contract.contractId}`,
    "-- generated by wl-skills-bd; review the diff before Flyway executes it",
    `CREATE TABLE ${table} (`,
    `${lines.join(",\n")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='${sqlLiteral(contract.entity.description)}';`,
    "",
  ].join("\n");
}

function renderOracleAlter(contract) {
  const alter = contract.alter;
  const table = contract.entity.table;
  const statements = [];
  const comments = [];
  for (const op of alter.operations) {
    if (op.type === "add") {
      const f = op.field;
      statements.push(`ALTER TABLE ${table} ADD ${f.column} ${f.dbType}${f.requiredOnCreate ? " NOT NULL" : ""};`);
      comments.push(`COMMENT ON COLUMN ${table}.${f.column} IS '${sqlLiteral(f.comment)}';`);
    } else if (op.type === "drop") {
      statements.push(`ALTER TABLE ${table} DROP COLUMN ${op.column};`);
    } else {
      statements.push(`ALTER TABLE ${table} MODIFY ${op.column} ${op.dbType};`);
      comments.push(`COMMENT ON COLUMN ${table}.${op.column} IS '${sqlLiteral(op.comment)}';`);
    }
  }
  for (const index of alter.indexes || []) {
    statements.push(indexLine("oracle", index, table, 30));
  }
  return [
    `-- contract: ${contract.contractId} (ALTER)`,
    "-- generated by wl-skills-bd; review the diff before Flyway executes it",
    `-- phase: ${alter.phase}`,
    ...(alter.approvalRef ? [`-- approval-ref: ${alter.approvalRef}`] : []),
    "-- expand-contract: expand 先部署兼容应用；contract 只能在新应用稳定且审批后执行",
    ...statements,
    "",
    ...comments,
    "",
  ].join("\n");
}

function renderMysqlAlter(contract) {
  const alter = contract.alter;
  const table = contract.entity.table;
  const clauses = [];
  const indexClauses = [];
  for (const op of alter.operations) {
    if (op.type === "add") {
      const f = op.field;
      clauses.push(`    ADD COLUMN ${f.column} ${f.dbType}${f.requiredOnCreate ? " NOT NULL" : ""} COMMENT '${sqlLiteral(f.comment)}'`);
    } else if (op.type === "drop") {
      clauses.push(`    DROP COLUMN ${op.column}`);
    } else {
      clauses.push(`    MODIFY COLUMN ${op.column} ${op.dbType} COMMENT '${sqlLiteral(op.comment)}'`);
    }
  }
  for (const index of alter.indexes || []) {
    indexClauses.push(`    ADD ${index.unique ? "UNIQUE " : ""}INDEX ${index.name} (${index.columns.join(", ")})`);
  }
  return [
    `-- contract: ${contract.contractId} (ALTER)`,
    "-- generated by wl-skills-bd; review the diff before Flyway executes it",
    `-- phase: ${alter.phase}`,
    ...(alter.approvalRef ? [`-- approval-ref: ${alter.approvalRef}`] : []),
    "-- expand-contract: expand 先部署兼容应用；contract 只能在新应用稳定且审批后执行",
    `ALTER TABLE ${table}`,
    [
      ...clauses,
      ...indexClauses,
    ].join(",\n") + ";",
    "",
  ].join("\n");
}

function renderMigration(contract, profile) {
  if (contract.alter) return contract.database === "oracle" ? renderOracleAlter(contract) : renderMysqlAlter(contract);
  return contract.database === "oracle" ? renderOracleMigration(contract, profile) : renderMysqlMigration(contract, profile);
}

function migrationFileBase(contract) {
  const table = contract.entity.table.toLowerCase();
  if (contract.alter) {
    const opKinds = [...new Set(contract.alter.operations.map((op) => op.type))].join("_");
    return `V${contract.alter.version}__alter_${table}_${opKinds}.sql`;
  }
  return `V${contract.migration.version}__create_${table}.sql`;
}

function migrationVersion(contract) {
  return contract.alter ? contract.alter.version : contract.migration.version;
}

function migrationVersionConflicts(projectRoot, contract) {
  const root = resolveWithin(projectRoot, contract.output.migration);
  if (!fs.existsSync(root)) return [];
  const expected = migrationFileBase(contract).toLowerCase();
  const prefix = `v${migrationVersion(contract).toLowerCase()}__`;
  const conflicts = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().startsWith(prefix) && entry.name.toLowerCase() !== expected) {
        conflicts.push(normalizeRel(path.relative(projectRoot, absolute)));
      }
    }
  };
  visit(root);
  return conflicts.sort();
}

function preserveCustomRegions(generated, existing) {
  const pattern = /(^[ \t]*\/\/ <wl-custom name="([^"]+)">[ \t]*\r?\n)([\s\S]*?)(^[ \t]*\/\/ <\/wl-custom>[ \t]*$)/gm;
  const existingRegions = new Map([...existing.matchAll(pattern)].map((match) => [match[2], match[3]]));
  return generated.replace(pattern, (whole, open, name, body, close) => (
    existingRegions.has(name) ? `${open}${existingRegions.get(name)}${close}` : whole
  ));
}

function normalizeJavaSource(source) {
  let content = source.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  const packageMatch = content.match(/^(package\s+[\w.]+;\n)([\s\S]*?)(?=\/\*\*)/);
  if (packageMatch) {
    const header = packageMatch[2];
    const imports = [...header.matchAll(/^import\s+[^;]+;$/gm)].map((match) => match[0]);
    const residue = header.replace(/^import\s+[^;]+;[ \t]*$/gm, "").trim();
    if (imports.length > 0 && residue.length === 0) {
      const unique = [...new Set(imports)].sort((left, right) => {
        const leftStatic = left.startsWith("import static ");
        const rightStatic = right.startsWith("import static ");
        if (leftStatic !== rightStatic) return leftStatic ? -1 : 1;
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      });
      const staticImports = unique.filter((line) => line.startsWith("import static "));
      const regularImports = unique.filter((line) => !line.startsWith("import static "));
      const importBlocks = [staticImports, regularImports].filter((block) => block.length > 0);
      content = content.replace(
        packageMatch[0],
        `${packageMatch[1]}\n${importBlocks.map((block) => block.join("\n")).join("\n\n")}\n\n`,
      );
    }
  }
  let previous;
  do {
    previous = content;
    content = content.replace(
      /^([ \t]*)\* (\S.*)\n\1\* (<(?:p|ul)>.*)$/gm,
      "$1* $2\n$1*\n$1* $3",
    );
  } while (content !== previous);
  content = content.replace(/\n{3,}/g, "\n\n");
  do {
    previous = content;
    content = content.replace(/\n[ \t]*\n([ \t]*})/g, "\n$1");
  } while (content !== previous);
  return `${content.trimEnd()}\n`;
}

function generatedFiles(contract, profile, deliveryProfile, options = {}) {
  const context = buildContext(contract, profile);
  const { buildCustomTestsSection } = require("./test-codegen");
  const customTestsSection = buildCustomTestsSection(contract, profile);
  const packagePath = contract.rootPackage.replace(/\./g, "/");
  const entity = contract.entity.name;
  const migrationFile = migrationFileBase(contract);
  const migrationSql = renderMigration(contract, profile);
  const rollbackVersion = contract.alter ? contract.alter.version : contract.migration.version;
  const rollbackStrategy = contract.alter ? contract.alter.rollbackStrategy : contract.migration.rollbackStrategy;
  const verificationSql = contract.alter ? contract.alter.verificationSql : contract.migration.verificationSql;
  const withGenerated = {
    ...context,
    customTestsSection,
    migrationFile,
    migrationSql,
    rollbackVersion,
    rollbackStrategy,
    verificationSql,
    isAlter: Boolean(contract.alter),
    migrationKind: contract.alter ? "ALTER" : "CREATE",
    migrationPhase: contract.alter ? contract.alter.phase : "create",
    ddlRiskLevel: contract.alter && contract.alter.phase === "contract" ? "high" : (contract.alter ? "medium" : "low"),
    ddlApprovalRef: contract.alter && contract.alter.approvalRef,
  };
  const specs = [
    ["Entity.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/entity/${contract.module}/${entity}.java`],
    ["CreateDTO.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/dto/${contract.module}/${entity}CreateDTO.java`],
    ["UpdateDTO.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/dto/${contract.module}/${entity}UpdateDTO.java`],
    ["PageDTO.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/dto/${contract.module}/${entity}PageDTO.java`],
    ["VO.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/vo/${contract.module}/${entity}VO.java`],
    ["PageVO.java.tmpl", `${contract.output.modelJava}/${packagePath}/api/vo/${contract.module}/${entity}PageVO.java`],
    ["Controller.java.tmpl", `${contract.output.serviceJava}/${packagePath}/${contract.module}/controller/${entity}Controller.java`],
    ["Service.java.tmpl", `${contract.output.serviceJava}/${packagePath}/${contract.module}/service/${entity}Service.java`],
    ["Mapper.java.tmpl", `${contract.output.serviceJava}/${packagePath}/${contract.module}/mapper/${entity}Mapper.java`],
    ["Mapper.xml.tmpl", `${contract.output.serviceResources}/mapper/${contract.module}/${entity}Mapper.xml`],
    ["Migration.sql.tmpl", `${contract.output.migration}/${migrationFile}`],
    ["Rollback.md.tmpl", `${contract.output.rollback}/${contract.contractId}.md`],
    ["DdlPreview.md.tmpl", `${contract.output.rollback}/${contract.contractId}-ddl-preview.md`],
    ["ServiceTest.java.tmpl", `${contract.output.testJava}/${packagePath}/${contract.module}/service/${entity}ServiceTest.java`],
    ["ControllerTest.java.tmpl", `${contract.output.testJava}/${packagePath}/${contract.module}/controller/${entity}ControllerTest.java`],
  ];
  const dynamicSpecs = context.customRequestDtos.map((operation) => [
    "OperationRequestDTO.java.tmpl",
    `${contract.output.modelJava}/${packagePath}/api/dto/${contract.module}/${operation.requestDtoName}.java`,
    operation,
  ]);
  const templateOutputs = [...specs, ...dynamicSpecs].map(([templateName, rel, localContext]) => {
    const normalized = normalizeRel(rel);
    let content = render(template(templateName), { ...withGenerated, ...(localContext || {}) });
    if (templateName.endsWith(".java.tmpl")) content = normalizeJavaSource(content);
    if (options.projectRoot && ["Service.java.tmpl", "ServiceTest.java.tmpl"].includes(templateName)) {
      const destination = resolveWithin(options.projectRoot, normalized);
      if (fs.existsSync(destination)) content = preserveCustomRegions(content, fs.readFileSync(destination, "utf8"));
    }
    return { rel: normalized, template: templateName, content, generatedHash: hashBuffer(Buffer.from(content, "utf8")) };
  });
  const projectedEvidence = inspectGeneratedImplementation(contract, templateOutputs);
  const assuranceEvidence = inspectAssuranceEvidence(contract, options.projectRoot || process.cwd());
  const collaborationOutputs = generatedArtifacts(contract, profile, deliveryProfile, {
    implementedOperations: projectedEvidence.implementedOperations,
    assuranceMissing: assuranceEvidence.missing,
  }).map((item) => ({
    ...item,
    rel: normalizeRel(item.rel),
    generatedHash: hashBuffer(Buffer.from(item.content, "utf8")),
  }));
  return [...templateOutputs, ...collaborationOutputs];
}

function implementationTargets(contract) {
  const targets = [];
  if (contract.api.permissions && contract.api.permissions.export) targets.push({ key: "export", method: "export" });
  for (const relation of contract.relations || []) {
    if (relation.exposeQuery !== false) {
      targets.push({ key: `relation:${relation.name}`, method: `query${relation.detailEntity}ByParentId` });
    }
  }
  for (const operation of contract.customOperations || []) targets.push({ key: operation.name, method: operation.name });
  return targets;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\r\n]*/g, "");
}

function executableTestBodies(source) {
  const clean = stripComments(source);
  const bodies = [];
  const pattern = /@Test\b[\s\S]*?\b(?:public\s+|protected\s+|private\s+)?void\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = pattern.exec(clean)) !== null) {
    const open = clean.indexOf("{", match.index);
    let depth = 0;
    for (let index = open; index < clean.length; index += 1) {
      if (clean[index] === "{") depth += 1;
      else if (clean[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(clean.slice(open + 1, index));
          pattern.lastIndex = index + 1;
          break;
        }
      }
    }
  }
  return bodies;
}

function hasExecutableTest(source, methodName) {
  const invocation = new RegExp(`\\.${methodName}\\s*\\(`);
  const evidence = /\b(?:assert\w*|verify|then|expect|assertThat)\s*\(/;
  return executableTestBodies(source).some((body) => invocation.test(body) && evidence.test(body));
}

function inspectImplementationSources(contract, service, tests, source = {}) {
  const implementedOperations = [];
  const missingOperations = [];
  for (const target of implementationTargets(contract)) {
    const body = methodBody(service, target.method);
    const implemented = body && !/UnsupportedOperationException|TODO|FIXME/.test(body) && /\S/.test(body);
    const tested = hasExecutableTest(tests, target.method);
    if (implemented && tested) implementedOperations.push(target.key);
    else missingOperations.push({
      operation: target.key,
      method: target.method,
      implementation: implemented ? "present" : "missing-or-placeholder",
      test: tested ? "present" : "missing",
    });
  }
  return {
    ok: missingOperations.length === 0,
    ...source,
    implementedOperations,
    missingOperations,
  };
}

function inspectGeneratedImplementation(contract, outputs) {
  const entity = contract.entity.name;
  const serviceItem = outputs.find((item) => item.rel.endsWith(`/${entity}Service.java`));
  const testItem = outputs.find((item) => item.rel.endsWith(`/${entity}ServiceTest.java`));
  return inspectImplementationSources(
    contract,
    serviceItem ? serviceItem.content : "",
    testItem ? testItem.content : "",
    { serviceRel: serviceItem && serviceItem.rel, testRel: testItem && testItem.rel, projected: true },
  );
}

function inspectAssuranceEvidence(contract, projectRoot = process.cwd()) {
  if (!contract.assurance || contract.assurance.level !== "production") {
    return { required: false, ok: true, missing: [], evidence: [] };
  }
  const evidence = [];
  const missing = [];
  for (const key of ASSURANCE_EVIDENCE_KEYS) {
    const rel = contract.assurance.evidence && contract.assurance.evidence[key];
    let exists = false;
    if (rel) {
      try {
        const file = resolveWithin(projectRoot, rel);
        exists = fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0;
      } catch {
        exists = false;
      }
    }
    evidence.push({ key, rel, exists });
    if (!exists) missing.push(`${key}:${rel || "未声明"}`);
  }
  return { required: true, ok: missing.length === 0, missing, evidence };
}

function methodBody(source, methodName) {
  const match = new RegExp(`\\b${methodName}\\s*\\(`).exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

function inspectImplementation(contract, projectRoot = process.cwd()) {
  const packagePath = contract.rootPackage.replace(/\./g, "/");
  const entity = contract.entity.name;
  const serviceRel = normalizeRel(`${contract.output.serviceJava}/${packagePath}/${contract.module}/service/${entity}Service.java`);
  const testRel = normalizeRel(`${contract.output.testJava}/${packagePath}/${contract.module}/service/${entity}ServiceTest.java`);
  const serviceFile = resolveWithin(projectRoot, serviceRel);
  const testFile = resolveWithin(projectRoot, testRel);
  const service = fs.existsSync(serviceFile) ? fs.readFileSync(serviceFile, "utf8") : "";
  const tests = fs.existsSync(testFile) ? fs.readFileSync(testFile, "utf8") : "";
  return inspectImplementationSources(contract, service, tests, {
    serviceRel,
    testRel,
    projected: false,
  });
}

function readState(projectRoot) {
  const file = resolveWithin(projectRoot, STATE_REL);
  if (!fs.existsSync(file)) return { schemaVersion: 1, generator: pkg.name, contracts: {} };
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (state.schemaVersion !== 1 || !state.contracts || typeof state.contracts !== "object") {
    throw new Error(`${STATE_REL} 格式不受支持`);
  }
  return state;
}

function ownerOf(state, rel) {
  return Object.entries(state.contracts).find(([, entry]) => entry.files && entry.files[rel]);
}

function buildPlan(contractFile, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const loaded = loadContract(contractFile, { projectRoot });
  if (!loaded.ok) return { ok: false, projectRoot, contractFile: loaded.file, errors: loaded.errors, actions: [] };
  const { contract, profile, deliveryProfile } = loaded;
  const versionConflicts = migrationVersionConflicts(projectRoot, contract);
  if (versionConflicts.length > 0) {
    return {
      ok: false,
      projectRoot,
      contractFile: loaded.file,
      contract,
      errors: [{ path: "$.migration.version", message: `Flyway 版本 ${migrationVersion(contract)} 已被其他文件占用：${versionConflicts.join(", ")}` }],
      actions: [],
    };
  }
  const catalogPreflight = require("./project-catalog").preflightContract(projectRoot, contract);
  if (!catalogPreflight.ok) {
    return {
      ok: false,
      projectRoot,
      contractFile: loaded.file,
      contract,
      errors: catalogPreflight.errors || [{ path: "$.catalog", message: "当前模块目录上下文检查未通过" }],
      catalogPreflight,
      actions: [],
    };
  }
  const state = readState(projectRoot);
  const previous = state.contracts[contract.contractId] || { files: {} };
  const outputs = generatedFiles(contract, profile, deliveryProfile, { projectRoot });
  const implementationEvidence = inspectGeneratedImplementation(contract, outputs);
  const assuranceEvidence = inspectAssuranceEvidence(contract, projectRoot);
  const completion = buildManifest(contract, profile, deliveryProfile, {
    implementedOperations: implementationEvidence.implementedOperations,
    assuranceMissing: assuranceEvidence.missing,
  }).completion;
  const outputMap = new Map(outputs.map((item) => [item.rel, item]));
  const actions = [];

  for (const item of outputs) {
    const destination = resolveWithin(projectRoot, item.rel);
    const previousFile = previous.files[item.rel];
    const otherOwner = ownerOf(state, item.rel);
    if (otherOwner && otherOwner[0] !== contract.contractId) {
      actions.push({ ...item, destination, action: "conflict", reason: `已由契约 ${otherOwner[0]} 管理` });
      continue;
    }
    if (!fs.existsSync(destination)) {
      actions.push({ ...item, destination, action: "add" });
      continue;
    }
    const currentHash = hashFile(destination);
    const migrationPrefix = `${normalizeRel(contract.output.migration)}/`;
    if (item.rel.startsWith(migrationPrefix) && currentHash !== item.generatedHash) {
      actions.push({ ...item, destination, currentHash, action: "conflict", reason: "Flyway migration 已存在且内容不同；已发布迁移不可改写，请新建版本" });
      continue;
    }
    if (currentHash === item.generatedHash) {
      actions.push({ ...item, destination, currentHash, action: "unchanged" });
    } else if (previousFile && currentHash === previousFile.installedHash) {
      actions.push({ ...item, destination, currentHash, action: "update" });
    } else {
      actions.push({ ...item, destination, currentHash, action: "conflict", reason: "目标文件包含未受管或本地修改" });
    }
  }

  for (const [rel, previousFile] of Object.entries(previous.files || {})) {
    if (outputMap.has(rel)) continue;
    const destination = resolveWithin(projectRoot, rel);
    const isMigration = rel.startsWith(`${normalizeRel(contract.output.migration)}/`);
    if (!fs.existsSync(destination)) actions.push({ rel, destination, action: "stale-missing" });
    else {
      const currentHash = hashFile(destination);
      actions.push({
        rel,
        destination,
        currentHash,
        action: isMigration ? "preserve-stale" : (currentHash === previousFile.installedHash ? "remove-stale" : "preserve-stale"),
        ...(isMigration ? { reason: "Flyway migration 不可删除；旧版本保留" } : {}),
      });
    }
  }

  const summary = actions.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  const contractHash = hashJson(contract);
  const planHash = hashJson({
    contractHash,
    generatorVersion: pkg.version,
    catalogContextHash: catalogPreflight.contextHash || null,
    actions: actions.map((item) => ({
      action: item.action,
      currentHash: item.currentHash || null,
      generatedHash: item.generatedHash || null,
      rel: item.rel,
    })),
  });
  return {
    ok: true,
    projectRoot,
    contractFile: loaded.file,
    contract,
    profile,
    state,
    outputs,
    actions,
    summary,
    contractHash,
    completion,
    implementationEvidence,
    assuranceEvidence,
    catalogPreflight,
    planHash,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function backupDestination(projectRoot, rel, backupId) {
  const backupRoot = path.join(projectRoot, ".wl-skills-bd", ".state", "codegen-backups", backupId);
  return resolveWithin(backupRoot, rel);
}

function backup(projectRoot, rel, source, backupId) {
  const destination = backupDestination(projectRoot, rel, backupId);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function writeTextAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, file);
}

function rememberFile(journal, file) {
  if (journal.has(file)) return;
  journal.set(file, fs.existsSync(file)
    ? { existed: true, content: fs.readFileSync(file) }
    : { existed: false, content: null });
}

function rememberMissingParents(createdDirs, file, projectRoot) {
  let current = path.dirname(file);
  const root = path.resolve(projectRoot);
  while (current !== root && current.startsWith(root + path.sep)) {
    if (fs.existsSync(current)) break;
    createdDirs.add(current);
    current = path.dirname(current);
  }
}

function removeEmptyDirectories(createdDirs) {
  const ordered = [...createdDirs].sort((left, right) => right.length - left.length);
  for (const dir of ordered) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function restoreJournal(journal, createdDirs) {
  for (const [file, before] of [...journal.entries()].reverse()) {
    const temp = `${file}.${process.pid}.tmp`;
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (before.existed) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, before.content);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  removeEmptyDirectories(createdDirs);
}

const detectEnvironment = writeGuard.detectEnvironment;
const isProductionGuardBlocked = writeGuard.isProtectedWriteBlocked;

function applyPlan(plan, options = {}) {
  if (!plan.ok) return { ok: false, errors: plan.errors || [], applied: [] };
  if (options.confirm !== true) return { ok: false, reason: "confirm-required", applied: [] };
  if (!options.planHash || options.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-hash-mismatch", expectedPlanHash: plan.planHash, applied: [] };
  }
  const fresh = buildPlan(plan.contractFile, { projectRoot: plan.projectRoot });
  if (!fresh.ok || fresh.planHash !== plan.planHash) {
    return { ok: false, reason: "plan-changed", expectedPlanHash: fresh.planHash, applied: [] };
  }
  if (options.requireComplete === true && fresh.completion.contractStatus !== "confirmed") {
    return {
      ok: false,
      reason: "contract-incomplete",
      completion: fresh.completion,
      applied: [],
      hint: "生成物仍含业务骨架；补齐实现与测试并将 completion 确认后，才可通过生产就绪门。",
    };
  }
  const env = detectEnvironment(fresh.projectRoot, fresh.contract);
  if (isProductionGuardBlocked(env, options.allowProductionWrites)) {
    return {
      ok: false,
      reason: "production-write-guard",
      environment: env,
      applied: [],
      hint: "pre/prod/production 的工程写入默认阻断；评审同一 planHash 后，本地显式设置 WL_ALLOW_PRODUCTION_WRITES=true 或 MCP 传 allowProductionWrites=true（详见 standards/21 §8）",
    };
  }
  const force = options.force === true;
  const blocked = fresh.actions.filter((item) => item.action === "conflict" && !force);
  if (blocked.length > 0) return { ok: false, reason: "conflict", blocked, applied: [] };

  const backupId = timestamp();
  const applied = [];
  const files = {};
  const journal = new Map();
  const createdDirs = new Set();
  const backupFiles = [];
  const stateFile = resolveWithin(fresh.projectRoot, STATE_REL);
  try {
    for (const item of fresh.actions) {
      if (item.action === "stale-missing" || item.action === "preserve-stale") {
        applied.push({ rel: item.rel, result: "preserved" });
        continue;
      }
      if (item.action === "remove-stale") {
        rememberFile(journal, item.destination);
        fs.unlinkSync(item.destination);
        applied.push({ rel: item.rel, result: "removed" });
        continue;
      }
      if (item.action === "unchanged") {
        files[item.rel] = { generatedHash: item.generatedHash, installedHash: item.generatedHash, template: item.template };
        applied.push({ rel: item.rel, result: "unchanged" });
        continue;
      }
      rememberFile(journal, item.destination);
      rememberMissingParents(createdDirs, item.destination, fresh.projectRoot);
      if (fs.existsSync(item.destination)) {
        const backupFile = backupDestination(fresh.projectRoot, item.rel, backupId);
        rememberMissingParents(createdDirs, backupFile, fresh.projectRoot);
        backupFiles.push(backup(fresh.projectRoot, item.rel, item.destination, backupId));
      }
      writeTextAtomic(item.destination, item.content);
      files[item.rel] = { generatedHash: item.generatedHash, installedHash: item.generatedHash, template: item.template };
      applied.push({ rel: item.rel, result: item.action });
    }

    const nextState = stable({
      ...fresh.state,
      schemaVersion: 1,
      generator: pkg.name,
      generatorVersion: pkg.version,
      updatedAt: new Date().toISOString(),
      contracts: {
        ...fresh.state.contracts,
        [fresh.contract.contractId]: {
          contractFile: normalizeRel(path.relative(fresh.projectRoot, fresh.contractFile)),
          contractHash: fresh.contractHash,
          generatedAt: new Date().toISOString(),
          files,
        },
      },
    });
    rememberFile(journal, stateFile);
    rememberMissingParents(createdDirs, stateFile, fresh.projectRoot);
    writeJsonAtomic(stateFile, nextState);
    return { ok: true, planHash: fresh.planHash, backupId, applied };
  } catch (error) {
    let rollbackError = null;
    try {
      restoreJournal(journal, createdDirs);
      for (const file of backupFiles.reverse()) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      removeEmptyDirectories(createdDirs);
    } catch (restoreError) {
      rollbackError = restoreError;
    }
    if (rollbackError) {
      throw new Error(`代码生成写入失败且自动回滚失败：${error.message}；${rollbackError.message}`, { cause: error });
    }
    return {
      ok: false,
      reason: "write-failed-rolled-back",
      message: error.message,
      rolledBack: true,
      attempted: applied,
      applied: [],
    };
  }
}

function publicPlan(plan) {
  if (!plan.ok) return plan;
  return {
    ok: true,
    projectRoot: plan.projectRoot,
    contractFile: plan.contractFile,
    contractId: plan.contract.contractId,
    contractHash: plan.contractHash,
    completion: plan.completion,
    assuranceEvidence: plan.assuranceEvidence,
    catalogPreflight: plan.catalogPreflight,
    planHash: plan.planHash,
    summary: plan.summary,
    actions: plan.actions.map((item) => ({
      rel: item.rel,
      action: item.action,
      reason: item.reason,
      currentHash: item.currentHash,
      generatedHash: item.generatedHash,
    })),
  };
}

module.exports = {
  STATE_REL,
  TEMPLATE_ROOT,
  applyPlan,
  buildPlan,
  detectEnvironment,
  generatedFiles,
  normalizeJavaSource,
  inspectImplementation,
  inspectAssuranceEvidence,
  isProductionGuardBlocked,
  migrationFileBase,
  publicPlan,
  preserveCustomRegions,
  readState,
  renderAlterMysql: renderMysqlAlter,
  renderAlterOracle: renderOracleAlter,
  renderMigration,
  renderMysqlMigration,
  renderOracleMigration,
  resolveGovernance,
};
