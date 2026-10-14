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
var discovery_exports = {};
__export(discovery_exports, {
  availabilityEntries: () => availabilityEntries,
  discoverySubscription: () => discoverySubscription,
  entityObjectPath: () => entityObjectPath,
  isGridvisBridgeDiscovery: () => isGridvisBridgeDiscovery,
  normalizeDiscovery: () => normalizeDiscovery,
  normalizeDiscoveryPrefix: () => normalizeDiscoveryPrefix,
  normalizeIdentifier: () => normalizeIdentifier,
  parseDiscoveryTopic: () => parseDiscoveryTopic,
  parseJsonPayload: () => parseJsonPayload,
  stableDeviceId: () => stableDeviceId,
  stableEntityId: () => stableEntityId
});
module.exports = __toCommonJS(discovery_exports);
var import_crypto = require("crypto");
const KEY_ALIASES = {
  dev: "device",
  ids: "identifiers",
  mf: "manufacturer",
  mdl: "model",
  sw: "sw_version",
  sn: "serial_number",
  hw: "hw_version",
  o: "origin",
  cmps: "components",
  p: "platform",
  stat_t: "state_topic",
  val_tpl: "value_template",
  avty_t: "availability_topic",
  pl_avail: "payload_available",
  pl_not_avail: "payload_not_available",
  cmd_t: "command_topic",
  cmd_tpl: "command_template",
  uniq_id: "unique_id",
  dev_cla: "device_class",
  unit_of_meas: "unit_of_measurement",
  stat_cla: "state_class",
  sug_dsp_prc: "suggested_display_precision",
  json_attr_t: "json_attributes_topic",
  json_attr_tpl: "json_attributes_template"
};
function normalizeDiscoveryPrefix(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "homeassistant";
  return raw.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/#$/, "");
}
function discoverySubscription(prefix) {
  return `${normalizeDiscoveryPrefix(prefix)}/#`;
}
function parseDiscoveryTopic(topic, prefix) {
  const normalizedPrefix = normalizeDiscoveryPrefix(prefix);
  if (!topic.startsWith(`${normalizedPrefix}/`)) {
    return null;
  }
  const segments = topic.slice(normalizedPrefix.length + 1).split("/");
  if (segments.length < 3 || segments.length > 4 || segments.at(-1) !== "config") {
    return null;
  }
  const component = segments[0];
  const objectId = segments.at(-2);
  if (!component || !objectId || !/^[a-zA-Z0-9_-]+$/.test(component) || !/^[a-zA-Z0-9_-]+$/.test(objectId)) {
    return null;
  }
  if (segments.length === 3) {
    return { prefix: normalizedPrefix, component, objectId, deviceDiscovery: component === "device" };
  }
  const nodeId = segments[1];
  if (!nodeId || !/^[a-zA-Z0-9_-]+$/.test(nodeId)) {
    return null;
  }
  return { prefix: normalizedPrefix, component, nodeId, objectId, deviceDiscovery: false };
}
function normalizeObject(input) {
  var _a;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const source = input;
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = (_a = KEY_ALIASES[key]) != null ? _a : key;
    if (result[normalizedKey] !== void 0 && key !== normalizedKey) {
      continue;
    }
    if (normalizedKey === "device" || normalizedKey === "origin") {
      result[normalizedKey] = normalizeObject(value);
    } else if (normalizedKey === "components" && value && typeof value === "object" && !Array.isArray(value)) {
      const components = {};
      for (const [componentKey, componentValue] of Object.entries(value)) {
        components[componentKey] = normalizeObject(componentValue);
      }
      result.components = components;
    } else if (normalizedKey === "availability" && Array.isArray(value)) {
      result.availability = value.map((entry) => {
        const normalized = normalizeObject(entry);
        if (normalized.availability_topic === void 0 && typeof normalized.topic === "string") {
          normalized.availability_topic = normalized.topic;
        }
        return normalized;
      });
    } else {
      result[normalizedKey] = value;
    }
  }
  if (typeof source["~"] === "string" && result.base_topic === void 0) {
    result.base_topic = source["~"];
  }
  return result;
}
function parseJsonPayload(payload) {
  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? normalizeObject(parsed) : null;
  } catch {
    return null;
  }
}
function resolveTopic(topic, baseTopic) {
  if (typeof topic !== "string" || !topic.trim()) {
    return void 0;
  }
  const value = topic.trim();
  if (value === "~") {
    return baseTopic;
  }
  if (value.startsWith("~/")) {
    return baseTopic ? `${baseTopic}/${value.slice(2)}` : value;
  }
  return value;
}
function entityFromConfig(key, component, config) {
  var _a;
  const baseTopic = typeof config.base_topic === "string" ? config.base_topic : void 0;
  const stateTopic = resolveTopic(config.state_topic, baseTopic);
  const availabilityTopic = resolveTopic(config.availability_topic, baseTopic);
  const jsonAttributesTopic = resolveTopic(config.json_attributes_topic, baseTopic);
  const commandTopic = resolveTopic(config.command_topic, baseTopic);
  const availability = Array.isArray(config.availability) ? config.availability.map((entry) => {
    var _a2;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const normalized = { ...entry };
    const topic = (_a2 = normalized.availability_topic) != null ? _a2 : normalized.topic;
    normalized.availability_topic = resolveTopic(topic, baseTopic);
    return normalized;
  }) : config.availability && typeof config.availability === "object" ? [
    {
      ...config.availability,
      availability_topic: resolveTopic(
        (_a = config.availability.availability_topic) != null ? _a : config.availability.topic,
        baseTopic
      )
    }
  ] : config.availability;
  return {
    key,
    component,
    config: {
      ...config,
      state_topic: stateTopic,
      availability_topic: availabilityTopic,
      json_attributes_topic: jsonAttributesTopic,
      command_topic: commandTopic,
      availability
    },
    uniqueId: typeof config.unique_id === "string" ? config.unique_id : void 0,
    stateTopic,
    availabilityTopic,
    jsonAttributesTopic,
    commandTopic,
    device: config.device,
    origin: config.origin
  };
}
function normalizeDiscovery(topic, prefix, payload) {
  var _a;
  const topicInfo = parseDiscoveryTopic(topic, prefix);
  if (!topicInfo) {
    return null;
  }
  const normalizedPayload = parseJsonPayload(payload);
  if (!normalizedPayload) {
    return null;
  }
  const origin = normalizedPayload.origin;
  if (!origin || typeof origin !== "object" || origin.name !== "GridVis2MQTT") {
    return null;
  }
  const baseTopic = typeof normalizedPayload.base_topic === "string" ? normalizedPayload.base_topic : void 0;
  if (topicInfo.deviceDiscovery) {
    const componentMap = normalizedPayload.components;
    if (!componentMap || typeof componentMap !== "object" || Array.isArray(componentMap)) {
      return null;
    }
    const entities = [];
    for (const [key, value] of Object.entries(componentMap)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const componentConfig = value;
      const component2 = typeof componentConfig.platform === "string" ? componentConfig.platform : "";
      if (!component2) {
        continue;
      }
      const inherited = { ...normalizedPayload, ...componentConfig };
      delete inherited.components;
      delete inherited.platform;
      const entity2 = entityFromConfig(key, component2, inherited);
      entity2.config = { ...inherited, ...entity2.config };
      entity2.device = (_a = inherited.device) != null ? _a : normalizedPayload.device;
      entity2.origin = origin;
      entities.push(entity2);
    }
    return {
      topic,
      prefix: topicInfo.prefix,
      component: topicInfo.component,
      objectId: topicInfo.objectId,
      deviceDiscovery: true,
      device: normalizedPayload.device,
      origin,
      baseTopic,
      entities,
      normalizedPayload
    };
  }
  const component = topicInfo.component;
  const entity = entityFromConfig(topicInfo.objectId, component, normalizedPayload);
  entity.origin = origin;
  return {
    topic,
    prefix: topicInfo.prefix,
    component,
    nodeId: topicInfo.nodeId,
    objectId: topicInfo.objectId,
    deviceDiscovery: false,
    device: normalizedPayload.device,
    origin,
    baseTopic,
    entities: [entity],
    normalizedPayload
  };
}
function normalizeIdentifier(value) {
  const normalized = String(value != null ? value : "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  return normalized || "item";
}
const GRIDVIS_IDENTIFIER_PREFIX = /^gridvis2mqtt_/i;
function removeGridvisIdentifierPrefix(value) {
  return value.replace(GRIDVIS_IDENTIFIER_PREFIX, "");
}
function startsWithIgnoreCase(value, prefix) {
  return value.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}
function deviceIdentifierVariants(discovery) {
  var _a;
  const identifiers = (_a = discovery.device) == null ? void 0 : _a.identifiers;
  const values = Array.isArray(identifiers) ? [...identifiers] : identifiers !== void 0 ? [identifiers] : [];
  if (discovery.nodeId) {
    values.push(discovery.nodeId);
  }
  return values.flatMap((value) => {
    const text = String(value).trim();
    return text ? [text, removeGridvisIdentifierPrefix(text)] : [];
  }).sort((left, right) => right.length - left.length);
}
function removeGridvisEntityDevicePrefix(discovery, value) {
  const raw = value.trim();
  if (!GRIDVIS_IDENTIFIER_PREFIX.test(raw)) {
    return raw;
  }
  for (const identifier of deviceIdentifierVariants(discovery)) {
    const prefix = `${identifier}_`;
    if (startsWithIgnoreCase(raw, prefix)) {
      return raw.slice(prefix.length);
    }
  }
  const withoutPrefix = removeGridvisIdentifierPrefix(raw);
  const deviceId = normalizeIdentifier(removeGridvisIdentifierPrefix(stableDeviceId(discovery)));
  const devicePrefix = `${deviceId}_`;
  return startsWithIgnoreCase(withoutPrefix, devicePrefix) ? withoutPrefix.slice(devicePrefix.length) : withoutPrefix;
}
function hasGridvisBridgeIdentity(discovery) {
  var _a, _b, _c, _d, _e;
  const device = (_c = (_b = discovery.device) != null ? _b : (_a = discovery.entities[0]) == null ? void 0 : _a.device) != null ? _c : {};
  const identifiers = Array.isArray(device.identifiers) ? device.identifiers : device.identifiers === void 0 ? [] : [device.identifiers];
  return ((_d = discovery.nodeId) == null ? void 0 : _d.toLowerCase()) === "gridvis2mqtt" || String((_e = device.model_id) != null ? _e : "").toLowerCase() === "gridvis2mqtt" || identifiers.some((identifier) => String(identifier).toLowerCase() === "gridvis2mqtt_bridge");
}
function shortHash(value) {
  return (0, import_crypto.createHash)("sha1").update(value).digest("hex").slice(0, 8);
}
function stableDeviceId(discovery) {
  var _a, _b;
  if (hasGridvisBridgeIdentity(discovery)) {
    return "gridvis2mqtt";
  }
  if (discovery.nodeId) {
    return normalizeIdentifier(removeGridvisIdentifierPrefix(discovery.nodeId));
  }
  const device = discovery.device;
  const identifiers = device == null ? void 0 : device.identifiers;
  const values = Array.isArray(identifiers) ? identifiers : identifiers !== void 0 ? [identifiers] : [];
  if (values.length) {
    return normalizeIdentifier(
      values.map((value) => removeGridvisIdentifierPrefix(String(value))).sort().join("_")
    );
  }
  return `${normalizeIdentifier(removeGridvisIdentifierPrefix((_a = discovery.nodeId) != null ? _a : discovery.objectId))}_${shortHash(`${discovery.prefix}|${(_b = discovery.nodeId) != null ? _b : ""}|${discovery.objectId}`)}`;
}
function isGridvisBridgeDiscovery(discovery) {
  return hasGridvisBridgeIdentity(discovery);
}
function entityObjectPath(discovery, entity) {
  const source = discovery.deviceDiscovery ? entity.key : discovery.objectId;
  const identifier = removeGridvisEntityDevicePrefix(discovery, String(source));
  if (isGridvisBridgeDiscovery(discovery)) {
    const infoIdentifier = identifier.replace(/^gridvis2mqtt_bridge_/i, "").replace(/^bridge_/i, "").replace(/_homeassistant$/i, "");
    return { entityId: normalizeIdentifier(infoIdentifier), category: "instanceInfo" };
  }
  if (/^device_info_/i.test(identifier)) {
    const infoIdentifier = identifier.replace(/^device_info_/i, "").replace(/_homeassistant$/i, "");
    return { entityId: normalizeIdentifier(infoIdentifier), category: "info" };
  }
  const historyMatch = identifier.match(/^(.+)_history_(.+)$/i);
  if ((historyMatch == null ? void 0 : historyMatch[1]) && historyMatch[2]) {
    return {
      entityId: normalizeIdentifier(historyMatch[1]),
      category: "history",
      historyPeriod: normalizeIdentifier(historyMatch[2])
    };
  }
  return { entityId: normalizeIdentifier(identifier), category: "online" };
}
function stableEntityId(discovery, entity) {
  return entityObjectPath(discovery, entity).entityId;
}
function availabilityEntries(entity) {
  const entries = entity.config.availability;
  if (Array.isArray(entries)) {
    const validEntries = entries.filter(
      (entry) => !!entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.availability_topic === "string" && entry.availability_topic.trim().length > 0
    );
    if (validEntries.length) {
      return validEntries;
    }
  }
  if (entity.availabilityTopic) {
    return [
      {
        availability_topic: entity.availabilityTopic,
        payload_available: entity.config.payload_available,
        payload_not_available: entity.config.payload_not_available
      }
    ];
  }
  return [];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  availabilityEntries,
  discoverySubscription,
  entityObjectPath,
  isGridvisBridgeDiscovery,
  normalizeDiscovery,
  normalizeDiscoveryPrefix,
  normalizeIdentifier,
  parseDiscoveryTopic,
  parseJsonPayload,
  stableDeviceId,
  stableEntityId
});
//# sourceMappingURL=discovery.js.map
