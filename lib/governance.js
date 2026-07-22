"use strict";

const DEFAULT_GOVERNANCE = Object.freeze({
  softDelete: Object.freeze({
    column: "IS_DELETE",
    javaField: "isDelete",
    activeValue: 1,
    deletedValue: 0,
    mysqlType: "TINYINT(1)",
    oracleType: "NUMBER(1)",
  }),
  auditTime: Object.freeze({
    mysqlType: "VARCHAR(19)",
    oracleType: "VARCHAR2(19 CHAR)",
  }),
});

const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,62}$/;
const MYSQL_SOFT_DELETE_TYPES = new Set(["TINYINT(1)", "INT"]);
const ORACLE_SOFT_DELETE_PATTERN = /^NUMBER\(([1-9])\)$/;
const MYSQL_AUDIT_TIME_PATTERN = /^(?:VARCHAR\(19\)|DATETIME(?:\([0-6]\))?)$/;
const ORACLE_AUDIT_TIME_PATTERN = /^(?:VARCHAR2\(19 CHAR\)|TIMESTAMP(?:\([0-9]\))?)$/;
const SOFT_DELETE_KEYS = ["column", "javaField", "activeValue", "deletedValue", "mysqlType", "oracleType"];
const AUDIT_TIME_KEYS = ["mysqlType", "oracleType"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function applyKnown(target, source, keys) {
  if (!isObject(source)) return;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  }
}

function resolveGovernance(profile) {
  const resolved = {
    softDelete: { ...DEFAULT_GOVERNANCE.softDelete },
    auditTime: { ...DEFAULT_GOVERNANCE.auditTime },
  };
  if (profile) applyKnown(resolved.softDelete, profile.softDelete, SOFT_DELETE_KEYS);
  if (profile) applyKnown(resolved.auditTime, profile.auditTime, AUDIT_TIME_KEYS);
  return resolved;
}

function validateGovernance(profile) {
  const errors = [];
  if (profile && profile.softDelete !== undefined && !isObject(profile.softDelete)) {
    errors.push("softDelete 必须是对象");
  }
  if (profile && isObject(profile.softDelete)) {
    for (const key of Object.keys(profile.softDelete)) {
      if (!SOFT_DELETE_KEYS.includes(key)) errors.push(`softDelete.${key} 不是支持的治理属性`);
    }
    const hasActive = Object.prototype.hasOwnProperty.call(profile.softDelete, "activeValue");
    const hasDeleted = Object.prototype.hasOwnProperty.call(profile.softDelete, "deletedValue");
    if (hasActive !== hasDeleted) errors.push("softDelete.activeValue/deletedValue 必须同时提供");
  }
  if (profile && profile.auditTime !== undefined && !isObject(profile.auditTime)) {
    errors.push("auditTime 必须是对象");
  }
  if (profile && isObject(profile.auditTime)) {
    for (const key of Object.keys(profile.auditTime)) {
      if (!AUDIT_TIME_KEYS.includes(key)) errors.push(`auditTime.${key} 不是支持的治理属性`);
    }
  }
  const governance = resolveGovernance(profile);
  const softDelete = governance.softDelete;
  const auditTime = governance.auditTime;

  if (!COLUMN_PATTERN.test(softDelete.column)) {
    errors.push("softDelete.column 必须是安全的大写数据库列名");
  }
  if (softDelete.javaField !== "isDelete") {
    errors.push("softDelete.javaField 当前必须为 isDelete，以匹配 CoreEntity 扩展契约");
  }
  if (!Number.isInteger(softDelete.activeValue) || !Number.isInteger(softDelete.deletedValue)) {
    errors.push("softDelete.activeValue/deletedValue 必须是整数");
  } else if (softDelete.activeValue === softDelete.deletedValue) {
    errors.push("softDelete.activeValue 不能等于 deletedValue");
  }
  if (!MYSQL_SOFT_DELETE_TYPES.has(softDelete.mysqlType)) {
    errors.push("softDelete.mysqlType 仅支持 TINYINT(1) 或 INT");
  }
  const oracleType = ORACLE_SOFT_DELETE_PATTERN.exec(softDelete.oracleType);
  if (!oracleType) {
    errors.push("softDelete.oracleType 仅支持 NUMBER(1..9)");
  } else if (Number.isInteger(softDelete.activeValue) && Number.isInteger(softDelete.deletedValue)) {
    const max = (10 ** Number(oracleType[1])) - 1;
    if ([softDelete.activeValue, softDelete.deletedValue].some((value) => Math.abs(value) > max)) {
      errors.push(`${softDelete.oracleType} 无法容纳软删除治理值`);
    }
  }
  if (!MYSQL_AUDIT_TIME_PATTERN.test(auditTime.mysqlType)) {
    errors.push("auditTime.mysqlType 仅支持 VARCHAR(19) 或 DATETIME(0..6)");
  }
  if (!ORACLE_AUDIT_TIME_PATTERN.test(auditTime.oracleType)) {
    errors.push("auditTime.oracleType 仅支持 VARCHAR2(19 CHAR) 或 TIMESTAMP(0..9)");
  }
  return { ok: errors.length === 0, errors, governance };
}

function softDeleteComment(activeValue, deletedValue) {
  return `有效标记：${activeValue}=有效，${deletedValue}=已删除`;
}

module.exports = {
  DEFAULT_GOVERNANCE,
  resolveGovernance,
  softDeleteComment,
  validateGovernance,
};
