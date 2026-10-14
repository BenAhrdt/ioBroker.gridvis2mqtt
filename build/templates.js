"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var templates_exports = {};
__export(templates_exports, {
  evaluateValueTemplate: () => evaluateValueTemplate,
  isSupportedCommandTemplate: () => isSupportedCommandTemplate,
  jsonAttributesFromPayload: () => jsonAttributesFromPayload,
  jsonObject: () => jsonObject,
  renderCommandTemplate: () => renderCommandTemplate
});
module.exports = __toCommonJS(templates_exports);
function parseJson(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return void 0;
  }
}
function getPath(value, path) {
  var _a;
  let current = value;
  const tokens = (_a = path.match(/(?:^|\.)([a-zA-Z0-9_-]+)|\[(\d+)\]/g)) != null ? _a : [];
  for (const token of tokens) {
    const key = token.startsWith("[") ? Number(token.slice(1, -1)) : token.replace(/^\./, "");
    if (current === null || current === void 0 || typeof current !== "object" && typeof current !== "string") {
      return void 0;
    }
    current = current[key];
  }
  return current;
}
function convert(value, filter) {
  if (!filter) {
    if (value === null || value === void 0) {
      return void 0;
    }
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }
  const name = filter.trim().toLowerCase();
  if (name === "string" || name === "str") {
    return String(value != null ? value : "");
  }
  if (name === "float" || name === "number") {
    const result = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(result) ? result : void 0;
  }
  if (name === "int" || name === "integer") {
    const result = Number.parseInt(String(value), 10);
    return Number.isFinite(result) ? result : void 0;
  }
  if (name === "bool" || name === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "on", "yes", "online"].includes(text)) {
      return true;
    }
    if (["false", "0", "off", "no", "offline"].includes(text)) {
      return false;
    }
    return void 0;
  }
  return void 0;
}
function evaluateValueTemplate(template, payload) {
  var _a, _b;
  if (typeof template !== "string" || !template.trim()) {
    return { supported: true, value: payload };
  }
  const expression = (_a = template.trim().match(/^\{\{\s*(.*?)\s*\}\}$/)) == null ? void 0 : _a[1];
  if (!expression) {
    return { supported: false, error: `Unsupported template syntax: ${template}` };
  }
  const parts = expression.split("|").map((part) => part.trim());
  const source = (_b = parts.shift()) != null ? _b : "";
  const filter = parts.length === 1 ? parts[0] : parts.length === 0 ? void 0 : void 0;
  if (parts.length > 1 || filter && !["float", "number", "int", "integer", "bool", "boolean", "string", "str"].includes(filter.toLowerCase())) {
    return { supported: false, error: `Unsupported template filter: ${template}` };
  }
  let value;
  if (source === "value") {
    value = payload;
  } else if (source.startsWith("value_json")) {
    const suffix = source.slice("value_json".length);
    if (suffix && !/^(?:\.[a-zA-Z0-9_-]+|\[\d+\])+$/.test(suffix)) {
      return { supported: false, error: `Unsupported JSON path in template: ${template}` };
    }
    const parsed = parseJson(payload);
    if (parsed === void 0) {
      return { supported: false, error: "Payload is not valid JSON" };
    }
    value = suffix ? getPath(parsed, suffix) : parsed;
  } else {
    return { supported: false, error: `Unsupported template expression: ${template}` };
  }
  const converted = convert(value, filter);
  if (converted === void 0) {
    return { supported: false, error: `Template produced no supported value: ${template}` };
  }
  return { supported: true, value: converted };
}
function renderCommandTemplate(template, value) {
  var _a;
  if (typeof template !== "string" || !template.trim()) {
    return String(value != null ? value : "");
  }
  const expression = (_a = template.trim().match(/^\{\{\s*(.*?)\s*\}\}$/)) == null ? void 0 : _a[1];
  if (!expression) {
    return null;
  }
  const parts = expression.split("|").map((part) => part.trim());
  const source = parts.shift();
  if (source !== "value" || parts.length > 1) {
    return null;
  }
  if (parts.length === 0) {
    return String(value != null ? value : "");
  }
  const filter = parts[0].toLowerCase();
  if (!["float", "number", "int", "integer", "bool", "boolean", "string", "str"].includes(filter)) {
    return null;
  }
  const converted = convert(value, filter);
  return converted === void 0 ? null : String(converted);
}
function jsonAttributesFromPayload(template, payload) {
  if (typeof template === "string" && template.trim()) {
    const result = evaluateValueTemplate(template, payload);
    return result.supported && result.value !== void 0 ? String(result.value) : null;
  }
  const parsed = parseJson(payload);
  return parsed === void 0 ? null : JSON.stringify(parsed);
}
function isSupportedCommandTemplate(template) {
  return renderCommandTemplate(template, "test") !== null;
}
function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  evaluateValueTemplate,
  isSupportedCommandTemplate,
  jsonAttributesFromPayload,
  jsonObject,
  renderCommandTemplate
});
//# sourceMappingURL=templates.js.map
