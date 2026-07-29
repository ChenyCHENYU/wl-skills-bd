"use strict";

const VALID_DB_CLUSTERS = Object.freeze(["cx", "non_cx", "pt"]);

const PACKAGE_DB_CLUSTERS = Object.freeze({
  "com.jhict.sale": "cx",
  "com.jhict.quality": "cx",
  "com.jhict.produce": "cx",
  "com.jhict.cost": "cx",
  "com.jhict.safe": "non_cx",
  "com.jhict.env": "non_cx",
  "com.jhict.logistics": "non_cx",
  "com.jhict.energy": "non_cx",
  "com.jhict.mdm": "pt",
});

const DOMAIN_DB_CLUSTERS = Object.freeze({
  sale: "cx",
  quality: "cx",
  produce: "cx",
  cost: "cx",
  safe: "non_cx",
  env: "non_cx",
  logistics: "non_cx",
  energy: "non_cx",
  mdm: "pt",
});

const CLUSTER_DATABASE_DEFAULTS = Object.freeze({
  cx: Object.freeze({ sid: "hx_cxdb1", username: "cxuser" }),
  non_cx: Object.freeze({ sid: "hx_non_cxdb2", username: "nonuser" }),
  pt: Object.freeze({ sid: "hx_ptdb", username: "ptuser" }),
});

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^com\.jhict\./, "")
    .replace(/^wl-/, "")
    .split(/[.-]/)[0];
}

function inferDbCluster(options = {}) {
  if (options.explicit !== undefined && options.explicit !== null && options.explicit !== "") {
    return VALID_DB_CLUSTERS.includes(options.explicit)
      ? { ok: true, cluster: options.explicit, source: "explicit" }
      : { ok: false, reason: "invalid-db-cluster", allowed: VALID_DB_CLUSTERS.slice() };
  }
  if (options.rootPackage && PACKAGE_DB_CLUSTERS[options.rootPackage]) {
    return { ok: true, cluster: PACKAGE_DB_CLUSTERS[options.rootPackage], source: "root-package" };
  }
  for (const [source, value] of [["project", options.project], ["module", options.module]]) {
    const domain = normalizeDomain(value);
    if (DOMAIN_DB_CLUSTERS[domain]) {
      return { ok: true, cluster: DOMAIN_DB_CLUSTERS[domain], source, domain };
    }
  }
  return {
    ok: false,
    reason: "db-cluster-required",
    allowed: VALID_DB_CLUSTERS.slice(),
    hint: "无法从 project/module 推断数据库集群；请显式传 --db-cluster cx|non_cx|pt",
  };
}

function databaseDefaults(cluster) {
  return CLUSTER_DATABASE_DEFAULTS[cluster] || null;
}

module.exports = {
  CLUSTER_DATABASE_DEFAULTS,
  DOMAIN_DB_CLUSTERS,
  PACKAGE_DB_CLUSTERS,
  VALID_DB_CLUSTERS,
  databaseDefaults,
  inferDbCluster,
  normalizeDomain,
};
