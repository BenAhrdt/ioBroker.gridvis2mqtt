import type { NormalizedEntity } from './types';

type StateType = 'boolean' | 'number' | 'string' | 'mixed';

/**
 * Home Assistant has more device classes than ioBroker has specialised roles.
 * Every entry therefore points to an existing ioBroker role; `value` is the
 * intentional fallback where no more specific ioBroker role exists.
 */
const SENSOR_ROLE_BY_DEVICE_CLASS: Record<string, string> = {
	absolute_humidity: 'value.humidity.absolute',
	apparent_power: 'value.power',
	aqi: 'value.airquality',
	area: 'value',
	atmospheric_pressure: 'value.pressure',
	battery: 'value.battery',
	blood_glucose_concentration: 'value.blood.sugar',
	co: 'value.co',
	co2: 'value.co2',
	conductivity: 'value',
	current: 'value.current',
	data_rate: 'value',
	data_size: 'value',
	date: 'date',
	distance: 'value.distance',
	duration: 'value.timer',
	energy: 'value.energy',
	energy_distance: 'value.energy',
	energy_storage: 'value.energy',
	enum: 'text',
	frequency: 'value.frequency',
	gas: 'value.volume',
	humidity: 'value.humidity',
	illuminance: 'value.brightness',
	irradiance: 'value.radiation',
	moisture: 'value',
	monetary: 'value',
	nitrogen_dioxide: 'value.no2',
	nitrogen_monoxide: 'value.no',
	nitrous_oxide: 'value',
	ozone: 'value.o3',
	ph: 'value',
	pm1: 'value.pm1',
	pm25: 'value.pm25',
	pm4: 'value',
	pm10: 'value.pm10',
	power: 'value.power',
	power_factor: 'value',
	precipitation: 'value.precipitation',
	precipitation_intensity: 'value.precipitation',
	pressure: 'value.pressure',
	radon: 'value.rn',
	reactive_energy: 'value.energy.reactive',
	reactive_power: 'value.power.reactive',
	signal_strength: 'value.rssi',
	sound_pressure: 'value',
	speed: 'value.speed',
	sulphur_dioxide: 'value.so2',
	temperature: 'value.temperature',
	temperature_delta: 'value.temperature',
	timestamp: 'date',
	uptime: 'date',
	volatile_organic_compounds: 'value.tvoc',
	volatile_organic_compounds_parts: 'value.tvoc',
	voltage: 'value.voltage',
	volume: 'value.volume',
	volume_flow_rate: 'value.flow',
	volume_storage: 'value.volume',
	water: 'value.volume',
	weight: 'value',
	wind_direction: 'value.direction',
	wind_speed: 'value.speed',
};

const BINARY_SENSOR_ROLE_BY_DEVICE_CLASS: Record<string, string> = {
	battery: 'indicator.lowbat',
	battery_charging: 'sensor',
	co: 'sensor.alarm.co',
	carbon_monoxide: 'sensor.alarm.co',
	cold: 'sensor',
	connectivity: 'sensor',
	door: 'sensor.door',
	garage_door: 'sensor.door',
	gas: 'sensor.alarm',
	glass_break: 'sensor.alarm',
	heat: 'sensor',
	light: 'sensor.light',
	lock: 'sensor.lock',
	moisture: 'sensor.alarm.flood',
	motion: 'sensor.motion',
	moving: 'indicator.working',
	occupancy: 'sensor',
	opening: 'sensor.contact',
	plug: 'sensor.switch',
	power: 'sensor.alarm.power',
	presence: 'sensor',
	problem: 'sensor.alarm',
	running: 'indicator.working',
	safety: 'sensor.alarm',
	smoke: 'sensor.alarm.fire',
	sound: 'sensor.noise',
	tamper: 'sensor.alarm',
	update: 'sensor',
	vibration: 'sensor',
	water: 'sensor.alarm.flood',
	window: 'sensor.window',
};

