"use strict";

function toolResult(text, structuredContent, isError = false) {
  return { text, structuredContent, ...(isError ? { isError: true } : {}) };
}

function previewResult(text, plan) {
  return toolResult(text, { ...plan, ok: true, mode: "preview" });
}

function blockedResult(text, state = "blocked", extra = {}) {
  return toolResult(`❌ ${text}`, { ok: false, state, ...extra }, true);
}

function completedResult(text, extra = {}) {
  return toolResult(text, { ok: true, state: "completed", mode: "apply", ...extra });
}

module.exports = { blockedResult, completedResult, previewResult, toolResult };
