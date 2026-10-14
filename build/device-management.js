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
var device_management_exports = {};
__export(device_management_exports, {
  Gridvis2mqttDeviceManagement: () => Gridvis2mqttDeviceManagement
});
module.exports = __toCommonJS(device_management_exports);
var import_dm_utils = require("@iobroker/dm-utils");
function stateItem(entity, label = entity.name, hidden, stateId = entity.valueStateId) {
  return {
    type: "state",
    oid: stateId,
    control: "text",
    label,
    digits: 2,
    ...stateId === entity.valueStateId && entity.unit ? { unit: entity.unit } : {},
    ...hidden ? { hidden } : {}
  };
}
function stateItems(entities, options = {}) {
  var _a;
  const keyPrefix = (_a = options.keyPrefix) != null ? _a : "state";
  return Object.fromEntries(
    entities.map((entity, index) => {
      var _a2, _b, _c, _d;
      return [
        `${keyPrefix}_${index}_${entity.valueStateId}`,
        stateItem(
          entity,
          (_b = (_a2 = options.label) == null ? void 0 : _a2.call(options, entity)) != null ? _b : entity.name,
          options.hidden,
          (_d = (_c = options.stateId) == null ? void 0 : _c.call(options, entity)) != null ? _d : entity.valueStateId
        )
      ];
    })
  );
}
const HISTORY_PERIOD_ORDER = {
  today: 0,
  yesterday: 1,
  thisweek: 2,
  lastweek: 3,
  thismonth: 4,
  lastmonth: 5,
  thisyear: 6,
  lastyear: 7,
  last3months: 8
};
function compareHistoryEntities(left, right) {
  var _a, _b, _c, _d, _e, _f;
  const leftMetric = left.name.replace(/\s+\([^)]*\)$/, "");
  const rightMetric = right.name.replace(/\s+\([^)]*\)$/, "");
  const metricOrder = leftMetric.localeCompare(rightMetric, "de", { sensitivity: "base" });
  if (metricOrder !== 0) {
    return metricOrder;
  }
  const periodOrder = ((_c = HISTORY_PERIOD_ORDER[(_b = (_a = left.period) == null ? void 0 : _a.toLowerCase()) != null ? _b : ""]) != null ? _c : 999) - ((_f = HISTORY_PERIOD_ORDER[(_e = (_d = right.period) == null ? void 0 : _d.toLowerCase()) != null ? _e : ""]) != null ? _f : 999);
  return periodOrder || left.name.localeCompare(right.name, "de", { sensitivity: "base" });
}
function compareHistoryChronologically(left, right) {
  var _a, _b, _c, _d, _e, _f;
  const periodOrder = ((_c = HISTORY_PERIOD_ORDER[(_b = (_a = left.period) == null ? void 0 : _a.toLowerCase()) != null ? _b : ""]) != null ? _c : 999) - ((_f = HISTORY_PERIOD_ORDER[(_e = (_d = right.period) == null ? void 0 : _d.toLowerCase()) != null ? _e : ""]) != null ? _f : 999);
  if (periodOrder !== 0) {
    return periodOrder;
  }
  return left.name.localeCompare(right.name, "de", { sensitivity: "base" });
}
function historyMetricName(entity) {
  return entity.name.replace(/\s+\([^)]*\)$/, "");
}
function historyPeriodLabel(entity) {
  var _a, _b;
  const match = entity.name.match(/\(([^()]*)\)$/);
  return (_b = (_a = match == null ? void 0 : match[1]) != null ? _a : entity.period) != null ? _b : entity.name;
}
function historyGroups(history) {
  var _a;
  const groups = /* @__PURE__ */ new Map();
  for (const entity of history) {
    const name = historyMetricName(entity);
    const entities = (_a = groups.get(name)) != null ? _a : [];
    entities.push(entity);
    groups.set(name, entities);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "de", { sensitivity: "base" })).map(([name, entities]) => ({ name, entities: entities.sort(compareHistoryEntities) }));
}
function historyPeriodGroups(history) {
  var _a, _b, _c;
  const groups = /* @__PURE__ */ new Map();
  for (const entity of history) {
    const key = (_b = (_a = entity.period) == null ? void 0 : _a.toLowerCase()) != null ? _b : historyPeriodLabel(entity).toLowerCase();
    const entities = (_c = groups.get(key)) != null ? _c : [];
    entities.push(entity);
    groups.set(key, entities);
  }
  return [...groups.entries()].sort(([left], [right]) => {
    var _a2, _b2;
    const periodOrder = ((_a2 = HISTORY_PERIOD_ORDER[left]) != null ? _a2 : 999) - ((_b2 = HISTORY_PERIOD_ORDER[right]) != null ? _b2 : 999);
    return periodOrder || left.localeCompare(right, "de", { sensitivity: "base" });
  }).map(([, entities]) => ({
    name: historyPeriodLabel(entities[0]),
    entities: entities.sort(
      (left, right) => historyMetricName(left).localeCompare(historyMetricName(right), "de", { sensitivity: "base" })
    )
  }));
}
function fixedPanelStyle(height) {
  return {
    height,
    minHeight: height,
    boxSizing: "border-box",
    alignContent: "flex-start",
    justifyContent: "flex-start"
  };
}
function panel(label, entities, height, stateId) {
  return {
    type: "panel",
    label,
    innerStyle: fixedPanelStyle(height),
    items: stateItems(entities, { stateId })
  };
}
function detailsSchema(device) {
  const items = {};
  const history = [...device.history].sort(compareHistoryEntities);
  const groups = historyGroups(history);
  const periodGroups = historyPeriodGroups(history);
  const historyItemCount = history.length + Math.max(groups.length, periodGroups.length) + 1;
  const maxItemCount = Math.max(device.online.length, historyItemCount, device.info.length, 1);
  const panelHeight = Math.max(220, maxItemCount * 42 + 80);
  const comparisonDisplayState = device.kind === "comparison" ? (entity) => {
    var _a;
    return (_a = entity.displayStateId) != null ? _a : entity.valueStateId;
  } : void 0;
  if (device.online.length) {
    items.online = panel("Online", device.online, panelHeight, comparisonDisplayState);
  }
  if (history.length) {
    const historyItems = {
      historyGrouping: {
        type: "select",
        label: { en: "Group history by", de: "Historie gruppieren nach" },
        options: [
          { value: "type", label: { en: "Type", de: "Typ" } },
          { value: "chronological", label: { en: "Chronological", de: "Chronologisch" } }
        ],
        default: "type",
        newLine: true
      }
    };
    for (const [index, group] of groups.entries()) {
      Object.assign(historyItems, {
        [`typeHeader_${index}`]: {
          type: "header",
          text: group.name,
          size: 5,
          newLine: true,
          noTranslation: true,
          hidden: "data.historyGrouping !== 'type'"
        }
      });
      Object.assign(
        historyItems,
        stateItems(group.entities, {
          keyPrefix: `type_${index}`,
          label: historyPeriodLabel,
          hidden: "data.historyGrouping !== 'type'",
          stateId: comparisonDisplayState
        })
      );
    }
    for (const [index, group] of periodGroups.entries()) {
      Object.assign(historyItems, {
        [`chronologicalHeader_${index}`]: {
          type: "header",
          text: group.name,
          size: 5,
          newLine: true,
          noTranslation: true,
          hidden: "data.historyGrouping !== 'chronological'"
        }
      });
      Object.assign(
        historyItems,
        stateItems(group.entities.sort(compareHistoryChronologically), {
          keyPrefix: `chronological_${index}`,
          label: historyMetricName,
          hidden: "data.historyGrouping !== 'chronological'",
          stateId: comparisonDisplayState
        })
      );
    }
    items.history = {
      type: "panel",
      label: "History",
      innerStyle: fixedPanelStyle(panelHeight),
      items: historyItems
    };
  }
  if (device.info.length) {
    items.info = panel("Information", device.info, panelHeight);
  }
  return {
    type: "tabs",
    tabsStyle: { minWidth: 850 },
    items
  };
}
const renameSchema = {
  type: "panel",
  items: {
    name: {
      type: "text",
      label: { en: "Device name", de: "Ger\xE4tename" },
      maxLength: 120,
      trim: true
    }
  }
};
function comparisonSchema(optionGroups) {
  return {
    type: "panel",
    items: {
      name: {
        type: "text",
        label: { en: "Comparison name", de: "Name des Vergleichs" },
        maxLength: 120,
        trim: true
      },
      entries: {
        type: "select",
        label: { en: "Values to compare", de: "Zu vergleichende Werte" },
        options: optionGroups.map((group) => ({
          label: group.label,
          items: group.items
        })),
        multiple: true,
        format: "dropdown",
        newLine: true
      }
    }
  };
}
class Gridvis2mqttDeviceManagement extends import_dm_utils.DeviceManagement {
  constructor(adapter) {
    super(adapter, true);
  }
  async refreshCards() {
    await this.sendCommandToGui({ command: "all" });
  }
  getInstanceInfo() {
    return {
      apiVersion: "v3",
      communicationStateId: "info.deviceManager",
      actions: [
        {
          id: "createComparison",
          icon: "add",
          title: { en: "Create comparison", de: "Vergleich anlegen" },
          description: { en: "Create a comparison device", de: "Ein Vergleichsger\xE4t anlegen" },
          handler: async (context) => {
            const optionGroups = await this.adapter.getDeviceManagerComparisonOptions();
            const data = await context.showForm(comparisonSchema(optionGroups), {
              title: { en: "Create comparison", de: "Vergleich anlegen" },
              data: { name: "", entries: [] },
              buttons: ["apply", "cancel"]
            });
            if (!data) {
              return { refresh: false };
            }
            const name = typeof data.name === "string" ? data.name.trim() : "";
            const entries = Array.isArray(data.entries) ? data.entries.filter((entry) => typeof entry === "string") : [];
            await this.adapter.saveDeviceManagerComparison(void 0, name, entries);
            return { refresh: true };
          }
        }
      ]
    };
  }
  async loadDevices(context) {
    const devices = await this.adapter.getDeviceManagerDevices();
    context.setTotalDevices(devices.length);
    for (const device of devices) {
      context.addDevice(this.toDeviceInfo(device));
    }
  }
  async getDeviceDetails(id) {
    const device = (await this.adapter.getDeviceManagerDevices()).find((candidate) => candidate.id === id);
    return device ? { id, schema: detailsSchema(device), data: { historyGrouping: "type" } } : null;
  }
  toDeviceInfo(device) {
    var _a, _b, _c, _d, _e, _f;
    const hasDetails = device.online.length > 0 || device.history.length > 0 || device.info.length > 0;
    const entityCount = device.online.length + device.history.length;
    const isComparison = device.kind === "comparison";
    const actions = isComparison && device.comparison ? [
      {
        id: "editComparison",
        icon: "edit",
        description: { en: "Edit comparison", de: "Vergleich bearbeiten" },
        handler: async (_deviceId, context) => {
          var _a2, _b2, _c2;
          const optionGroups = await this.adapter.getDeviceManagerComparisonOptions();
          const data = await context.showForm(comparisonSchema(optionGroups), {
            title: { en: "Edit comparison", de: "Vergleich bearbeiten" },
            data: {
              name: device.name,
              entries: (_b2 = (_a2 = device.comparison) == null ? void 0 : _a2.entries.map((entry) => entry.key)) != null ? _b2 : []
            },
            buttons: ["apply", "cancel"]
          });
          if (!data) {
            return { refresh: "none" };
          }
          const name = typeof data.name === "string" ? data.name.trim() : "";
          const entries = Array.isArray(data.entries) ? data.entries.filter((entry) => typeof entry === "string") : [];
          await this.adapter.saveDeviceManagerComparison((_c2 = device.comparison) == null ? void 0 : _c2.id, name, entries);
          return { refresh: "devices" };
        }
      },
      {
        id: "deleteComparison",
        icon: "delete",
        description: { en: "Delete comparison", de: "Vergleich l\xF6schen" },
        confirmation: { en: "Delete this comparison?", de: "Diesen Vergleich l\xF6schen?" },
        handler: async () => {
          var _a2, _b2;
          await this.adapter.deleteDeviceManagerComparison((_b2 = (_a2 = device.comparison) == null ? void 0 : _a2.id) != null ? _b2 : "");
          return { refresh: "devices" };
        }
      }
    ] : [
      {
        id: "rename",
        icon: "rename",
        description: { en: "Change device name", de: "Ger\xE4tenamen \xE4ndern" },
        handler: async (_deviceId, context) => {
          var _a2;
          const data = await context.showForm(renameSchema, {
            title: { en: "Change device name", de: "Ger\xE4tenamen \xE4ndern" },
            data: { name: (_a2 = device.customName) != null ? _a2 : device.originalName },
            buttons: ["apply", "cancel"]
          });
          if (!data) {
            return { refresh: "none" };
          }
          const name = typeof data.name === "string" ? data.name.trim() : "";
          await this.adapter.setDeviceManagerName(device.id, name);
          return { refresh: "devices" };
        }
      }
    ];
    return {
      id: device.id,
      identifier: (_a = device.identifier) != null ? _a : device.id,
      name: device.name,
      icon: device.iconStateId ? { stateId: `${this.adapter.namespace}.${device.iconStateId}` } : (_b = device.icon) != null ? _b : `/adapter/${this.adapter.name}/gridvis2mqtt.png`,
      ...((_c = device.manufacturer) != null ? _c : isComparison ? "GridVis2MQTT" : void 0) ? { manufacturer: (_d = device.manufacturer) != null ? _d : "GridVis2MQTT" } : {},
      ...((_e = device.model) != null ? _e : isComparison ? "Comparison" : void 0) ? { model: (_f = device.model) != null ? _f : "Comparison" } : {},
      color: "#fff",
      backgroundColor: isComparison ? "secondary" : "primary",
      actions,
      ...isComparison ? { group: { key: "comparisons", name: { en: "Comparisons", de: "Vergleiche" }, icon: "group" } } : {},
      indicators: entityCount ? [
        {
          id: "entitySummary",
          value: entityCount,
          icon: "lines",
          color: "info",
          text: {
            en: `${device.online.length} online \xB7 ${device.history.length} history`,
            de: `${device.online.length} online \xB7 ${device.history.length} Historie`
          },
          tooltip: { en: "Discovered values", de: "Erkannte Werte" }
        }
      ] : [],
      hasDetails
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Gridvis2mqttDeviceManagement
});
//# sourceMappingURL=device-management.js.map
