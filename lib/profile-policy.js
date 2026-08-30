"use strict";

const DEFAULT_ID_POLICY = Object.freeze({
  javaType: "String",
  maxLength: 64,
  oracleType: "VARCHAR2(64 CHAR)",
  mysqlType: "VARCHAR(64)",
  format: "opaque",
});

const DEFAULT_AUDIT_COLUMNS = Object.freeze({
  actorMaxLength: 64,
  createUserNullable: false,
  updateUserNullable: true,
  createTimeNullable: false,
  updateTimeNullable: true,
});

function resolveProfilePolicies(profile) {
  return {
    idPolicy: { ...DEFAULT_ID_POLICY, ...((profile && profile.idPolicy) || {}) },
    auditColumns: { ...DEFAULT_AUDIT_COLUMNS, ...((profile && profile.auditColumns) || {}) },
  };
}

function validateProfilePolicies(profile) {
  const errors = [];
  const { idPolicy, auditColumns } = resolveProfilePolicies(profile);
  if (idPolicy.javaType !== "String") errors.push("idPolicy.javaType 当前只支持 String");
  if (!Number.isInteger(idPolicy.maxLength) || idPolicy.maxLength < 1 || idPolicy.maxLength > 4000) {
    errors.push("idPolicy.maxLength 必须是 1~4000 的整数");
  }
  if (idPolicy.oracleType !== `VARCHAR2(${idPolicy.maxLength} CHAR)`) {
    errors.push("idPolicy.oracleType 必须与 maxLength 一致并使用 VARCHAR2(n CHAR)");
  }
  if (idPolicy.mysqlType !== `VARCHAR(${idPolicy.maxLength})`) {
    errors.push("idPolicy.mysqlType 必须与 maxLength 一致并使用 VARCHAR(n)");
  }
  if (!['opaque', 'uuid', 'numeric-string'].includes(idPolicy.format)) {
    errors.push("idPolicy.format 只允许 opaque/uuid/numeric-string");
  }
  if (!Number.isInteger(auditColumns.actorMaxLength) || auditColumns.actorMaxLength < 1 || auditColumns.actorMaxLength > 4000) {
    errors.push("auditColumns.actorMaxLength 必须是 1~4000 的整数");
  }
  for (const key of ["createUserNullable", "updateUserNullable", "createTimeNullable", "updateTimeNullable"]) {
    if (typeof auditColumns[key] !== "boolean") errors.push(`auditColumns.${key} 必须是布尔值`);
  }
  return { ok: errors.length === 0, errors, idPolicy, auditColumns };
}

function databaseIdType(database, profile) {
  const { idPolicy } = resolveProfilePolicies(profile);
  return database === "mysql" ? idPolicy.mysqlType : idPolicy.oracleType;
}

function databaseActorType(database, profile) {
  const { auditColumns } = resolveProfilePolicies(profile);
  return database === "mysql"
    ? `VARCHAR(${auditColumns.actorMaxLength})`
    : `VARCHAR2(${auditColumns.actorMaxLength} CHAR)`;
}

module.exports = {
  DEFAULT_AUDIT_COLUMNS,
  DEFAULT_ID_POLICY,
  databaseActorType,
  databaseIdType,
  resolveProfilePolicies,
  validateProfilePolicies,
};
