"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { buildManifest, generatedArtifacts } = require("./collaboration");
const { buildContext, loadContract } = require("./contract");
const dbSpec = require("./db-spec");
const { hashJson, stable } = require("./deterministic");
const { physicalIdentifier, resolveGovernance, softDeleteComment } = require("./governance");
const { databaseActorType, databaseIdType, resolveProfilePolicies } = require("./profile-policy");
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

function sqlName(prefix, table, suffix, limit, database = "oracle") {
  const candidate = [prefix, table, suffix].filter(Boolean).join("_").toUpperCase();
  const fit = candidate.length <= limit ? candidate : null;
  const digest = crypto.createHash("sha1").update(candidate).digest("hex").slice(0, 8).toUpperCase();
  const value = fit || `${candidate.slice(0, limit - digest.length - 1)}_${digest}`;
  return physicalIdentifier(database, value);
}

function indexLine(database, index, table, limit) {
  const columns = index.columns.join(", ");
  const prefix = index.unique ? "UK" : "IDX";
  const rawName = index.name || sqlName(prefix, table, index.columns.join("_"), limit, database);
  if (database === "oracle") return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${rawName} ON ${table} (${columns});`;
  return `    ${index.unique ? "UNIQUE " : ""}KEY ${rawName} (${columns}) USING BTREE`;
}

function initialSqlValue(field) {
  if (!Object.prototype.hasOwnProperty.call(field, "initialValue")) return "";
  if (field.javaType === "String") return `'${sqlLiteral(field.initialValue)}'`;
  if (field.javaType === "Boolean") return field.initialValue ? "1" : "0";
  return String(field.initialValue);
}

function defaultSqlValue(field) {
  if (!Object.prototype.hasOwnProperty.call(field, "defaultValue")) return "";
  if (field.javaType === "String") return `'${sqlLiteral(field.defaultValue)}'`;
  if (field.javaType === "Boolean") return field.defaultValue ? "1" : "0";
  return String(field.defaultValue);
}

function columnDefinition(field) {
  const initial = initialSqlValue(field);
  if (initial) return `${field.column} ${field.dbType} DEFAULT ${initial} NOT NULL`;
  const defaultValue = defaultSqlValue(field);
  const nullable = field.nullable === undefined ? field.requiredOnCreate !== true : field.nullable;
  return `${field.column} ${field.dbType}${defaultValue ? ` DEFAULT ${defaultValue}` : ""}${nullable ? "" : " NOT NULL"}`;
}

function orderedPhysicalLines(contract, sourceTable, entries) {
  const platformColumns = [
    "id", "company_id", "delete_flag", "revision", "create_user_no", "update_user_no",
    "create_date_time", "update_date_time",
  ];
  if (!sourceTable || !platformColumns.every((column) => sourceTable.fields.some((field) => field.key === column))) {
    return entries.map((entry) => entry.line);
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const baseline = sourceTable.fields.map((field) => byKey.get(field.key)).filter(Boolean);
  const baselineKeys = new Set(baseline.map((entry) => entry.key));
  const extensions = contract.fields
    .map((field) => byKey.get(String(field.column).toLowerCase()))
    .filter((entry) => entry && !baselineKeys.has(entry.key));
  return [...baseline, ...extensions].map((entry) => entry.line);
}

function renderOracleMigration(contract, profile, sourceTable) {
  const gov = resolveGovernance(profile);
  const table = contract.entity.table;
  const sd = gov.softDelete;
  const at = gov.auditTime;
  const { auditColumns } = resolveProfilePolicies(profile);
  const idType = databaseIdType("oracle", profile);
  const actorType = databaseActorType("oracle", profile);
  const required = (nullable) => nullable ? "" : " NOT NULL";
  const physicalEntries = [
    { key: "id", line: `    ID ${idType} NOT NULL` },
    ...contract.fields.map((field) => ({ key: String(field.column).toLowerCase(), line: `    ${columnDefinition(field)}` })),
    { key: "company_id", line: `    COMPANY_ID ${idType} NOT NULL` },
    { key: "delete_flag", line: `    ${sd.column} ${sd.oracleType} DEFAULT ${sd.activeValue} NOT NULL` },
    { key: "revision", line: "    REVISION NUMBER(10) DEFAULT 0 NOT NULL" },
    { key: "create_user_no", line: `    CREATE_USER_NO ${actorType}${required(auditColumns.createUserNullable)}` },
    { key: "update_user_no", line: `    UPDATE_USER_NO ${actorType}${required(auditColumns.updateUserNullable)}` },
    { key: "create_date_time", line: `    CREATE_DATE_TIME ${at.oracleType}${required(auditColumns.createTimeNullable)}` },
    { key: "update_date_time", line: `    UPDATE_DATE_TIME ${at.oracleType}${required(auditColumns.updateTimeNullable)}` },
  ];
  const lines = [
    ...orderedPhysicalLines(contract, sourceTable, physicalEntries),
    `    CONSTRAINT ${sqlName("PK", table, "", 30, "oracle")} PRIMARY KEY (ID)`,
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
    `CREATE INDEX ${sqlName("IDX", table, "TENANT_ACTIVE", 30, "oracle")} ON ${table} (COMPANY_ID, ${sd.column});`,
    ...indexes,
    "",
  ].join("\n");
}

function renderMysqlMigration(contract, profile, sourceTable) {
  const gov = resolveGovernance(profile);
  const table = contract.entity.table;
  const sd = { ...gov.softDelete, column: physicalIdentifier("mysql", gov.softDelete.column) };
  const at = gov.auditTime;
  const { auditColumns } = resolveProfilePolicies(profile);
  const idType = databaseIdType("mysql", profile);
  const actorType = databaseActorType("mysql", profile);
  const nullable = (value) => value ? "NULL" : "NOT NULL";
  const indexLines = (contract.indexes || []).map((index) => indexLine("mysql", index, table, 64));
  const physicalEntries = [
    { key: "id", line: `    id ${idType} NOT NULL COMMENT '主键ID'` },
    ...contract.fields.map((field) => ({ key: String(field.column).toLowerCase(), line: `    ${columnDefinition(field)} COMMENT '${sqlLiteral(field.comment)}'` })),
    { key: "company_id", line: `    company_id ${idType} NOT NULL COMMENT '公司/租户ID'` },
    { key: "delete_flag", line: `    ${sd.column} ${sd.mysqlType} NOT NULL DEFAULT ${sd.activeValue} COMMENT '${softDeleteComment(sd.activeValue, sd.deletedValue)}'` },
    { key: "revision", line: "    revision INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号'" },
    { key: "create_user_no", line: `    create_user_no ${actorType} ${nullable(auditColumns.createUserNullable)} COMMENT '创建人工号'` },
    { key: "update_user_no", line: `    update_user_no ${actorType} ${nullable(auditColumns.updateUserNullable)} COMMENT '更新人工号'` },
    { key: "create_date_time", line: `    create_date_time ${at.mysqlType} ${nullable(auditColumns.createTimeNullable)} COMMENT '创建时间'` },
    { key: "update_date_time", line: `    update_date_time ${at.mysqlType} ${nullable(auditColumns.updateTimeNullable)} COMMENT '更新时间'` },
  ];
  const lines = [
    ...orderedPhysicalLines(contract, sourceTable, physicalEntries),
    "    PRIMARY KEY (id)",
    `    KEY ${sqlName("IDX", table, "TENANT_ACTIVE", 64, "mysql")} (company_id, ${sd.column})`,
    ...indexLines,
  ];
  return [
    `-- contract: ${contract.contractId}`,
    "-- generated by wl-skills-bd; review the diff before Flyway executes it",
    `CREATE TABLE ${table} (`,
    `${lines.join(",\n")}\n) DEFAULT CHARSET=utf8mb4 COMMENT='${sqlLiteral(contract.entity.description)}';`,
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
      statements.push(`ALTER TABLE ${table} ADD ${columnDefinition(f)};`);
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
      clauses.push(`    ADD COLUMN ${columnDefinition(f)} COMMENT '${sqlLiteral(f.comment)}'`);
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

function renderMigration(contract, profile, sourceTable) {
  if (contract.alter) return contract.database === "oracle" ? renderOracleAlter(contract) : renderMysqlAlter(contract);
  return contract.database === "oracle"
    ? renderOracleMigration(contract, profile, sourceTable)
    : renderMysqlMigration(contract, profile, sourceTable);
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
  const context = buildContext(contract, profile, deliveryProfile);
  const sourceConsistency = dbSpec.checkContractAgainstDbSpec(options.projectRoot || process.cwd(), contract, { profile });
  const policy = dbSpec.executionPolicy(contract.environment);
  const { buildCustomTestsSection } = require("./test-codegen");
  const customTestsSection = buildCustomTestsSection(contract, profile);
  const packagePath = contract.rootPackage.replace(/\./g, "/");
  const entity = contract.entity.name;
  const migrationFile = migrationFileBase(contract);
  const sourceTable = sourceConsistency.spec.tables.get(String(contract.entity.table).toLowerCase());
  const migrationSql = renderMigration(contract, profile, sourceTable);
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
    ddlImpactRef: contract.alter && contract.alter.impactRef,
    preChangeEvidence: contract.alter ? preChangeEvidenceSql(contract) : [],
    dbSourceFingerprint: sourceConsistency.fingerprint || "not-configured",
    dbSourceSpecTables: sourceConsistency.spec.tables.size,
    dbSourceGateStatus: sourceConsistency.ok ? "PASS" : "BLOCKED",
    executionLane: policy.lane,
    executionApprovalMode: policy.approvalMode,
    executionRule: policy.rule,
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

/**
 * 机器枚举契约未声明的业务边界（v0.26）：这些疑点没有对错，只有业务口径，
 * 必须在 apply 前由人逐项确认（--questions-reviewed）或修订契约消除。
 * 输出确定性：同一契约恒定生成同一清单，并进入 planHash。
 */
function buildOpenQuestions(contract) {
  const questions = [];
  const operations = Array.isArray(contract.customOperations) ? contract.customOperations : [];
  const stateTransitions = operations.filter((op) => op && op.kind === "stateTransition");
  const idempotency = contract.assurance && contract.assurance.consistency && contract.assurance.consistency.idempotencyStrategy;

  for (const op of operations.filter((op) => op && op.kind === "batch")) {
    questions.push({
      id: `Q-BATCH-${op.name}`,
      area: "批量语义",
      blocking: true,
      question: `批量操作 ${op.name} 收到空集合时的预期行为（直接成功返回 0 还是参数错误）未在契约中声明`,
      hint: "在契约 summary/异常目录中明确空集合口径，并同步到前端 api.md",
    });
  }
  if (stateTransitions.length > 0 && !idempotency) {
    questions.push({
      id: "Q-STATE-CONCURRENCY",
      area: "状态并发",
      blocking: true,
      question: "存在状态转移命令但未声明幂等策略：同一记录两个并发转移（如同时 submit）预期是后者报错还是幂等成功",
      hint: "声明 assurance.consistency.idempotencyStrategy，或确认依赖 REVISION 乐观锁报错即为预期口径",
    });
  }
  for (const op of operations.filter((op) => op && (op.kind === "command") && (op.patch || []).length > 0 && (op.preconditions || []).length === 0)) {
    questions.push({
      id: `Q-CMD-IDEMPOTENT-${op.name}`,
      area: "命令防重",
      blocking: true,
      question: `命令 ${op.name} 无前置状态校验且直接写数据：重复提交（双击/重试）是否需要幂等键或前置状态防重`,
      hint: "补充 preconditions 或在契约中声明防重口径",
    });
  }
  if (contract.api && contract.api.permissions && contract.api.permissions.export) {
    questions.push({
      id: "Q-EXPORT-SCOPE",
      area: "导出边界",
      blocking: true,
      question: "声明了 export：导出行数上限、字段范围（是否含敏感字段脱敏）与权限口径需人工确认",
      hint: "确认导出实现位于 <wl-custom> 保护区且权限码已同步 kit",
    });
  }
  if (Array.isArray(contract.relations) && contract.relations.length > 0) {
    questions.push({
      id: "Q-RELATION-EMPTY",
      area: "关联口径",
      blocking: true,
      question: "存在关联查询：父记录不存在或已被软删时返回空列表还是业务异常，契约未声明",
      hint: "在契约中明确口径，避免前后端各自假设",
    });
  }
  if (contract.alter) {
    questions.push({
      id: "Q-ALTER-DATA",
      area: "存量数据",
      blocking: true,
      question: "ALTER 变更：存量行的回填来源与完成口径、应用兼容窗口（Expand-Contract）需人工确认",
      hint: "确认 alter.impactRef 已登记影响分析结论，回填走分批游标",
    });
  }
  if (!contract.assurance || !contract.assurance.level) {
    questions.push({
      id: "Q-ASSURANCE-LEVEL",
      area: "交付级别",
      blocking: false,
      question: "未声明 assurance.level：按非生产口径生成；若本契约面向生产交付，需补 SLO/RTO/RPO 与六类证据链",
      hint: "生产契约声明 assurance.level=production 并准备 standards/28 证据",
    });
  }
  return questions;
}

/**
 * ALTER 影响分析硬门（v0.26）：配置了 Catalog 时机器执行字段影响分析并留证据；
 * 未配置时必须由 alter.impactRef 登记人工 impact field 结论，否则 plan 直接阻断。
 */
function buildAlterImpact(projectRoot, contract) {
  const columns = [];
  for (const op of contract.alter.operations || []) {
    if (op.type === "add") columns.push(op.field.column);
    else if (op.type === "modify" || op.type === "drop") columns.push(op.column);
  }
  const uniqueColumns = [...new Set(columns)];
  let analysis;
  try {
    analysis = uniqueColumns.map((column) => require("./impact-analysis").analyzeFieldImpact(projectRoot, {
      module: contract.module,
      field: column,
      table: contract.entity && contract.entity.table,
      limit: 20,
    }));
  } catch {
    analysis = null;
  }
  const machineAvailable = analysis
    && analysis.length > 0
    && analysis.every((result) => result && result.ok !== false);
  if (machineAvailable) {
    return {
      mode: "machine",
      columns: analysis.map((result, index) => ({
        column: uniqueColumns[index],
        matches: (result.matches || []).length,
        references: result.evidence ? result.evidence.total : 0,
        errors: result.diagnostics ? result.diagnostics.errors : 0,
        warnings: result.diagnostics ? result.diagnostics.warnings : 0,
        reportHash: result.reportHash,
      })),
    };
  }
  if (contract.alter.impactRef) {
    return { mode: "manual-ref", impactRef: contract.alter.impactRef, columns: uniqueColumns };
  }
  return {
    mode: "blocked",
    columns: uniqueColumns,
    reason: `ALTER 字段影响分析不可用（Catalog 未配置或模块 ${contract.module} 未登记）。两种解法：1) 配置 .wl-skills-bd/catalog.config.json 后重跑，机器自动执行影响分析；2) 人工执行 wl-skills-bd impact field 并把结论登记到 alter.impactRef。禁止未做影响分析直接生成 ALTER`,
  };
}

/** ALTER 执行前的只读证据采集 SQL：结构 + 行数留底，出问题可快速回溯恢复。 */
function preChangeEvidenceSql(contract) {
  const table = contract.entity && contract.entity.table;
  if (!table) return [];
  if (contract.database === "mysql") {
    return [
      `-- MySQL：变更前结构留底（只读）\nSELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION;`,
      `SELECT COUNT(*) AS ROW_COUNT FROM \`${table}\`;`,
    ];
  }
  return [
    `-- Oracle：变更前结构留底（只读）\nSELECT COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(table).toUpperCase()}' ORDER BY COLUMN_ID;`,
    `SELECT COUNT(*) AS ROW_COUNT FROM ${table};`,
  ];
}

