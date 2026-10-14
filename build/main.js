"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_node_crypto = require("node:crypto");
var import_mqtt = __toESM(require("mqtt"));
var import_discovery = require("./discovery");
var import_templates = require("./templates");
var import_roles = require("./roles");
var import_device_management = require("./device-management");
const OWNER = "gridvis2mqtt";
const DEVICES_ROOT = "devices";
const DISCOVERY_SYNC_TIMEOUT_MS = 1e4;
const DEVICE_INFO_KEYS = [
  "name",
  "manufacturer",
  "model",
  "serial_number",
  "sw_version",
  "hw_version",
  "connections",
  "origin"
];
const BRIDGE_INFO_ENTITY_IDS = /* @__PURE__ */ new Set(["gridvis2mqtt_url", "gridvis_version", "sw_version"]);
const COMPARISONS_NATIVE_KEY = "comparisons";
const COMPARISON_OBJECT_ROOT = `${DEVICES_ROOT}.comparisons`;
const COMPARISON_NUMBER_FORMAT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const COMPARISON_PERCENTAGE_FORMAT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
function comparisonEntryKey(deviceId, valueStateId) {
  return `${deviceId}|${valueStateId}`;
}
function parseComparisonEntryKey(value) {
  const separator = value.indexOf("|");
  if (separator <= 0 || separator >= value.length - 1) {
    return void 0;
  }
  return { deviceId: value.slice(0, separator), valueStateId: value.slice(separator + 1) };
}
function comparisonDisplayStatePath(comparisonId, entryIndex) {
  return `${COMPARISON_OBJECT_ROOT}.${comparisonId}.value_${entryIndex}`;
}
function comparisonDisplayValue(value, unit, percentage) {
  const numericValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN;
  const formattedValue = Number.isFinite(numericValue) ? COMPARISON_NUMBER_FORMAT.format(numericValue) : value === null || value === void 0 ? "\u2014" : String(value);
  const formattedUnit = unit ? ` ${unit}` : "";
  return `${formattedValue}${formattedUnit} (${COMPARISON_PERCENTAGE_FORMAT.format(percentage)}%)`;
}
function asString(value, fallback = "") {
  return typeof value === "string" ? value : value === void 0 || value === null ? fallback : String(value);
}
function asNumber(value, fallback) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}
function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function optionalText(value) {
  if (value === void 0 || value === null) {
    return void 0;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || void 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    return text || void 0;
  } catch {
    return void 0;
  }
}
function entityCategoryPath(deviceId, category) {
  if (category === "instanceInfo") {
    return "info";
  }
  return `${DEVICES_ROOT}.${deviceId}.${category}`;
}
function deviceAvailabilityPath(deviceId) {
  return `${DEVICES_ROOT}.${deviceId}.available`;
}
function historyEntityAvailabilityPath(deviceId, entityId) {
  return `${DEVICES_ROOT}.${deviceId}.history.${entityId}.available`;
}
function entityBasePath(deviceId, entity) {
  var _a;
  const category = (_a = entity.category) != null ? _a : "online";
  if (category === "instanceInfo") {
    return `info.${entity.entityId}`;
  }
  const parts = [entityCategoryPath(deviceId, category), entity.entityId];
  if (category === "history" && entity.historyPeriod) {
    parts.push(entity.historyPeriod);
  }
  return parts.join(".");
}
function entityPathKey(entity) {
  var _a, _b;
  return [(_a = entity.category) != null ? _a : "online", entity.entityId, (_b = entity.historyPeriod) != null ? _b : ""].join("|");
}
function categoryObjectType(category) {
  return category === "info" ? "channel" : "folder";
}
function entityObjectType(category) {
  return category === "online" ? "channel" : "folder";
}
function isInfoCategory(category) {
  return category === "info" || category === "instanceInfo";
}
function deviceObjectIdsForDevice(deviceId, discovery) {
  var _a, _b, _c;
  if (discovery && (0, import_discovery.isGridvisBridgeDiscovery)(discovery)) {
    return [];
  }
  const devicePath = `${DEVICES_ROOT}.${deviceId}`;
  const infoPath = `${devicePath}.info`;
  const device = (_c = (_b = discovery == null ? void 0 : discovery.device) != null ? _b : (_a = discovery == null ? void 0 : discovery.entities[0]) == null ? void 0 : _a.device) != null ? _c : {};
  const isBridge = discovery ? (0, import_discovery.isGridvisBridgeDiscovery)(discovery) : false;
  const infoKeys = discovery ? DEVICE_INFO_KEYS.filter((key) => key === "origin" || device[key] !== void 0) : DEVICE_INFO_KEYS;
  return [
    devicePath,
    ...isBridge ? [] : [deviceAvailabilityPath(deviceId)],
    infoPath,
    ...infoKeys.flatMap((key) => {
      const entityPath = `${infoPath}.${key}`;
      return [entityPath];
    })
  ];
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const HISTORY_PERIOD_LABELS = {
  today: ["today", "heute"],
  yesterday: ["yesterday", "gestern"],
  thisweek: ["this week", "diese woche"],
  lastweek: ["last week", "letzte woche"],
  thismonth: ["this month", "dieser monat"],
  lastmonth: ["last month", "letzter monat"],
  thisyear: ["this year", "dieses jahr"],
  lastyear: ["last year", "letztes jahr"],
  last3months: ["last 3 months", "letzte 3 monate"]
};
function historyMetricName(value, period) {
  var _a;
  const name = asString(value);
  if (!name || !period) {
    return name;
  }
  for (const label of (_a = HISTORY_PERIOD_LABELS[period.toLowerCase()]) != null ? _a : []) {
    const suffix = new RegExp(`\\s*(?:[-\u2013\u2014:]\\s*)?${escapeRegExp(label)}\\s*$`, "i");
    const baseName = name.replace(suffix, "").trim();
    if (baseName && baseName !== name) {
      return baseName;
    }
  }
  return name;
}
function historyPeriodName(value, period) {
  var _a;
  const name = asString(value).trim();
  if (!period || !name) {
    return period != null ? period : name;
  }
  for (const label of (_a = HISTORY_PERIOD_LABELS[period.toLowerCase()]) != null ? _a : []) {
    const suffix = new RegExp(`(?:[-\u2013\u2014:]\\s*)?(${escapeRegExp(label)})\\s*$`, "i");
    const match = name.match(suffix);
    if (match == null ? void 0 : match[1]) {
      return match[1];
    }
  }
  return period;
}
function markerOf(object) {
  var _a;
  if (!(object == null ? void 0 : object.native) || typeof object.native !== "object") {
    return void 0;
  }
  const native = object.native;
  const marker = (_a = native[OWNER]) != null ? _a : native.adapter === OWNER ? native : void 0;
  return marker && typeof marker === "object" && !Array.isArray(marker) ? marker : void 0;
}
function isOwned(object) {
  var _a;
  return ((_a = markerOf(object)) == null ? void 0 : _a.adapter) === OWNER;
}
function objectMarker(kind, discoveryTopic, deviceId) {
  return { adapter: OWNER, kind, ...discoveryTopic ? { discoveryTopic } : {}, ...deviceId ? { deviceId } : {} };
}
function optionsToStates(options) {
  if (!Array.isArray(options)) {
    return void 0;
  }
  const states = {};
  for (const option of options) {
    if (typeof option === "string" || typeof option === "number") {
      states[String(option)] = String(option);
    }
  }
  return Object.keys(states).length ? states : void 0;
}
function availabilityValue(payload, entry) {
  const template = entry.value_template;
  if (template) {
    const result = (0, import_templates.evaluateValueTemplate)(template, payload);
    if (!result.supported) {
      return void 0;
    }
    if (typeof result.value === "boolean") {
      return result.value;
    }
    if (typeof result.value === "string") {
      payload = result.value;
    }
  }
  const available = entry.payload_available;
  const unavailable = entry.payload_not_available;
  if (available !== void 0 && payload === String(available)) {
    return true;
  }
  if (unavailable !== void 0 && payload === String(unavailable)) {
    return false;
  }
  const normalized = payload.trim().toLowerCase();
  if (["true", "1", "on", "online", "available"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "off", "offline", "unavailable"].includes(normalized)) {
    return false;
  }
  return void 0;
}
function coerceStateValue(value, entity) {
  if (typeof value !== "string") {
    return value;
  }
  if (["binary_sensor", "switch", "lock"].includes(entity.component)) {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "yes", "online"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "off", "no", "offline"].includes(normalized)) {
      return false;
    }
  }
  if (entity.component === "number" || (0, import_roles.isNumericSensor)(entity)) {
    const number = Number(value.trim());
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return value;
}
class Gridvis2mqtt extends utils.Adapter {
  mqttClient;
  discoveries = /* @__PURE__ */ new Map();
  prefix = "homeassistant";
  mqttConnected = false;
  shuttingDown = false;
  messageCount = 0;
  topicReferences = /* @__PURE__ */ new Map();
  subscribedTopics = /* @__PURE__ */ new Set();
  topicConsumers = /* @__PURE__ */ new Map();
  runtimes = /* @__PURE__ */ new Map();
  stateActions = /* @__PURE__ */ new Map();
  comparisonDefinitions = [];
  messageQueue = Promise.resolve();
  discoverySyncTimer;
  deviceManagerRefreshTimer;
  discoverySyncActive = false;
  discoverySyncSeen = /* @__PURE__ */ new Set();
  deviceManagement;
  constructor(options = {}) {
    super({ ...options, name: "gridvis2mqtt" });
    this.on("ready", () => void this.onReady());
    this.on("stateChange", (id, state) => void this.onStateChange(id, state));
    this.on("unload", this.onUnload.bind(this));
  }
  get configValues() {
    return this.config;
  }
  async onReady() {
    await this.setStateAsync("info.connection", false, true);
    await this.setStateAsync("info.lastError", "", true);
    await this.setStateAsync("info.messagesReceived", 0, true);
    await this.ensureRootObjects();
    await this.loadComparisonDefinitions();
    this.deviceManagement = new import_device_management.Gridvis2mqttDeviceManagement(this);
    this.prefix = (0, import_discovery.normalizeDiscoveryPrefix)(this.configValues.discoveryPrefix);
    this.subscribeStates("devices.*.*.*");
    this.subscribeStates("devices.*.*.*.*");
    this.subscribeStates("devices.*.*.*.*.*");
    if (this.configValues.enabled === false) {
      this.log.info("Adapter is disabled in the configuration");
      return;
    }
    try {
      this.createMqttClient();
    } catch (error) {
      this.reportError("Could not create the MQTT client", error);
    }
  }
  async ensureRootObjects() {
    var _a;
    const existing = await this.getObjectAsync(DEVICES_ROOT);
    const existingNative = (existing == null ? void 0 : existing.native) && typeof existing.native === "object" && !Array.isArray(existing.native) ? existing.native : {};
    const existingMarker = (_a = markerOf(existing)) != null ? _a : objectMarker("root");
    await this.upsertObject(
      DEVICES_ROOT,
      {
        type: "folder",
        common: { name: "GridVis2MQTT devices" },
        native: { ...existingNative, [OWNER]: existingMarker }
      },
      "root"
    );
  }
  async loadComparisonDefinitions() {
    const root = await this.getObjectAsync(DEVICES_ROOT);
    const rootMarker = markerOf(root);
    const rootRaw = rootMarker == null ? void 0 : rootMarker[COMPARISONS_NATIVE_KEY];
    const instance = await this.getForeignObjectAsync(this.namespace);
    const instanceNative = instance == null ? void 0 : instance.native;
    const legacyRaw = instanceNative && typeof instanceNative === "object" && !Array.isArray(instanceNative) ? instanceNative[COMPARISONS_NATIVE_KEY] : void 0;
    const raw = Array.isArray(rootRaw) ? rootRaw : legacyRaw;
    if (!Array.isArray(raw)) {
      this.comparisonDefinitions = [];
      return;
    }
    this.comparisonDefinitions = raw.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const record = value;
      const id = optionalText(record.id);
      const name = optionalText(record.name);
      if (!id || !name || !Array.isArray(record.entries)) {
        return [];
      }
      const entries = record.entries.flatMap((entryValue) => {
        var _a, _b, _c;
        if (!entryValue || typeof entryValue !== "object" || Array.isArray(entryValue)) {
          return [];
        }
        const entry = entryValue;
        const deviceId = optionalText(entry.deviceId);
        const valueStateId = optionalText(entry.valueStateId);
        const category = entry.category === "history" ? "history" : entry.category === "online" ? "online" : void 0;
        if (!deviceId || !valueStateId || !category) {
          return [];
        }
        return [
          {
            key: (_a = optionalText(entry.key)) != null ? _a : comparisonEntryKey(deviceId, valueStateId),
            deviceId,
            deviceName: (_b = optionalText(entry.deviceName)) != null ? _b : deviceId,
            valueStateId,
            category,
            name: (_c = optionalText(entry.name)) != null ? _c : valueStateId,
            ...optionalText(entry.unit) ? { unit: optionalText(entry.unit) } : {},
            ...optionalText(entry.period) ? { period: optionalText(entry.period) } : {}
          }
        ];
      });
      return entries.length ? [{ id, name, entries }] : [];
    });
    if (!Array.isArray(rootRaw) && Array.isArray(legacyRaw) && this.comparisonDefinitions.length) {
      await this.saveComparisonDefinitions();
    }
  }
  async saveComparisonDefinitions() {
    var _a, _b;
    const root = await this.getObjectAsync(DEVICES_ROOT);
    if (!root) {
      throw new Error(`Cannot persist comparisons: missing object ${DEVICES_ROOT}`);
    }
    const native = root.native && typeof root.native === "object" && !Array.isArray(root.native) ? root.native : {};
    const marker = (_a = markerOf(root)) != null ? _a : objectMarker("root");
    await this.setObjectAsync(DEVICES_ROOT, {
      type: "folder",
      common: { name: asString((_b = root.common) == null ? void 0 : _b.name, "GridVis2MQTT devices") },
      native: {
        ...native,
        [OWNER]: {
          ...marker,
          [COMPARISONS_NATIVE_KEY]: this.comparisonDefinitions
        }
      }
    });
  }
  createMqttClient() {
    const config = this.configValues;
    const configuredProtocol = config.protocol === "mqtts" ? "mqtts" : "mqtt";
    let brokerUrl = asString(config.brokerUrl).trim();
    if (!brokerUrl) {
      const host = asString(config.host, "localhost").trim() || "localhost";
      const defaultPort = configuredProtocol === "mqtts" ? 8883 : 1883;
      brokerUrl = `${configuredProtocol}://${host}:${asNumber(config.port, defaultPort)}`;
    } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(brokerUrl)) {
      brokerUrl = `${configuredProtocol}://${brokerUrl}`;
    }
    const protocol = /^mqtts:\/\//i.test(brokerUrl) ? "mqtts" : "mqtt";
    const options = {
      protocol,
      keepalive: Math.max(15, asNumber(config.keepalive, 60)),
      clientId: asString(config.clientId).trim() || void 0,
      username: asString(config.username) || void 0,
      password: asString(config.password) || void 0,
      protocolVersion: 5,
      clean: true,
      resubscribe: false
    };
    if (protocol === "mqtts") {
      options.rejectUnauthorized = asBoolean(config.rejectUnauthorized, true);
      if (config.ca) {
        options.ca = config.ca;
      }
      if (config.cert) {
        options.cert = config.cert;
      }
      if (config.key) {
        options.key = config.key;
      }
    }
    this.log.info(`Connecting to MQTT broker ${brokerUrl.replace(/:\/\/[^/@]+@/, "://***@")}`);
    this.mqttClient = import_mqtt.default.connect(brokerUrl, options);
    this.mqttClient.on("connect", () => void this.onMqttConnect());
    this.mqttClient.on("message", (topic, payload) => {
      this.noteDiscoverySyncMessage(topic, payload);
      this.messageQueue = this.messageQueue.then(() => this.handleMqttMessage(topic, payload)).catch((error) => this.reportError("Error processing an MQTT message", error));
    });
    this.mqttClient.on("error", (error) => this.reportError("MQTT error", error));
    this.mqttClient.on("close", () => {
      this.mqttConnected = false;
      this.cancelDiscoverySync();
      this.subscribedTopics.clear();
      void this.setStateAsync("info.connection", false, true);
    });
    this.mqttClient.on("offline", () => {
      this.mqttConnected = false;
      this.cancelDiscoverySync();
      void this.setStateAsync("info.connection", false, true);
    });
  }
  async onMqttConnect() {
    if (this.shuttingDown || !this.mqttClient) {
      return;
    }
    this.mqttConnected = true;
    await this.setStateAsync("info.connection", true, true);
    await this.setStateAsync("info.lastError", "", true);
    this.startDiscoverySync();
    await this.subscribeMqtt((0, import_discovery.discoverySubscription)(this.prefix));
    for (const topic of this.topicReferences.keys()) {
      await this.subscribeMqtt(topic);
    }
  }
  startDiscoverySync() {
    this.cancelDiscoverySync();
    this.discoverySyncActive = true;
    this.restartDiscoverySyncTimer();
  }
  restartDiscoverySyncTimer() {
    if (!this.discoverySyncActive) {
      return;
    }
    if (this.discoverySyncTimer) {
      clearTimeout(this.discoverySyncTimer);
    }
    this.discoverySyncTimer = setTimeout(() => {
      this.discoverySyncTimer = void 0;
      this.messageQueue = this.messageQueue.then(() => this.finishDiscoverySync()).catch((error) => this.reportError("Error synchronizing MQTT discovery", error));
    }, DISCOVERY_SYNC_TIMEOUT_MS);
  }
  noteDiscoverySyncMessage(topic, payload) {
    if (!this.discoverySyncActive || !(0, import_discovery.parseDiscoveryTopic)(topic, this.prefix)) {
      return;
    }
    const isAcceptedDiscovery = payload.length === 0 || (0, import_discovery.normalizeDiscovery)(topic, this.prefix, payload) !== null;
    if (!isAcceptedDiscovery) {
      return;
    }
    this.discoverySyncSeen.add(topic);
    this.restartDiscoverySyncTimer();
  }
  cancelDiscoverySync() {
    if (this.discoverySyncTimer) {
      clearTimeout(this.discoverySyncTimer);
      this.discoverySyncTimer = void 0;
    }
    this.discoverySyncActive = false;
    this.discoverySyncSeen.clear();
  }
  scheduleDeviceManagerRefresh() {
    if (this.shuttingDown || !this.deviceManagement || this.deviceManagerRefreshTimer) {
      return;
    }
    const deviceManagement = this.deviceManagement;
    this.deviceManagerRefreshTimer = setTimeout(() => {
      this.deviceManagerRefreshTimer = void 0;
      void deviceManagement.refreshCards().catch((error) => this.reportError("Could not refresh the Device Manager cards", error));
    }, 250);
  }
  async finishDiscoverySync() {
    if (!this.discoverySyncActive) {
      return;
    }
    this.discoverySyncActive = false;
    const seenTopics = new Set(this.discoverySyncSeen);
    this.discoverySyncSeen.clear();
    if (!this.mqttConnected) {
      return;
    }
    let removedDiscoveries = 0;
    for (const topic of [...this.discoveries.keys()]) {
      if (seenTopics.has(topic)) {
        continue;
      }
      await this.removeDiscovery(topic);
      removedDiscoveries += 1;
    }
    const removedObjects = await this.cleanupOrphanedObjects();
    this.log.info(
      `Finished GridVis2MQTT discovery synchronization; removed ${removedDiscoveries} stale discoveries and ${removedObjects} orphaned objects`
    );
  }
  async cleanupOrphanedObjects() {
    var _a, _b, _c;
    const referenced = /* @__PURE__ */ new Set([DEVICES_ROOT]);
    for (const record of this.discoveries.values()) {
      for (const objectId of (_a = record.objectIds) != null ? _a : []) {
        referenced.add(objectId);
      }
      for (const objectId of (_b = record.deviceObjectIds) != null ? _b : []) {
        referenced.add(objectId);
      }
      for (const entity of record.entities) {
        for (const objectId of (_c = entity.objectIds) != null ? _c : []) {
          referenced.add(objectId);
        }
      }
    }
    referenced.add(COMPARISON_OBJECT_ROOT);
    for (const definition of this.comparisonDefinitions) {
      referenced.add(`${COMPARISON_OBJECT_ROOT}.${definition.id}`);
      definition.entries.forEach(
        (_entry, index) => referenced.add(comparisonDisplayStatePath(definition.id, index))
      );
    }
    const prefix = `${this.namespace}.${DEVICES_ROOT}`;
    const objects = await this.getObjectListAsync({
      startkey: prefix,
      endkey: `${prefix}\u9999`
    });
    const orphaned = objects.rows.filter((row) => {
      const relativeId = row.id.startsWith(`${this.namespace}.`) ? row.id.slice(this.namespace.length + 1) : row.id;
      return relativeId !== DEVICES_ROOT && !referenced.has(relativeId);
    }).sort((left, right) => right.id.length - left.id.length);
    for (const row of orphaned) {
      const relativeId = row.id.startsWith(`${this.namespace}.`) ? row.id.slice(this.namespace.length + 1) : row.id;
      await this.deleteManagedObject(relativeId, "startup-reconciliation");
    }
    return orphaned.length;
  }
  mqttQos() {
    return Math.min(2, Math.max(0, Math.round(asNumber(this.configValues.qos, 0))));
  }
  async subscribeMqtt(topic) {
    if (!this.mqttClient || !this.mqttConnected || this.subscribedTopics.has(topic)) {
      return;
    }
    const options = { qos: this.mqttQos() };
    await new Promise((resolve, reject) => {
      var _a;
      (_a = this.mqttClient) == null ? void 0 : _a.subscribe(topic, options, (error) => error ? reject(error) : resolve());
    });
    this.subscribedTopics.add(topic);
  }
  async unsubscribeMqtt(topic) {
    if (!this.mqttClient || !this.mqttConnected || !this.subscribedTopics.has(topic)) {
      return;
    }
    await new Promise((resolve, reject) => {
      var _a;
      (_a = this.mqttClient) == null ? void 0 : _a.unsubscribe(topic, (error) => error ? reject(error) : resolve());
    });
    this.subscribedTopics.delete(topic);
  }
  async addTopicReference(topic, consumer) {
    var _a, _b;
    if (!topic) {
      return;
    }
    this.topicReferences.set(topic, ((_a = this.topicReferences.get(topic)) != null ? _a : 0) + 1);
    const consumers = (_b = this.topicConsumers.get(topic)) != null ? _b : /* @__PURE__ */ new Set();
    consumers.add(consumer);
    this.topicConsumers.set(topic, consumers);
    await this.subscribeMqtt(topic);
    if (topic.endsWith("/availability")) {
      this.log.debug(`Subscribed GridVis2MQTT availability topic ${topic}`);
    }
  }
  async removeTopicReference(topic, consumer) {
    var _a;
    if (!topic) {
      return;
    }
    const consumers = this.topicConsumers.get(topic);
    consumers == null ? void 0 : consumers.delete(consumer);
    if (consumers && consumers.size > 0) {
      this.topicConsumers.set(topic, consumers);
    } else {
      this.topicConsumers.delete(topic);
    }
    const count = ((_a = this.topicReferences.get(topic)) != null ? _a : 0) - 1;
    if (count > 0) {
      this.topicReferences.set(topic, count);
    } else {
      this.topicReferences.delete(topic);
      await this.unsubscribeMqtt(topic).catch(
        (error) => this.reportError(`Could not unsubscribe from ${topic}`, error)
      );
    }
  }
  async handleMqttMessage(topic, payload) {
    this.messageCount += 1;
    void this.setStateAsync("info.messagesReceived", this.messageCount, true);
    if (payload.length > 1024 * 1024) {
      this.log.warn(`Ignoring an MQTT payload larger than 1 MiB on ${topic}`);
      return;
    }
    const topicInfo = (0, import_discovery.parseDiscoveryTopic)(topic, this.prefix);
    if (topicInfo) {
      if (payload.length === 0) {
        if (this.discoveries.has(topic)) {
          await this.removeDiscovery(topic);
        }
        return;
      }
      const discovery = (0, import_discovery.normalizeDiscovery)(topic, this.prefix, payload);
      if (discovery) {
        await this.applyDiscovery(discovery);
      }
      return;
    }
    const consumers = this.topicConsumers.get(topic);
    if (!consumers) {
      if (topic.endsWith("/availability")) {
        this.log.warn(`Received GridVis2MQTT availability topic without a runtime consumer: ${topic}`);
      }
      return;
    }
    for (const runtimeKey of consumers) {
      const runtime = this.runtimes.get(runtimeKey);
      if (runtime) {
        await this.processEntityMessage(runtime, topic, payload.toString("utf8"));
      }
    }
  }
  async applyDiscovery(discovery) {
    const previousRecord = this.discoveries.get(discovery.topic);
    const runtimeReady = previousRecord == null ? void 0 : previousRecord.entities.every(
      (entity) => this.runtimes.has(`${discovery.topic}|${entity.key}`)
    );
    if (previousRecord && runtimeReady && JSON.stringify(previousRecord.discovery.normalizedPayload) === JSON.stringify(discovery.normalizedPayload)) {
      return;
    }
    const record = await this.buildDiscoveryRecord(discovery);
    if (previousRecord) {
      const preservedObjectIds = /* @__PURE__ */ new Set([
        ...record.objectIds,
        ...record.deviceObjectIds,
        ...record.entities.flatMap((entity) => entity.objectIds)
      ]);
      await this.removeDiscovery(discovery.topic, preservedObjectIds, false);
    }
    this.discoveries.set(discovery.topic, record);
    await this.installDiscovery(discovery, record);
    this.scheduleDeviceManagerRefresh();
    this.log.debug(`Accepted GridVis2MQTT discovery ${discovery.topic}`);
  }
  async getDeviceManagerDevices() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v;
    const devices = /* @__PURE__ */ new Map();
    const addEntity = (device, category, entity) => {
      const entities = device[category];
      if (!entities.some((candidate) => candidate.valueStateId === entity.valueStateId)) {
        entities.push(entity);
      }
    };
    for (const record of this.discoveries.values()) {
      if ((0, import_discovery.isGridvisBridgeDiscovery)(record.discovery)) {
        continue;
      }
      const sourceDevice = (_c = (_b = record.discovery.device) != null ? _b : (_a = record.discovery.entities[0]) == null ? void 0 : _a.device) != null ? _c : {};
      const discoveryIcon = (_d = optionalText(sourceDevice.icon)) != null ? _d : record.discovery.entities.map((entity) => optionalText(entity.config.icon)).find((value) => !!value);
      const current = devices.get(record.deviceId);
      const device = current != null ? current : {
        id: record.deviceId,
        originalName: (_e = optionalText(sourceDevice.name)) != null ? _e : record.deviceId,
        name: (_f = optionalText(sourceDevice.name)) != null ? _f : record.deviceId,
        identifier: (_g = optionalText(sourceDevice.serial_number)) != null ? _g : record.deviceId,
        icon: discoveryIcon,
        manufacturer: optionalText(sourceDevice.manufacturer),
        model: (_h = optionalText(sourceDevice.model)) != null ? _h : optionalText(sourceDevice.model_id),
        serialNumber: optionalText(sourceDevice.serial_number),
        availableStateId: deviceAvailabilityPath(record.deviceId),
        online: [],
        history: [],
        info: []
      };
      if (!current) {
        devices.set(record.deviceId, device);
      } else {
        device.name = device.originalName === record.deviceId ? (_i = optionalText(sourceDevice.name)) != null ? _i : device.originalName : device.originalName;
        device.name = (_j = device.customName) != null ? _j : device.originalName;
        (_k = device.icon) != null ? _k : device.icon = discoveryIcon;
        (_l = device.manufacturer) != null ? _l : device.manufacturer = optionalText(sourceDevice.manufacturer);
        (_n = device.model) != null ? _n : device.model = (_m = optionalText(sourceDevice.model)) != null ? _m : optionalText(sourceDevice.model_id);
        (_o = device.serialNumber) != null ? _o : device.serialNumber = optionalText(sourceDevice.serial_number);
        (_q = device.identifier) != null ? _q : device.identifier = (_p = device.serialNumber) != null ? _p : record.deviceId;
      }
      const infoValues = {
        ...sourceDevice,
        origin: record.discovery.origin
      };
      for (const key of DEVICE_INFO_KEYS) {
        if (infoValues[key] === void 0) {
          continue;
        }
        addEntity(device, "info", {
          name: key,
          valueStateId: `${DEVICES_ROOT}.${record.deviceId}.info.${key}`
        });
      }
      for (const entityRecord of record.entities) {
        const entity = record.discovery.entities.find((candidate) => candidate.key === entityRecord.key);
        if (!entity) {
          continue;
        }
        const category = (_r = entityRecord.category) != null ? _r : "online";
        if (category === "instanceInfo") {
          continue;
        }
        const normalizedInfoName = `${entityRecord.entityId}${asString(entity.config.name)}`.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (category === "info" && normalizedInfoName.includes("iconurl")) {
          device.iconStateId = entityRecord.valueStateId;
        }
        const name = category === "history" ? `${historyMetricName(entity.config.name, entityRecord.historyPeriod)} (${historyPeriodName(
          entity.config.name,
          entityRecord.historyPeriod
        )})` : asString(entity.config.name, entityRecord.entityId);
        addEntity(device, category, {
          name,
          valueStateId: entityRecord.valueStateId,
          ...category === "history" && entityRecord.historyPeriod ? { period: entityRecord.historyPeriod } : {},
          ...typeof entity.config.unit_of_measurement === "string" ? { unit: entity.config.unit_of_measurement } : {}
        });
      }
    }
    const result = [...devices.values()];
    await Promise.all(
      result.map(async (device) => {
        var _a2;
        const object = await this.getObjectAsync(`${DEVICES_ROOT}.${device.id}`);
        const customName = optionalText((_a2 = markerOf(object)) == null ? void 0 : _a2.displayName);
        device.customName = customName;
        device.name = customName != null ? customName : device.originalName;
      })
    );
    const physicalDevices = new Map(result.map((device) => [device.id, device]));
    for (const definition of this.comparisonDefinitions) {
      const online = [];
      const history = [];
      for (const [entryIndex, entry] of definition.entries.entries()) {
        const source = physicalDevices.get(entry.deviceId);
        const sourceEntity = source == null ? void 0 : source[entry.category].find(
          (entity2) => entity2.valueStateId === entry.valueStateId
        );
        const sourceName = (_s = source == null ? void 0 : source.name) != null ? _s : entry.deviceName;
        const entity = {
          name: `${sourceName} \xB7 ${(_t = sourceEntity == null ? void 0 : sourceEntity.name) != null ? _t : entry.name}`,
          valueStateId: entry.valueStateId,
          displayStateId: comparisonDisplayStatePath(definition.id, entryIndex),
          ...((_u = sourceEntity == null ? void 0 : sourceEntity.unit) != null ? _u : entry.unit) ? { unit: (_v = sourceEntity == null ? void 0 : sourceEntity.unit) != null ? _v : entry.unit } : {},
          ...entry.period ? { period: entry.period } : {}
        };
        (entry.category === "history" ? history : online).push(entity);
      }
      result.push({
        id: `comparison:${definition.id}`,
        originalName: definition.name,
        name: definition.name,
        kind: "comparison",
        comparison: definition,
        identifier: `comparison:${definition.id}`,
        manufacturer: "GridVis2MQTT",
        model: "Comparison",
        availableStateId: "",
        online,
        history,
        info: []
      });
    }
    await this.updateComparisonDisplayValues();
    return result.sort((left, right) => left.name.localeCompare(right.name, "de", { sensitivity: "base" }));
  }
  async updateComparisonDisplayValues() {
    if (!this.comparisonDefinitions.length) {
      return;
    }
    await this.upsertObject(
      COMPARISON_OBJECT_ROOT,
      {
        type: "folder",
        common: { name: "Comparisons" },
        native: objectMarker("comparison-root")
      },
      "comparison"
    );
    for (const definition of this.comparisonDefinitions) {
      const comparisonPath = `${COMPARISON_OBJECT_ROOT}.${definition.id}`;
      await this.upsertObject(
        comparisonPath,
        {
          type: "channel",
          common: { name: definition.name },
          native: objectMarker("comparison", void 0, definition.id)
        },
        "comparison"
      );
      for (const [entryIndex, entry] of definition.entries.entries()) {
        await this.upsertObject(
          comparisonDisplayStatePath(definition.id, entryIndex),
          {
            type: "state",
            common: {
              name: entry.name,
              type: "string",
              role: "text",
              read: true,
              write: false,
              def: ""
            },
            native: objectMarker("comparison-value", void 0, definition.id)
          },
          "comparison"
        );
      }
      for (const [entryIndex, entry] of definition.entries.entries()) {
        const sourceState = await this.getStateAsync(entry.valueStateId);
        const comparableEntries = definition.entries.filter(
          (candidate) => candidate.category === entry.category && (entry.category === "online" || candidate.period === entry.period)
        );
        const values = await Promise.all(
          comparableEntries.map(async (candidate) => {
            const value = await this.getStateAsync(candidate.valueStateId);
            return typeof (value == null ? void 0 : value.val) === "number" ? value.val : typeof (value == null ? void 0 : value.val) === "string" && value.val.trim() ? Number(value.val.trim()) : Number.NaN;
          })
        );
        const currentValue = typeof (sourceState == null ? void 0 : sourceState.val) === "number" ? sourceState.val : typeof (sourceState == null ? void 0 : sourceState.val) === "string" && sourceState.val.trim() ? Number(sourceState.val.trim()) : Number.NaN;
        const total = values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
        const percentage = Number.isFinite(currentValue) && total !== 0 ? currentValue / total * 100 : 0;
        await this.setStateAsync(
          comparisonDisplayStatePath(definition.id, entryIndex),
          comparisonDisplayValue(sourceState == null ? void 0 : sourceState.val, entry.unit, percentage),
          true
        );
      }
    }
  }
  async getDeviceManagerComparisonOptions() {
    const devices = (await this.getDeviceManagerDevices()).filter((device) => device.kind !== "comparison");
    return devices.map((device) => ({
      label: device.name,
      items: [
        ...device.online.map((entity) => ({
          value: comparisonEntryKey(device.id, entity.valueStateId),
          label: `Online \xB7 ${entity.name}${entity.unit ? ` (${entity.unit})` : ""}`
        })),
        ...device.history.map((entity) => ({
          value: comparisonEntryKey(device.id, entity.valueStateId),
          label: `History \xB7 ${entity.name}${entity.unit ? ` (${entity.unit})` : ""}`
        }))
      ]
    })).filter((group) => group.items.length > 0);
  }
  async saveDeviceManagerComparison(id, name, entryKeys) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("A comparison name is required");
    }
    const devices = (await this.getDeviceManagerDevices()).filter((device) => device.kind !== "comparison");
    const entities = /* @__PURE__ */ new Map();
    for (const device of devices) {
      for (const category of ["online", "history"]) {
        for (const entity of device[category]) {
          entities.set(comparisonEntryKey(device.id, entity.valueStateId), { device, entity, category });
        }
      }
    }
    const entries = [...new Set(entryKeys)].flatMap((key) => {
      const parsed = parseComparisonEntryKey(key);
      const canonicalKey = parsed ? comparisonEntryKey(parsed.deviceId, parsed.valueStateId) : void 0;
      const selected = canonicalKey ? entities.get(canonicalKey) : void 0;
      if (!selected) {
        return [];
      }
      return [
        {
          key: canonicalKey,
          deviceId: selected.device.id,
          deviceName: selected.device.name,
          valueStateId: selected.entity.valueStateId,
          category: selected.category,
          name: selected.entity.name,
          ...selected.entity.unit ? { unit: selected.entity.unit } : {},
          ...selected.entity.period ? { period: selected.entity.period } : {}
        }
      ];
    });
    if (!entries.length) {
      throw new Error("Select at least one value for the comparison");
    }
    const comparisonId = id != null ? id : (0, import_node_crypto.randomUUID)();
    const definition = { id: comparisonId, name: normalizedName, entries };
    const index = this.comparisonDefinitions.findIndex((candidate) => candidate.id === comparisonId);
    if (index >= 0) {
      this.comparisonDefinitions[index] = definition;
    } else {
      this.comparisonDefinitions.push(definition);
    }
    await this.saveComparisonDefinitions();
    this.scheduleDeviceManagerRefresh();
  }
  async deleteDeviceManagerComparison(id) {
    const index = this.comparisonDefinitions.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error(`Cannot delete unknown comparison ${id}`);
    }
    this.comparisonDefinitions.splice(index, 1);
    await this.saveComparisonDefinitions();
    this.scheduleDeviceManagerRefresh();
  }
  async setDeviceManagerName(deviceId, name) {
    var _a;
    const devicePath = `${DEVICES_ROOT}.${deviceId}`;
    const object = await this.getObjectAsync(devicePath);
    if (!object || !isOwned(object) || object.type !== "device") {
      throw new Error(`Cannot rename unknown GridVis2MQTT device ${deviceId}`);
    }
    const device = (await this.getDeviceManagerDevices()).find((candidate) => candidate.id === deviceId);
    if (!device) {
      throw new Error(`Cannot rename unknown GridVis2MQTT device ${deviceId}`);
    }
    const displayName = name.trim() || device.originalName;
    const marker = { ...(_a = markerOf(object)) != null ? _a : objectMarker("device", void 0, deviceId) };
    if (name.trim()) {
      marker.displayName = name.trim();
    } else {
      delete marker.displayName;
    }
    const native = {
      ...object.native && typeof object.native === "object" && !Array.isArray(object.native) ? object.native : {},
      [OWNER]: marker
    };
    await this.setObjectAsync(devicePath, {
      type: "device",
      common: { ...object.common, name: displayName },
      native
    });
    this.scheduleDeviceManagerRefresh();
  }
  async buildDiscoveryRecord(discovery) {
    const deviceId = (0, import_discovery.stableDeviceId)(discovery);
    const usedPaths = /* @__PURE__ */ new Set();
    for (const record of this.discoveries.values()) {
      if (record.deviceId === deviceId && record.topic !== discovery.topic) {
        for (const entity of record.entities) {
          usedPaths.add(entityPathKey(entity));
        }
      }
    }
    const entities = [];
    const objectIds = [];
    for (const entity of discovery.entities) {
      const objectPath = (0, import_discovery.entityObjectPath)(discovery, entity);
      if ((0, import_discovery.isGridvisBridgeDiscovery)(discovery) && !BRIDGE_INFO_ENTITY_IDS.has(objectPath.entityId)) {
        continue;
      }
      let entityId = objectPath.entityId;
      const category = objectPath.category;
      const historyPeriod = objectPath.historyPeriod;
      let pathKey = entityPathKey({ entityId, category, historyPeriod });
      if (usedPaths.has(pathKey)) {
        entityId = `${entityId}_${Buffer.from(`${discovery.topic}|${entity.key}`).toString("hex").slice(0, 8)}`;
        pathKey = entityPathKey({ entityId, category, historyPeriod });
      }
      usedPaths.add(pathKey);
      const discoveryEntity = { entityId, category, historyPeriod };
      const categoryPath = entityCategoryPath(deviceId, category);
      const entityPath = `${categoryPath}.${entityId}`;
      const base = entityBasePath(deviceId, discoveryEntity);
      const stateIds = isInfoCategory(category) ? [...new Set(category === "instanceInfo" ? [entityPath] : [categoryPath, entityPath])] : [
        .../* @__PURE__ */ new Set([
          categoryPath,
          entityPath,
          ...category === "history" ? [historyEntityAvailabilityPath(deviceId, entityId)] : [],
          base,
          `${base}.value`,
          `${base}.available`
        ])
      ];
      entities.push({
        key: entity.key,
        entityId,
        category,
        historyPeriod,
        component: entity.component,
        uniqueId: entity.uniqueId,
        stateTopic: entity.stateTopic,
        availabilityTopic: entity.availabilityTopic,
        jsonAttributesTopic: entity.jsonAttributesTopic,
        commandTopic: entity.commandTopic,
        objectIds: stateIds,
        valueStateId: isInfoCategory(category) ? base : `${base}.value`
      });
      objectIds.push(...stateIds);
    }
    const deviceObjectIds = deviceObjectIdsForDevice(deviceId, discovery);
    return {
      topic: discovery.topic,
      deviceId,
      entities,
      objectIds,
      deviceObjectIds,
      discovery
    };
  }
  async installDiscovery(discovery, record) {
    if ((0, import_discovery.isGridvisBridgeDiscovery)(discovery)) {
      await this.createBridgeInstanceInfo(discovery);
    } else {
      await this.createDeviceObjects(discovery, record.deviceId, discovery.topic);
    }
    for (const entityRecord of record.entities) {
      const entity = discovery.entities.find((candidate) => candidate.key === entityRecord.key);
      if (!entity) {
        continue;
      }
      const base = entityBasePath(record.deviceId, entityRecord);
      await this.createEntityObjects(discovery, record.deviceId, entityRecord, entity);
      const runtimeKey = `${discovery.topic}|${entity.key}`;
      const runtime = {
        key: runtimeKey,
        discoveryTopic: discovery.topic,
        deviceId: record.deviceId,
        entityId: entityRecord.entityId,
        category: entityRecord.category,
        historyPeriod: entityRecord.historyPeriod,
        entity,
        valueStateId: isInfoCategory(entityRecord.category) ? base : `${base}.value`,
        ...isInfoCategory(entityRecord.category) ? {} : { availableStateId: `${base}.available` }
      };
      this.runtimes.set(runtimeKey, runtime);
      this.stateActions.set(runtime.valueStateId, { runtimeKey, action: "value" });
      await this.addTopicReference(entity.stateTopic, runtimeKey);
      if (!isInfoCategory(entityRecord.category)) {
        for (const availability of (0, import_discovery.availabilityEntries)(entity)) {
          await this.addTopicReference(asString(availability.availability_topic), runtimeKey);
        }
      }
    }
    for (const entityId of new Set(
      record.entities.filter((entity) => entity.category === "history").map((entity) => entity.entityId)
    )) {
      await this.updateHistoryAvailability(record.deviceId, entityId);
    }
    await this.updateDeviceAvailability(record.deviceId);
  }
  async createBridgeInstanceInfo(discovery) {
    var _a, _b, _c, _d;
    const device = (_c = (_b = discovery.device) != null ? _b : (_a = discovery.entities[0]) == null ? void 0 : _a.device) != null ? _c : {};
    const value = (_d = device.sw_version) != null ? _d : discovery.origin.sw_version;
    if (value === void 0) {
      return;
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const stateId = "info.sw_version";
    await this.upsertObject(
      stateId,
      {
        type: "state",
        common: { name: "sw_version", type: "string", role: "text", read: true, write: false, def: text != null ? text : "" },
        native: {
          ...objectMarker("instance-info-state", discovery.topic),
          discoveryPayload: discovery.normalizedPayload
        }
      },
      discovery.topic
    );
    await this.setStateAsync(stateId, text != null ? text : "", true);
  }
  async createDeviceObjects(discovery, deviceId, discoveryTopic) {
    var _a, _b, _c, _d, _e;
    const device = (_c = (_b = discovery.device) != null ? _b : (_a = discovery.entities[0]) == null ? void 0 : _a.device) != null ? _c : {};
    const name = asString(device.name, deviceId);
    const devicePath = `${DEVICES_ROOT}.${deviceId}`;
    const isBridge = (0, import_discovery.isGridvisBridgeDiscovery)(discovery);
    const existingDevice = await this.getObjectAsync(devicePath);
    const customName = optionalText((_d = markerOf(existingDevice)) == null ? void 0 : _d.displayName);
    const deviceNative = objectMarker("device", void 0, deviceId);
    if (customName) {
      deviceNative.displayName = customName;
    }
    const deviceObject = {
      type: "device",
      common: {
        name: customName != null ? customName : name,
        ...isBridge ? {} : { statusStates: { onlineId: `${this.namespace}.${deviceAvailabilityPath(deviceId)}` } }
      },
      native: deviceNative
    };
    if (isBridge && existingDevice && isOwned(existingDevice) && ((_e = existingDevice.common) == null ? void 0 : _e.statusStates)) {
      await this.setObjectAsync(devicePath, deviceObject);
    } else {
      await this.upsertObject(devicePath, deviceObject, discoveryTopic);
    }
    if (isBridge) {
      const oldAvailability = await this.getObjectAsync(deviceAvailabilityPath(deviceId));
      if (oldAvailability && isOwned(oldAvailability)) {
        await this.delObjectAsync(deviceAvailabilityPath(deviceId));
      }
    }
    if (!isBridge) {
      await this.upsertObject(
        deviceAvailabilityPath(deviceId),
        {
          type: "state",
          common: {
            name: "Device available",
            type: "boolean",
            role: "indicator.reachable",
            read: true,
            write: false,
            def: false,
            expert: true
          },
          native: {
            ...objectMarker("device-availability", discoveryTopic, deviceId),
            discoveryPayload: discovery.normalizedPayload
          }
        },
        discoveryTopic
      );
      await this.setStateAsync(deviceAvailabilityPath(deviceId), false, true);
    }
    await this.upsertObject(
      `${devicePath}.info`,
      {
        type: "channel",
        common: { name: "Information" },
        native: objectMarker("device-info", discoveryTopic, deviceId)
      },
      discoveryTopic
    );
    const values = {
      name: device.name,
      manufacturer: device.manufacturer,
      model: device.model,
      serial_number: device.serial_number,
      sw_version: device.sw_version,
      hw_version: device.hw_version,
      connections: device.connections,
      origin: discovery.origin
    };
    for (const [key, value] of Object.entries(values)) {
      if (value === void 0) {
        continue;
      }
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const entityPath = `${DEVICES_ROOT}.${deviceId}.info.${key}`;
      await this.upsertObject(
        entityPath,
        {
          type: "state",
          common: { name: key, type: "string", role: "text", read: true, write: false, def: text != null ? text : "" },
          native: {
            ...objectMarker("device-info-state", discoveryTopic, deviceId),
            discoveryPayload: discovery.normalizedPayload
          }
        },
        discoveryTopic
      );
      await this.setStateAsync(entityPath, text != null ? text : "", true);
    }
  }
  async createEntityObjects(discovery, deviceId, entityRecord, entity) {
    var _a;
    const discoveryTopic = discovery.topic;
    const category = (_a = entityRecord.category) != null ? _a : "online";
    const categoryPath = entityCategoryPath(deviceId, category);
    const entityPath = `${categoryPath}.${entityRecord.entityId}`;
    const base = entityBasePath(deviceId, entityRecord);
    const hasAvailability = (0, import_discovery.availabilityEntries)(entity).length > 0;
    const displayName = historyMetricName(entity.config.name, entityRecord.historyPeriod);
    const isInfo = isInfoCategory(category);
    const isInstanceInfo = category === "instanceInfo";
    const writable = !!entity.commandTopic && (!entity.config.command_template || (0, import_templates.isSupportedCommandTemplate)(entity.config.command_template));
    const common = {
      name: displayName || entityRecord.entityId,
      type: isInfo ? "string" : (0, import_roles.stateTypeFor)(entity),
      role: isInfo ? "text" : (0, import_roles.roleFor)(entity),
      read: true,
      write: writable
    };
    if (typeof entity.config.unit_of_measurement === "string") {
      common.unit = entity.config.unit_of_measurement;
    }
    if (typeof entity.config.min === "number") {
      common.min = entity.config.min;
    }
    if (typeof entity.config.max === "number") {
      common.max = entity.config.max;
    }
    if (typeof entity.config.step === "number") {
      common.step = entity.config.step;
    }
    const states = optionsToStates(entity.config.options);
    if (states) {
      common.states = states;
    }
    if (isInfo) {
      if (!isInstanceInfo) {
        await this.upsertObject(
          categoryPath,
          {
            type: "channel",
            common: { name: "Information" },
            native: objectMarker("entity-category", discoveryTopic, deviceId)
          },
          discoveryTopic
        );
      }
      await this.upsertObject(
        entityPath,
        { type: "state", common, native: this.stateNative(entity, discovery) },
        discoveryTopic
      );
      return;
    }
    await this.upsertObject(
      categoryPath,
      {
        type: categoryObjectType(category),
        common: {
          name: category === "history" ? "History" : "Online"
        },
        native: objectMarker("entity-category", discoveryTopic, deviceId)
      },
      discoveryTopic
    );
    await this.upsertObject(
      entityPath,
      {
        type: entityObjectType(category),
        common: {
          name: common.name,
          ...category === "online" ? {
            statusStates: {
              onlineId: `${this.namespace}.${base}.available`
            }
          } : category === "history" ? {
            statusStates: {
              onlineId: `${this.namespace}.${historyEntityAvailabilityPath(deviceId, entityRecord.entityId)}`
            }
          } : {}
        },
        native: objectMarker("entity", discoveryTopic, deviceId)
      },
      discoveryTopic
    );
    if (category === "history") {
      await this.upsertObject(
        historyEntityAvailabilityPath(deviceId, entityRecord.entityId),
        {
          type: "state",
          common: {
            name: "Available",
            type: "boolean",
            role: "indicator.reachable",
            read: true,
            write: false
          },
          native: {
            ...objectMarker("history-availability", discoveryTopic, deviceId),
            discoveryPayload: discovery.normalizedPayload
          }
        },
        discoveryTopic
      );
    }
    if (category === "history" && entityRecord.historyPeriod && base !== entityPath) {
      await this.upsertObject(
        base,
        {
          type: "channel",
          common: {
            name: historyPeriodName(entity.config.name, entityRecord.historyPeriod),
            statusStates: {
              onlineId: `${this.namespace}.${base}.available`
            }
          },
          native: objectMarker("history-period", discoveryTopic, deviceId)
        },
        discoveryTopic
      );
    }
    await this.upsertObject(
      `${base}.value`,
      { type: "state", common, native: this.stateNative(entity, discovery) },
      discoveryTopic
    );
    await this.upsertObject(
      `${base}.available`,
      {
        type: "state",
        common: {
          name: "Available",
          type: "boolean",
          role: "indicator.reachable",
          read: true,
          write: false,
          def: !hasAvailability
        },
        native: this.stateNative(entity, discovery)
      },
      discoveryTopic
    );
    const currentAvailability = await this.getStateAsync(`${base}.available`);
    const initializeAvailability = this.discoverySyncActive || !currentAvailability || currentAvailability.val === null || currentAvailability.val === void 0;
    if (initializeAvailability) {
      await this.setStateAsync(`${base}.available`, !hasAvailability, true);
    }
  }
  stateNative(entity, discovery) {
    return {
      [OWNER]: objectMarker("state", discovery.topic),
      discoveryTopic: discovery.topic,
      discoveryPayload: discovery.normalizedPayload,
      uniqueId: entity.uniqueId,
      component: entity.component,
      stateTopic: entity.stateTopic,
      availabilityTopic: entity.availabilityTopic,
      jsonAttributesTopic: entity.jsonAttributesTopic,
      commandTopic: entity.commandTopic
    };
  }
  async upsertObject(id, object, _discoveryTopic) {
    var _a;
    const existing = await this.getObjectAsync(id);
    if (existing && !isOwned(existing) && id !== DEVICES_ROOT) {
      this.log.warn(`Cannot use ${id}: an object not created by this adapter already exists`);
      return;
    }
    if (existing && isOwned(existing)) {
      if (existing.type !== object.type) {
        const previousValue = object.type === "state" ? await this.getStateAsync(`${id}.value`) : void 0;
        await this.delObjectAsync(id, { recursive: false });
        await this.setObjectAsync(id, object);
        if (previousValue && previousValue.val !== null && previousValue.val !== void 0) {
          await this.setStateAsync(id, previousValue.val, (_a = previousValue.ack) != null ? _a : true);
        }
        return;
      }
      await this.extendObjectAsync(id, object);
      return;
    }
    await this.setObjectAsync(id, object);
  }
  async processEntityMessage(runtime, topic, payload) {
    var _a;
    const entity = runtime.entity;
    const availabilityEntriesForEntity = (0, import_discovery.availabilityEntries)(entity);
    const availability = availabilityEntriesForEntity.find((entry) => asString(entry.availability_topic) === topic);
    if (availability) {
      const value = availabilityValue(payload, availability);
      this.log.debug(
        `Received GridVis2MQTT availability ${topic}: ${JSON.stringify(payload)} -> ${value === void 0 ? "ignored" : String(value)} (${runtime.availableStateId})`
      );
      if (value !== void 0 && runtime.availableStateId) {
        await this.setStateAsync(runtime.availableStateId, value, true);
      }
    }
    if (entity.stateTopic === topic) {
      if (availabilityEntriesForEntity.length === 0 && runtime.availableStateId) {
        await this.setStateAsync(runtime.availableStateId, true, true);
      }
      const result = (0, import_templates.evaluateValueTemplate)(entity.config.value_template, payload);
      if (result.supported && result.value !== void 0) {
        const value = coerceStateValue(result.value, entity);
        await this.setStateAsync(runtime.valueStateId, value, true);
        if ((0, import_roles.stateTypeFor)(entity) === "mixed") {
          if (typeof value === "number") {
            await this.extendObjectAsync(runtime.valueStateId, {
              common: { type: "number", role: "value" }
            });
          } else if (typeof value === "string") {
            await this.extendObjectAsync(runtime.valueStateId, {
              common: { type: "string", role: "text" }
            });
          }
        }
        await this.updateComparisonDisplayValues();
      } else if (!result.supported) {
        this.log.warn(`Unsupported value_template for ${runtime.key}: ${result.error}`);
      }
    }
    if (((_a = runtime.category) != null ? _a : "online") === "history") {
      await this.updateHistoryAvailability(runtime.deviceId, runtime.entityId);
    }
    await this.updateDeviceAvailability(runtime.deviceId);
  }
  async updateHistoryAvailability(deviceId, entityId) {
    const aggregateStateId = historyEntityAvailabilityPath(deviceId, entityId);
    if (!isOwned(await this.getObjectAsync(aggregateStateId))) {
      return;
    }
    const availableStateIds = [
      ...new Set(
        [...this.runtimes.values()].filter(
          (runtime) => {
            var _a;
            return runtime.deviceId === deviceId && ((_a = runtime.category) != null ? _a : "online") === "history" && runtime.entityId === entityId;
          }
        ).map((runtime) => runtime.availableStateId).filter((stateId) => typeof stateId === "string")
      )
    ];
    let available = false;
    for (const stateId of availableStateIds) {
      const state = await this.getStateAsync(stateId);
      if ((state == null ? void 0 : state.val) === true) {
        available = true;
        break;
      }
    }
    await this.setStateAsync(aggregateStateId, available, true);
  }
  async updateDeviceAvailability(deviceId) {
    if (!isOwned(await this.getObjectAsync(deviceAvailabilityPath(deviceId)))) {
      return;
    }
    const availableStateIds = [
      ...new Set(
        [...this.runtimes.values()].filter(
          (runtime) => {
            var _a;
            return runtime.deviceId === deviceId && ["online", "history"].includes((_a = runtime.category) != null ? _a : "online");
          }
        ).map((runtime) => runtime.availableStateId).filter((stateId) => typeof stateId === "string")
      )
    ];
    let online = false;
    for (const stateId of availableStateIds) {
      const state = await this.getStateAsync(stateId);
      if ((state == null ? void 0 : state.val) === true) {
        online = true;
        break;
      }
    }
    await this.setStateAsync(deviceAvailabilityPath(deviceId), online, true);
  }
  async onStateChange(id, state) {
    var _a;
    if (!state || state.ack !== false) {
      return;
    }
    const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
    const action = this.stateActions.get(relativeId);
    if (!action) {
      return;
    }
    const runtime = this.runtimes.get(action.runtimeKey);
    if (!runtime || !runtime.entity.commandTopic || !this.mqttClient || !this.mqttConnected) {
      return;
    }
    if (runtime.entity.config.command_template && !(0, import_templates.isSupportedCommandTemplate)(runtime.entity.config.command_template)) {
      this.log.warn(`Ignoring command_template for ${action.runtimeKey}: unsupported template`);
      return;
    }
    let value = state.val;
    if (action.action === "press") {
      value = (_a = runtime.entity.config.payload_press) != null ? _a : true;
    }
    if (runtime.entity.component === "select" && Array.isArray(runtime.entity.config.options) && !runtime.entity.config.options.includes(value)) {
      this.log.warn(`Ignoring value not present in options for ${action.runtimeKey}`);
      return;
    }
    if (typeof value === "boolean") {
      if (value && runtime.entity.config.payload_on !== void 0) {
        value = runtime.entity.config.payload_on;
      }
      if (!value && runtime.entity.config.payload_off !== void 0) {
        value = runtime.entity.config.payload_off;
      }
    }
    const rendered = runtime.entity.config.command_template ? (0, import_templates.renderCommandTemplate)(runtime.entity.config.command_template, value) : String(value != null ? value : "");
    if (rendered === null) {
      this.log.warn(`Could not safely render command_template for ${action.runtimeKey}`);
      return;
    }
    await new Promise((resolve, reject) => {
      var _a2;
      (_a2 = this.mqttClient) == null ? void 0 : _a2.publish(
        runtime.entity.commandTopic,
        rendered,
        { qos: this.mqttQos() },
        (error) => error ? reject(error) : resolve()
      );
    }).catch((error) => this.reportError(`Could not publish command for ${action.runtimeKey}`, error));
  }
  async removeDiscovery(topic, preservedObjectIds = /* @__PURE__ */ new Set(), logRemoval = true) {
    const record = this.discoveries.get(topic);
    if (!record) {
      return;
    }
    for (const entity of record.entities) {
      const runtimeKey = `${topic}|${entity.key}`;
      const runtime = this.runtimes.get(runtimeKey);
      if (runtime) {
        await this.removeTopicReference(runtime.entity.stateTopic, runtimeKey);
        if (!isInfoCategory(entity.category)) {
          for (const availability of (0, import_discovery.availabilityEntries)(runtime.entity)) {
            await this.removeTopicReference(asString(availability.availability_topic), runtimeKey);
          }
        }
        await this.removeTopicReference(runtime.entity.jsonAttributesTopic, runtimeKey);
        this.runtimes.delete(runtimeKey);
      }
      this.stateActions.delete(entity.valueStateId);
      if (entity.pressStateId) {
        this.stateActions.delete(entity.pressStateId);
      }
      for (const objectId of entity.objectIds) {
        if (!preservedObjectIds.has(objectId) && !this.isObjectReferencedByOtherDiscovery(objectId, topic)) {
          await this.deleteManagedObject(objectId, topic);
        }
      }
    }
    this.discoveries.delete(topic);
    for (const entityId of new Set(
      record.entities.filter((entity) => entity.category === "history").map((entity) => entity.entityId)
    )) {
      await this.updateHistoryAvailability(record.deviceId, entityId);
    }
    if ((0, import_discovery.isGridvisBridgeDiscovery)(record.discovery) && ![...this.discoveries.values()].some((candidate) => (0, import_discovery.isGridvisBridgeDiscovery)(candidate.discovery))) {
      const bridgeSoftwareVersion = await this.getObjectAsync("info.sw_version");
      if (bridgeSoftwareVersion && isOwned(bridgeSoftwareVersion)) {
        await this.delObjectAsync("info.sw_version");
      }
    }
    await this.updateDeviceAvailability(record.deviceId);
    const hasDeviceReference = [...this.discoveries.values()].some(
      (candidate) => candidate.deviceId === record.deviceId
    );
    if (!hasDeviceReference) {
      const deviceObjectIds = record.deviceObjectIds;
      for (const objectId of deviceObjectIds) {
        if (!preservedObjectIds.has(objectId) && !this.isObjectReferencedByOtherDiscovery(objectId, topic)) {
          await this.deleteManagedObject(objectId, topic);
        }
      }
    }
    if (logRemoval) {
      this.log.info(`Removed GridVis2MQTT discovery ${topic}`);
    }
    this.scheduleDeviceManagerRefresh();
  }
  isObjectReferencedByOtherDiscovery(objectId, topic) {
    return [...this.discoveries.values()].some((record) => {
      var _a, _b;
      if (record.topic === topic) {
        return false;
      }
      return ((_a = record.objectIds) == null ? void 0 : _a.includes(objectId)) || ((_b = record.deviceObjectIds) == null ? void 0 : _b.includes(objectId)) || record.entities.some((entity) => entity.objectIds.includes(objectId));
    });
  }
  async deleteManagedObject(id, discoveryTopic) {
    const object = await this.getObjectAsync(id);
    if (!object) {
      return;
    }
    void discoveryTopic;
    await this.delObjectAsync(id);
  }
  reportError(message, error) {
    const text = error instanceof Error ? error.message : String(error);
    this.log.error(`${message}: ${text}`);
    void this.setStateAsync("info.lastError", text, true);
  }
  async closeMqtt() {
    const client = this.mqttClient;
    this.mqttClient = void 0;
    this.mqttConnected = false;
    if (!client) {
      return;
    }
    await new Promise((resolve) => client.end(true, () => resolve()));
    client.removeAllListeners();
  }
  onUnload(callback) {
    this.shuttingDown = true;
    this.cancelDiscoverySync();
    if (this.deviceManagerRefreshTimer) {
      clearTimeout(this.deviceManagerRefreshTimer);
      this.deviceManagerRefreshTimer = void 0;
    }
    void this.closeMqtt().then(() => callback()).catch((error) => {
      this.reportError("Error while closing MQTT", error);
      callback();
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new Gridvis2mqtt(options);
} else {
  (() => new Gridvis2mqtt())();
}
//# sourceMappingURL=main.js.map