const NUMERIC_CONTROL_ROLE_BY_DEVICE_CLASS: Record<string, string> = {
	battery: 'level.battery',
	current: 'level.current',
	frequency: 'level.frequency',
	humidity: 'level.humidity',
	illuminance: 'level.brightness',
	pressure: 'level.pressure',
	speed: 'level.speed',
	temperature: 'level.temperature',
	voltage: 'level.voltage',
	volume: 'level.volume',
};

const NON_NUMERIC_SENSOR_CLASSES = new Set(['date', 'enum', 'timestamp', 'uptime']);
const NUMERIC_STATE_CLASSES = new Set(['measurement', 'measurement_angle', 'total', 'total_increasing']);

function configString(entity: NormalizedEntity, key: string): string {
	const value = entity.config[key];
	return typeof value === 'string' ? value.toLowerCase() : '';
}

function semanticText(entity: NormalizedEntity): string {
	return [entity.key, entity.config.name]
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
		.toLowerCase()
		.replace(/[._-]+/g, ' ');
}

function semanticPowerRole(entity: NormalizedEntity, baseRole: string): string {
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

function sensorRole(entity: NormalizedEntity): string {
	const deviceClass = configString(entity, 'device_class');
	const stateClass = configString(entity, 'state_class');
	if (stateClass === 'measurement_angle' && !deviceClass) {
		return 'value.direction';
	}
	if (!deviceClass) {
		if (Array.isArray(entity.config.options)) {
			return 'text';
		}
		if (!isNumericSensor(entity)) {
			return 'state';
		}
	}
	const baseRole = SENSOR_ROLE_BY_DEVICE_CLASS[deviceClass] ?? 'value';
	if (deviceClass === 'energy' || deviceClass === 'power') {
		return semanticPowerRole(entity, baseRole);
	}
	return baseRole;
}

/** Derives the ioBroker state type from the Home Assistant discovery metadata. */
export function stateTypeFor(entity: NormalizedEntity): StateType {
	if (['binary_sensor', 'light', 'switch', 'lock'].includes(entity.component)) {
		return 'boolean';
	}
	if (entity.component === 'number') {
		return 'number';
	}
	if (entity.component === 'select') {
		return 'string';
	}
	if (entity.component === 'sensor') {
		const deviceClass = configString(entity, 'device_class');
		if (NON_NUMERIC_SENSOR_CLASSES.has(deviceClass) || Array.isArray(entity.config.options)) {
			return 'string';
		}
		if (
			typeof entity.config.unit_of_measurement === 'string' ||
			typeof entity.config.device_class === 'string' ||
			NUMERIC_STATE_CLASSES.has(configString(entity, 'state_class')) ||
			entity.config.min !== undefined ||
			entity.config.max !== undefined
		) {
			return 'number';
		}
	}
	if (entity.component === 'button') {
		return 'boolean';
	}
	return 'mixed';
}

/** Derives the most specific valid ioBroker role available for a discovery entity. */
export function roleFor(entity: NormalizedEntity): string {
	const deviceClass = configString(entity, 'device_class');
	switch (entity.component) {
		case 'binary_sensor':
			return BINARY_SENSOR_ROLE_BY_DEVICE_CLASS[deviceClass] ?? 'sensor';
		case 'switch':
			return deviceClass === 'outlet' ? 'switch.power' : 'switch';
		case 'light':
			return 'switch.light';
		case 'number':
			return NUMERIC_CONTROL_ROLE_BY_DEVICE_CLASS[deviceClass] ?? 'level';
		case 'lock':
			return 'switch.lock';
		case 'button':
			return 'button';
		case 'select':
			return 'text';
		case 'sensor':
			return sensorRole(entity);
		default:
			return 'value';
	}
}

/** Used by MQTT value coercion to keep date/enum-like sensors as strings. */
export function isNumericSensor(entity: NormalizedEntity): boolean {
	if (entity.component !== 'sensor' || NON_NUMERIC_SENSOR_CLASSES.has(configString(entity, 'device_class'))) {
		return false;
	}
	return (
		typeof entity.config.unit_of_measurement === 'string' ||
		typeof entity.config.device_class === 'string' ||
		NUMERIC_STATE_CLASSES.has(configString(entity, 'state_class')) ||
		entity.config.min !== undefined ||
		entity.config.max !== undefined
	);
}
