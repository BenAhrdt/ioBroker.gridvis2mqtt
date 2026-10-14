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
var roles_exports = {};
__export(roles_exports, {
  isNumericSensor: () => isNumericSensor,
  roleFor: () => roleFor,
  stateTypeFor: () => stateTypeFor
});
module.exports = __toCommonJS(roles_exports);
const SENSOR_ROLE_BY_DEVICE_CLASS = {
  absolute_humidity: "value.humidity.absolute",
  apparent_power: "value.power",
  aqi: "value.airquality",
  area: "value",
  atmospheric_pressure: "value.pressure",
  battery: "value.battery",
  blood_glucose_concentration: "value.blood.sugar",
  co: "value.co",
  co2: "value.co2",
  conductivity: "value",
  current: "value.current",
  data_rate: "value",
  data_size: "value",
  date: "date",
  distance: "value.distance",
  duration: "value.timer",
  energy: "value.energy",
  energy_distance: "value.energy",
  energy_storage: "value.energy",
  enum: "text",
  frequency: "value.frequency",
  gas: "value.volume",
  humidity: "value.humidity",
  illuminance: "value.brightness",
  irradiance: "value.radiation",
  moisture: "value",
  monetary: "value",
  nitrogen_dioxide: "value.no2",
  nitrogen_monoxide: "value.no",
  nitrous_oxide: "value",
  ozone: "value.o3",
  ph: "value",
  pm1: "value.pm1",
  pm25: "value.pm25",
  pm4: "value",
  pm10: "value.pm10",
  power: "value.power",
  power_factor: "value",
  precipitation: "value.precipitation",
  precipitation_intensity: "value.precipitation",
  pressure: "value.pressure",
  radon: "value.rn",
  reactive_energy: "value.energy.reactive",
  reactive_power: "value.power.reactive",
  signal_strength: "value.rssi",
  sound_pressure: "value",
  speed: "value.speed",
  sulphur_dioxide: "value.so2",
  temperature: "value.temperature",
  temperature_delta: "value.temperature",
  timestamp: "date",
  uptime: "date",
  volatile_organic_compounds: "value.tvoc",
  volatile_organic_compounds_parts: "value.tvoc",
  voltage: "value.voltage",
  volume: "value.volume",
  volume_flow_rate: "value.flow",
  volume_storage: "value.volume",
  water: "value.volume",
  weight: "value",
  wind_direction: "value.direction",
  wind_speed: "value.speed"
};
const BINARY_SENSOR_ROLE_BY_DEVICE_CLASS = {
  battery: "indicator.lowbat",
  battery_charging: "sensor",
  co: "sensor.alarm.co",
  carbon_monoxide: "sensor.alarm.co",
  cold: "sensor",
  connectivity: "sensor",
  door: "sensor.door",
  garage_door: "sensor.door",
  gas: "sensor.alarm",
  glass_break: "sensor.alarm",
  heat: "sensor",
  light: "sensor.light",
  lock: "sensor.lock",
  moisture: "sensor.alarm.flood",
  motion: "sensor.motion",
  moving: "indicator.working",
  occupancy: "sensor",
  opening: "sensor.contact",
  plug: "sensor.switch",
  power: "sensor.alarm.power",
  presence: "sensor",
  problem: "sensor.alarm",
  running: "indicator.working",
  safety: "sensor.alarm",
  smoke: "sensor.alarm.fire",
  sound: "sensor.noise",
  tamper: "sensor.alarm",
  update: "sensor",
  vibration: "sensor",
  water: "sensor.alarm.flood",
  window: "sensor.window"
};
const NUMERIC_CONTROL_ROLE_BY_DEVICE_CLASS = {
  battery: "level.battery",
  current: "level.current",
  frequency: "level.frequency",
  humidity: "level.humidity",
  illuminance: "level.brightness",
  pressure: "level.pressure",
  speed: "level.speed",
  temperature: "level.temperature",
  voltage: "level.voltage",
  volume: "level.volume"
};
const NON_NUMERIC_SENSOR_CLASSES = /* @__PURE__ */ new Set(["date", "enum", "timestamp", "uptime"]);
const NUMERIC_STATE_CLASSES = /* @__PURE__ */ new Set(["measurement", "measurement_angle", "total", "total_increasing"]);
function configString(entity, key) {
  const value = entity.config[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}
function semanticText(entity) {
  return [entity.key, entity.config.name].filter((value) => typeof value === "string").join(" ").toLowerCase().replace(/[._-]+/g, " ");
}
function semanticPowerRole(entity, baseRole) {
  const text = semanticText(entity);
  if (/(?:reactive|reaktiv|blindleistung|blindenergie)/.test(text)) {
    return `${baseRole}.reactive`;
  }
  if (/(?:consum|verbrauch|bezogen|import)/.test(text)) {
    return `${baseRole}.consumed`;
  }
  if (/(?:produc|erzeug|geliefer|suppl|export)/.test(text)) {
    return `${baseRole}.produced`;
  }
  if (/(?:active|aktiv|wirkleistung|wirkenergie|poweractive|energyactive)/.test(text)) {
    return `${baseRole}.active`;
  }
  return baseRole;
}
function sensorRole(entity) {
  var _a;
  const deviceClass = configString(entity, "device_class");
  const stateClass = configString(entity, "state_class");
  if (stateClass === "measurement_angle" && !deviceClass) {
    return "value.direction";
  }
  if (!deviceClass) {
    if (Array.isArray(entity.config.options)) {
      return "text";
    }
    if (!isNumericSensor(entity)) {
      return "state";
    }
  }
  const baseRole = (_a = SENSOR_ROLE_BY_DEVICE_CLASS[deviceClass]) != null ? _a : "value";
  if (deviceClass === "energy" || deviceClass === "power") {
    return semanticPowerRole(entity, baseRole);
  }
  return baseRole;
}
function stateTypeFor(entity) {
  if (["binary_sensor", "light", "switch", "lock"].includes(entity.component)) {
    return "boolean";
  }
  if (entity.component === "number") {
    return "number";
  }
  if (entity.component === "select") {
    return "string";
  }
  if (entity.component === "sensor") {
    const deviceClass = configString(entity, "device_class");
    if (NON_NUMERIC_SENSOR_CLASSES.has(deviceClass) || Array.isArray(entity.config.options)) {
      return "string";
    }
    if (typeof entity.config.unit_of_measurement === "string" || typeof entity.config.device_class === "string" || NUMERIC_STATE_CLASSES.has(configString(entity, "state_class")) || entity.config.min !== void 0 || entity.config.max !== void 0) {
      return "number";
    }
  }
  if (entity.component === "button") {
    return "boolean";
  }
  return "mixed";
}
function roleFor(entity) {
  var _a, _b;
  const deviceClass = configString(entity, "device_class");
  switch (entity.component) {
    case "binary_sensor":
      return (_a = BINARY_SENSOR_ROLE_BY_DEVICE_CLASS[deviceClass]) != null ? _a : "sensor";
    case "switch":
      return deviceClass === "outlet" ? "switch.power" : "switch";
    case "light":
      return "switch.light";
    case "number":
      return (_b = NUMERIC_CONTROL_ROLE_BY_DEVICE_CLASS[deviceClass]) != null ? _b : "level";
    case "lock":
      return "switch.lock";
    case "button":
      return "button";
    case "select":
      return "text";
    case "sensor":
      return sensorRole(entity);
    default:
      return "value";
  }
}
function isNumericSensor(entity) {
  if (entity.component !== "sensor" || NON_NUMERIC_SENSOR_CLASSES.has(configString(entity, "device_class"))) {
    return false;
  }
  return typeof entity.config.unit_of_measurement === "string" || typeof entity.config.device_class === "string" || NUMERIC_STATE_CLASSES.has(configString(entity, "state_class")) || entity.config.min !== void 0 || entity.config.max !== void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isNumericSensor,
  roleFor,
  stateTypeFor
});
//# sourceMappingURL=roles.js.map
