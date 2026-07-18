"use strict";

const net = require("net");

const DEFAULT_TIMEOUT_MS = 3000;

function probeTcp(host, port, options = {}) {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve({ ok: false, host, port, reason: "missing-host-port", latencyMs: null });
      return;
    }
    const start = Date.now();
    const socket = new net.Socket();
    const timeout = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      finish({ ok: true, host, port, latencyMs: Date.now() - start, reason: null });
    });
    socket.once("timeout", () => {
      finish({ ok: false, host, port, latencyMs: Date.now() - start, reason: "timeout", hint: `TCP 连接 ${host}:${port} 超时（${timeout}ms），检查网络/防火墙/服务是否启动` });
    });
    socket.once("error", (err) => {
      finish({ ok: false, host, port, latencyMs: Date.now() - start, reason: "connection-refused", error: err.message, hint: hintForError(err, host, port) });
    });
    socket.connect(port, host);
  });
}

function hintForError(err, host, port) {
  const code = err.code || "";
  if (code === "ECONNREFUSED") return `服务 ${host}:${port} 拒绝连接（可能未启动或端口错误）`;
  if (code === "ENOTFOUND") return `主机 ${host} 无法解析（DNS 错误或主机名错误）`;
  if (code === "EHOSTUNREACH") return `主机 ${host} 不可达（网络/VPN/防火墙）`;
  if (code === "EACCES") return `端口 ${port} 无权限访问`;
  return `TCP 连接 ${host}:${port} 失败：${err.message}`;
}

async function probeDb(host, port, options = {}) {
  const result = await probeTcp(host, port, options);
  return { ...result, kind: "db", label: "数据库" };
}

async function probeRedis(host, port, options = {}) {
  const result = await probeTcp(host, port, options);
  return { ...result, kind: "redis", label: "Redis" };
}

async function probeNacos(host, port, options = {}) {
  // Nacos host 可能是 host:port 格式
  let actualHost = host;
  let actualPort = port;
  if (!port && typeof host === "string" && host.includes(":")) {
    const parts = host.split(":");
    actualHost = parts[0];
    actualPort = parts[1];
  }
  const result = await probeTcp(actualHost, actualPort, options);
  return { ...result, kind: "nacos", label: "Nacos" };
}

async function probeAll(config, options = {}) {
  const results = [];
  if (config.dbHost && config.dbPort) {
    results.push(await probeDb(config.dbHost, Number(config.dbPort), options));
  }
  if (config.redisHost && config.redisPort) {
    results.push(await probeRedis(config.redisHost, Number(config.redisPort), options));
  }
  if (config.nacosHost) {
    results.push(await probeNacos(config.nacosHost, config.nacosPort || 8848, options));
  }
  return {
    ok: results.every((r) => r.ok),
    results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
    },
  };
}

function parseHostPort(hostPortStr, defaultPort) {
  if (!hostPortStr) return { host: null, port: defaultPort };
  const str = String(hostPortStr);
  if (str.startsWith("http://") || str.startsWith("https://")) {
    const url = new URL(str);
    return { host: url.hostname, port: url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80) };
  }
  if (str.includes(":")) {
    const [h, p] = str.split(":");
    return { host: h, port: Number(p) || defaultPort };
  }
  return { host: str, port: defaultPort };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  parseHostPort,
  probeAll,
  probeDb,
  probeNacos,
  probeRedis,
  probeTcp,
};
