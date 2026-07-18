"use strict";

function parse(template) {
  const root = [];
  const stack = [{ name: null, nodes: root }];
  const token = /{{\s*([#^\/]?)([^{}]+?)\s*}}/g;
  let cursor = 0;
  let match;
  while ((match = token.exec(template)) !== null) {
    if (match.index > cursor) stack[stack.length - 1].nodes.push({ type: "text", value: template.slice(cursor, match.index) });
    const marker = match[1];
    const name = match[2].trim();
    if (marker === "#" || marker === "^") {
      const node = { type: marker === "#" ? "section" : "inverted", name, nodes: [] };
      stack[stack.length - 1].nodes.push(node);
      stack.push({ name, nodes: node.nodes });
    } else if (marker === "/") {
      if (stack.length === 1 || stack[stack.length - 1].name !== name) {
        throw new Error(`模板 section 未配对: ${name}`);
      }
      stack.pop();
    } else {
      stack[stack.length - 1].nodes.push({ type: "variable", name });
    }
    cursor = token.lastIndex;
  }
  if (cursor < template.length) stack[stack.length - 1].nodes.push({ type: "text", value: template.slice(cursor) });
  if (stack.length !== 1) throw new Error(`模板 section 未闭合: ${stack[stack.length - 1].name}`);
  return root;
}

function lookup(contexts, name, optional = false) {
  if (name === ".") return contexts[contexts.length - 1];
  const parts = name.split(".");
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    let value = contexts[index];
    let found = true;
    for (const part of parts) {
      if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) {
        found = false;
        break;
      }
      value = value[part];
    }
    if (found) return value;
  }
  if (optional) return undefined;
  throw new Error(`模板变量未提供: ${name}`);
}

function renderNodes(nodes, contexts) {
  let output = "";
  for (const node of nodes) {
    if (node.type === "text") output += node.value;
    else if (node.type === "variable") {
      const value = lookup(contexts, node.name);
      if (["string", "number", "boolean"].includes(typeof value)) output += String(value);
      else throw new Error(`模板变量必须是标量: ${node.name}`);
    } else {
      const value = lookup(contexts, node.name, true);
      const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
      if (node.type === "inverted") {
        if (!truthy) output += renderNodes(node.nodes, contexts);
      } else if (Array.isArray(value)) {
        for (const item of value) output += renderNodes(node.nodes, [...contexts, item]);
      } else if (truthy && typeof value === "object") output += renderNodes(node.nodes, [...contexts, value]);
      else if (truthy) output += renderNodes(node.nodes, contexts);
    }
  }
  return output;
}

function render(template, context) {
  return renderNodes(parse(template), [context]);
}

module.exports = { parse, render };