function buildPlan(contractFile, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const loaded = loadContract(contractFile, { projectRoot });
  if (!loaded.ok) return { ok: false, projectRoot, contractFile: loaded.file, errors: loaded.errors, actions: [] };
  const { contract, profile, deliveryProfile } = loaded;
  const openQuestions = buildOpenQuestions(contract);
  const alterImpact = contract.alter ? buildAlterImpact(projectRoot, contract) : null;
  const alterImpactBlocker = alterImpact && alterImpact.mode === "blocked"
    ? [{ path: "$.alter.impactRef", message: alterImpact.reason }]
    : [];
  const sourceConsistency = dbSpec.checkContractAgainstDbSpec(projectRoot, contract, { source: loaded.file, profile });
  const sourceErrors = sourceConsistency.issues.filter((issue) => issue.severity === "error");
  if (sourceErrors.length > 0) {
    return {
      ok: false,
      projectRoot,
      contractFile: loaded.file,
      contract,
      sourceConsistency,
      errors: sourceErrors.map((issue) => ({ path: "$.databaseSource", message: issue.message })),
      actions: [],
    };
  }
  const versionConflicts = migrationVersionConflicts(projectRoot, contract);
  if (versionConflicts.length > 0 || alterImpactBlocker.length > 0) {
    return {
      ok: false,
      projectRoot,
      contractFile: loaded.file,
      contract,
      errors: [
        ...versionConflicts.map((conflict) => ({ path: "$.migration.version", message: `Flyway 版本 ${migrationVersion(contract)} 已被其他文件占用：${conflict}` })),
        ...alterImpactBlocker,
      ],
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
    dbSourceFingerprint: sourceConsistency.fingerprint,
    generatorVersion: pkg.version,
    catalogContextHash: catalogPreflight.contextHash || null,
    openQuestions,
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
    warnings: [...(loaded.warnings || []), ...sourceConsistency.issues.filter((issue) => issue.severity === "warn").map((issue) => issue.message)],
    profile,
    state,
    outputs,
    actions,
    summary,
    contractHash,
    openQuestions,
    alterImpact,
    completion,
    implementationEvidence,
    assuranceEvidence,
    catalogPreflight,
    sourceConsistency,
    executionPolicy: dbSpec.executionPolicy(contract.environment),
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
  const blockingQuestions = (fresh.openQuestions || []).filter((question) => question.blocking !== false);
  if (blockingQuestions.length > 0 && options.questionsReviewed !== true) {
    return {
      ok: false,
      reason: "questions-unreviewed",
      openQuestions: blockingQuestions,
      applied: [],
      hint: "plan 含待人工确认的业务闭环疑点（openQuestions）；逐项评审后携带 --questions-reviewed 重新 apply，或先修订契约消除疑点。",
    };
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
  const guarded = writeGuard.guardResult(fresh.projectRoot, options, fresh.contract);
  if (guarded) return guarded;
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
  const reconciliation = dbSpec.reconcileContract(plan.projectRoot, plan.contract, {
    source: plan.contractFile,
    profile: plan.profile,
  });
  return {
    ok: true,
    projectRoot: plan.projectRoot,
    contractFile: plan.contractFile,
    contractId: plan.contract.contractId,
    contractHash: plan.contractHash,
    warnings: plan.warnings || [],
    completion: plan.completion,
    assuranceEvidence: plan.assuranceEvidence,
    catalogPreflight: plan.catalogPreflight,
    openQuestions: plan.openQuestions || [],
    alterImpact: plan.alterImpact,
    databaseSource: {
      ok: plan.sourceConsistency.ok,
      fingerprint: plan.sourceConsistency.fingerprint,
      specTables: plan.sourceConsistency.spec.tables.size,
      extensionTables: plan.sourceConsistency.governance.extensionTables.size,
      extensionFields: [...plan.sourceConsistency.governance.extensionFields.values()].reduce((total, fields) => total + fields.size, 0),
      reconciliation: {
        fields: reconciliation.summary.fields,
        baseline: reconciliation.summary.baseline,
        extension: reconciliation.summary.extension,
        platform: reconciliation.summary.platform,
        mismatched: reconciliation.summary.mismatched,
        warned: reconciliation.summary.warned,
      },
    },
    executionPolicy: plan.executionPolicy,
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
  buildAlterImpact,
  buildOpenQuestions,
  buildPlan,
  detectEnvironment,
  generatedFiles,
  normalizeJavaSource,
  inspectImplementation,
  inspectAssuranceEvidence,
  isProductionGuardBlocked,
  migrationFileBase,
  preChangeEvidenceSql,
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
