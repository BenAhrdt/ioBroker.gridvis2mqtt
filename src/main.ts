import * as utils from '@iobroker/adapter-core';
import { randomUUID } from 'node:crypto';
import type { IClientOptions, IClientSubscribeOptions, MqttClient } from 'mqtt';
import mqtt from 'mqtt';
import {
	availabilityEntries,
	discoverySubscription,
	entityObjectPath,
	isGridvisBridgeDiscovery,
	normalizeDiscovery,
	normalizeDiscoveryPrefix,
	parseDiscoveryTopic,
	stableDeviceId,
} from './discovery';
import type {
	AdapterConfig,
	EntityCategory,
	EntityRuntime,
	JsonRecord,
	NormalizedDiscovery,
	NormalizedEntity,
	DiscoveryEntityRecord,
	DiscoveryRecord,
	ComparisonDefinition,
	ComparisonEntry,
	ComparisonOptionGroup,
} from './types';
import { evaluateValueTemplate, isSupportedCommandTemplate, renderCommandTemplate } from './templates';
import { isNumericSensor, roleFor, stateTypeFor } from './roles';
import { Gridvis2mqttDeviceManagement, type DeviceManagerDevice, type DeviceManagerEntity } from './device-management';

const OWNER = 'gridvis2mqtt';
const DEVICES_ROOT = 'devices';
const DISCOVERY_SYNC_TIMEOUT_MS = 10_000;
const DEVICE_ICON_FETCH_TIMEOUT_MS = 5_000;
const DEVICE_ICON_MAX_BYTES = 512 * 1024;
const DEVICE_INFO_KEYS = [
	'name',
	'manufacturer',
	'model',
	'serial_number',
	'sw_version',
	'hw_version',
	'connections',
	'origin',
] as const;
const BRIDGE_INFO_ENTITY_IDS = new Set(['gridvis2mqtt_url', 'gridvis_version', 'sw_version']);
const COMPARISONS_NATIVE_KEY = 'comparisons';
const COMPARISON_OBJECT_ROOT = `${DEVICES_ROOT}.comparisons`;
const COMPARISON_NUMBER_FORMAT = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});
const COMPARISON_PERCENTAGE_FORMAT = new Intl.NumberFormat('de-DE', {
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
});

function comparisonEntryKey(deviceId: string, valueStateId: string): string {
	return `${deviceId}|${valueStateId}`;
}

function parseComparisonEntryKey(value: string): { deviceId: string; valueStateId: string } | undefined {
	const separator = value.indexOf('|');
	if (separator <= 0 || separator >= value.length - 1) {
		return undefined;
	}
	return { deviceId: value.slice(0, separator), valueStateId: value.slice(separator + 1) };
}

function comparisonDisplayStatePath(comparisonId: string, entryIndex: number): string {
	return `${COMPARISON_OBJECT_ROOT}.${comparisonId}.value_${entryIndex}`;
}

function comparisonDisplayValue(
	value: ioBroker.StateValue | undefined,
	unit: string | undefined,
	percentage: number,
): string {
	const numericValue =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim()
				? Number(value.trim())
				: Number.NaN;
	const formattedValue = Number.isFinite(numericValue)
		? COMPARISON_NUMBER_FORMAT.format(numericValue)
		: value === null || value === undefined
			? '—'
			: String(value);
	const formattedUnit = unit ? ` ${unit}` : '';
	return `${formattedValue}${formattedUnit} (${COMPARISON_PERCENTAGE_FORMAT.format(percentage)}%)`;
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);
}

function asNumber(value: unknown, fallback: number): number {
	const result = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(result) ? result : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === 'string') {
		const text = value.trim();
		return text || undefined;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	try {
		const text = JSON.stringify(value);
		return text || undefined;
	} catch {
		return undefined;
	}
}

function isIconUrlInfo(entityId: string, name: unknown): boolean {
	return `${entityId}${asString(name)}`
		.replace(/[^a-z0-9]/gi, '')
		.toLowerCase()
		.includes('iconurl');
}

function iconUrlValue(value: ioBroker.StateValue | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const text = value.trim();
	return text || undefined;
}

function entityCategoryPath(deviceId: string, category: EntityCategory): string {
	if (category === 'instanceInfo') {
		return 'info';
	}
	return `${DEVICES_ROOT}.${deviceId}.${category}`;
}

function deviceAvailabilityPath(deviceId: string): string {
	return `${DEVICES_ROOT}.${deviceId}.available`;
}

function historyEntityAvailabilityPath(deviceId: string, entityId: string): string {
	return `${DEVICES_ROOT}.${deviceId}.history.${entityId}.available`;
}

function entityBasePath(
	deviceId: string,
	entity: Pick<DiscoveryEntityRecord, 'entityId' | 'category' | 'historyPeriod'>,
): string {
	const category = entity.category ?? 'online';
	if (category === 'instanceInfo') {
		return `info.${entity.entityId}`;
	}
	const parts = [entityCategoryPath(deviceId, category), entity.entityId];
	if (category === 'history' && entity.historyPeriod) {
		parts.push(entity.historyPeriod);
	}
	return parts.join('.');
}

function entityPathKey(entity: Pick<DiscoveryEntityRecord, 'entityId' | 'category' | 'historyPeriod'>): string {
	return [entity.category ?? 'online', entity.entityId, entity.historyPeriod ?? ''].join('|');
}

function categoryObjectType(category: EntityCategory): 'channel' | 'folder' {
	return category === 'info' ? 'channel' : 'folder';
}

function entityObjectType(category: EntityCategory): 'channel' | 'folder' {
	return category === 'online' ? 'channel' : 'folder';
}

function isInfoCategory(category: EntityCategory | undefined): boolean {
	return category === 'info' || category === 'instanceInfo';
}

function deviceObjectIdsForDevice(deviceId: string, discovery?: NormalizedDiscovery): string[] {
	if (discovery && isGridvisBridgeDiscovery(discovery)) {
		return [];
	}
	const devicePath = `${DEVICES_ROOT}.${deviceId}`;
	const infoPath = `${devicePath}.info`;
	const device = discovery?.device ?? discovery?.entities[0]?.device ?? {};
	const isBridge = discovery ? isGridvisBridgeDiscovery(discovery) : false;
	const infoKeys = discovery
		? DEVICE_INFO_KEYS.filter(key => key === 'origin' || device[key] !== undefined)
		: DEVICE_INFO_KEYS;
	return [
		devicePath,
		...(isBridge ? [] : [deviceAvailabilityPath(deviceId)]),
		infoPath,
		...infoKeys.flatMap(key => {
			const entityPath = `${infoPath}.${key}`;
			return [entityPath];
		}),
	];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HISTORY_PERIOD_LABELS: Record<string, string[]> = {
	today: ['today', 'heute'],
	yesterday: ['yesterday', 'gestern'],
	thisweek: ['this week', 'diese woche'],
	lastweek: ['last week', 'letzte woche'],
	thismonth: ['this month', 'dieser monat'],
	lastmonth: ['last month', 'letzter monat'],
	thisyear: ['this year', 'dieses jahr'],
	lastyear: ['last year', 'letztes jahr'],
	last3months: ['last 3 months', 'letzte 3 monate'],
};

function historyMetricName(value: unknown, period: string | undefined): string {
	const name = asString(value);
	if (!name || !period) {
		return name;
	}
	for (const label of HISTORY_PERIOD_LABELS[period.toLowerCase()] ?? []) {
		const suffix = new RegExp(`\\s*(?:[-–—:]\\s*)?${escapeRegExp(label)}\\s*$`, 'i');
		const baseName = name.replace(suffix, '').trim();
		if (baseName && baseName !== name) {
			return baseName;
		}
	}
	return name;
}

function historyPeriodName(value: unknown, period: string | undefined): string {
	const name = asString(value).trim();
	if (!period || !name) {
		return period ?? name;
	}
	for (const label of HISTORY_PERIOD_LABELS[period.toLowerCase()] ?? []) {
		const suffix = new RegExp(`(?:[-–—:]\\s*)?(${escapeRegExp(label)})\\s*$`, 'i');
		const match = name.match(suffix);
		if (match?.[1]) {
			return match[1];
		}
	}
	return period;
}

function markerOf(object: ioBroker.Object | null | undefined): JsonRecord | undefined {
	if (!object?.native || typeof object.native !== 'object') {
		return undefined;
	}
	const native = object.native as JsonRecord;
	const marker = native[OWNER] ?? (native.adapter === OWNER ? native : undefined);
	return marker && typeof marker === 'object' && !Array.isArray(marker) ? (marker as JsonRecord) : undefined;
}

function isOwned(object: ioBroker.Object | null | undefined): boolean {
	return markerOf(object)?.adapter === OWNER;
}

function objectMarker(kind: string, discoveryTopic?: string, deviceId?: string): JsonRecord {
	return { adapter: OWNER, kind, ...(discoveryTopic ? { discoveryTopic } : {}), ...(deviceId ? { deviceId } : {}) };
}

function optionsToStates(options: unknown): Record<string, string> | undefined {
	if (!Array.isArray(options)) {
		return undefined;
	}
	const states: Record<string, string> = {};
	for (const option of options) {
		if (typeof option === 'string' || typeof option === 'number') {
			states[String(option)] = String(option);
		}
	}
	return Object.keys(states).length ? states : undefined;
}

function availabilityValue(payload: string, entry: JsonRecord): boolean | undefined {
	const template = entry.value_template;
	if (template) {
		const result = evaluateValueTemplate(template, payload);
		if (!result.supported) {
			return undefined;
		}
		if (typeof result.value === 'boolean') {
			return result.value;
		}
		if (typeof result.value === 'string') {
			payload = result.value;
		}
	}
	const available = entry.payload_available;
	const unavailable = entry.payload_not_available;
	if (available !== undefined && payload === String(available)) {
		return true;
	}
	if (unavailable !== undefined && payload === String(unavailable)) {
		return false;
	}
	const normalized = payload.trim().toLowerCase();
	if (['true', '1', 'on', 'online', 'available'].includes(normalized)) {
		return true;
	}
	if (['false', '0', 'off', 'offline', 'unavailable'].includes(normalized)) {
		return false;
	}
	return undefined;
}

function coerceStateValue(value: ioBroker.StateValue, entity: NormalizedEntity): ioBroker.StateValue {
	if (typeof value !== 'string') {
		return value;
	}
	if (['binary_sensor', 'switch', 'lock'].includes(entity.component)) {
		const normalized = value.trim().toLowerCase();
		if (['true', '1', 'on', 'yes', 'online'].includes(normalized)) {
			return true;
		}
		if (['false', '0', 'off', 'no', 'offline'].includes(normalized)) {
			return false;
		}
	}
	if (entity.component === 'number' || isNumericSensor(entity)) {
		const number = Number(value.trim());
		if (Number.isFinite(number)) {
			return number;
		}
	}
	return value;
}

class Gridvis2mqtt extends utils.Adapter {
	private mqttClient?: MqttClient;
	private readonly discoveries = new Map<string, DiscoveryRecord>();
	private prefix = 'homeassistant';
	private mqttConnected = false;
	private shuttingDown = false;
	private messageCount = 0;
	private readonly topicReferences = new Map<string, number>();
	private readonly subscribedTopics = new Set<string>();
	private readonly topicConsumers = new Map<string, Set<string>>();
	private readonly runtimes = new Map<string, EntityRuntime>();
	private readonly stateActions = new Map<string, { runtimeKey: string; action: 'value' | 'press' }>();
	private comparisonDefinitions: ComparisonDefinition[] = [];
	private messageQueue: Promise<void> = Promise.resolve();
	private discoverySyncTimer?: ReturnType<typeof setTimeout>;
	private deviceManagerRefreshTimer?: ReturnType<typeof setTimeout>;
	private discoverySyncActive = false;
	private readonly discoverySyncSeen = new Set<string>();
	private deviceManagement?: Gridvis2mqttDeviceManagement;

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({ ...options, name: 'gridvis2mqtt' });
		this.on('ready', () => void this.onReady());
		this.on('stateChange', (id, state) => void this.onStateChange(id, state));
		this.on('unload', this.onUnload.bind(this));
	}

	private get configValues(): AdapterConfig {
		return this.config;
	}

	private async onReady(): Promise<void> {
		await this.setStateAsync('info.connection', false, true);
		await this.setStateAsync('info.lastError', '', true);
		await this.setStateAsync('info.messagesReceived', 0, true);
		await this.ensureRootObjects();
		await this.loadComparisonDefinitions();
		this.deviceManagement = new Gridvis2mqttDeviceManagement(this);

		this.prefix = normalizeDiscoveryPrefix(this.configValues.discoveryPrefix);

		this.subscribeStates('devices.*.*.*');
		this.subscribeStates('devices.*.*.*.*');
		this.subscribeStates('devices.*.*.*.*.*');
		if (this.configValues.enabled === false) {
			this.log.info('Adapter is disabled in the configuration');
			return;
		}
		try {
			this.createMqttClient();
		} catch (error) {
			this.reportError('Could not create the MQTT client', error);
		}
	}

	private async ensureRootObjects(): Promise<void> {
		const existing = await this.getObjectAsync(DEVICES_ROOT);
		const existingNative =
			existing?.native && typeof existing.native === 'object' && !Array.isArray(existing.native)
				? (existing.native as JsonRecord)
				: {};
		const existingMarker = markerOf(existing) ?? objectMarker('root');
		await this.upsertObject(
			DEVICES_ROOT,
			{
				type: 'folder',
				common: { name: 'GridVis2MQTT devices' },
				native: { ...existingNative, [OWNER]: existingMarker },
			},
			'root',
		);
	}

	private async loadComparisonDefinitions(): Promise<void> {
		const root = await this.getObjectAsync(DEVICES_ROOT);
		const rootMarker = markerOf(root);
		const rootRaw = rootMarker?.[COMPARISONS_NATIVE_KEY];
		const instance = await this.getForeignObjectAsync(this.namespace);
		const instanceNative = instance?.native;
		const legacyRaw =
			instanceNative && typeof instanceNative === 'object' && !Array.isArray(instanceNative)
				? (instanceNative as JsonRecord)[COMPARISONS_NATIVE_KEY]
				: undefined;
		const raw = Array.isArray(rootRaw) ? rootRaw : legacyRaw;
		if (!Array.isArray(raw)) {
			this.comparisonDefinitions = [];
			return;
		}
		this.comparisonDefinitions = raw.flatMap(value => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				return [];
			}
			const record = value as JsonRecord;
			const id = optionalText(record.id);
			const name = optionalText(record.name);
			if (!id || !name || !Array.isArray(record.entries)) {
				return [];
			}
			const entries = record.entries.flatMap(entryValue => {
				if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) {
					return [];
				}
				const entry = entryValue as JsonRecord;
				const deviceId = optionalText(entry.deviceId);
				const valueStateId = optionalText(entry.valueStateId);
				const category: ComparisonEntry['category'] | undefined =
					entry.category === 'history' ? 'history' : entry.category === 'online' ? 'online' : undefined;
				if (!deviceId || !valueStateId || !category) {
					return [];
				}
				return [
					{
						key: optionalText(entry.key) ?? comparisonEntryKey(deviceId, valueStateId),
						deviceId,
						deviceName: optionalText(entry.deviceName) ?? deviceId,
						valueStateId,
						category,
						name: optionalText(entry.name) ?? valueStateId,
						...(optionalText(entry.unit) ? { unit: optionalText(entry.unit) } : {}),
						...(optionalText(entry.period) ? { period: optionalText(entry.period) } : {}),
					},
				];
			});
			return entries.length ? [{ id, name, entries }] : [];
		});
		if (!Array.isArray(rootRaw) && Array.isArray(legacyRaw) && this.comparisonDefinitions.length) {
			await this.saveComparisonDefinitions();
		}
	}

	private async saveComparisonDefinitions(): Promise<void> {
		const root = await this.getObjectAsync(DEVICES_ROOT);
		if (!root) {
			throw new Error(`Cannot persist comparisons: missing object ${DEVICES_ROOT}`);
		}
		const native =
			root.native && typeof root.native === 'object' && !Array.isArray(root.native)
				? (root.native as JsonRecord)
				: {};
		const marker = markerOf(root) ?? objectMarker('root');
		await this.setObjectAsync(DEVICES_ROOT, {
			type: 'folder',
			common: { name: asString(root.common?.name, 'GridVis2MQTT devices') },
			native: {
				...native,
				[OWNER]: {
					...marker,
					[COMPARISONS_NATIVE_KEY]: this.comparisonDefinitions,
				},
			},
		});
	}

	private createMqttClient(): void {
		const config = this.configValues;
		const configuredProtocol = config.protocol === 'mqtts' ? 'mqtts' : 'mqtt';
		let brokerUrl = asString(config.brokerUrl).trim();
		if (!brokerUrl) {
			const host = asString(config.host, 'localhost').trim() || 'localhost';
			const defaultPort = configuredProtocol === 'mqtts' ? 8883 : 1883;
			brokerUrl = `${configuredProtocol}://${host}:${asNumber(config.port, defaultPort)}`;
		} else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(brokerUrl)) {
			brokerUrl = `${configuredProtocol}://${brokerUrl}`;
		}
		const protocol = /^mqtts:\/\//i.test(brokerUrl) ? 'mqtts' : 'mqtt';

		const options: IClientOptions = {
			protocol,
			keepalive: Math.max(15, asNumber(config.keepalive, 60)),
			clientId: asString(config.clientId).trim() || undefined,
			username: asString(config.username) || undefined,
			password: asString(config.password) || undefined,
			protocolVersion: 5,
			clean: true,
			resubscribe: false,
		};
		if (protocol === 'mqtts') {
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

		this.log.info(`Connecting to MQTT broker ${brokerUrl.replace(/:\/\/[^/@]+@/, '://***@')}`);
		this.mqttClient = mqtt.connect(brokerUrl, options);
		this.mqttClient.on('connect', () => void this.onMqttConnect());
		this.mqttClient.on('message', (topic, payload) => {
			this.noteDiscoverySyncMessage(topic, payload);
			this.messageQueue = this.messageQueue
				.then(() => this.handleMqttMessage(topic, payload))
				.catch(error => this.reportError('Error processing an MQTT message', error));
		});
		this.mqttClient.on('error', error => this.reportError('MQTT error', error));
		this.mqttClient.on('close', () => {
			this.mqttConnected = false;
			this.cancelDiscoverySync();
			this.subscribedTopics.clear();
			void this.setStateAsync('info.connection', false, true);
		});
		this.mqttClient.on('offline', () => {
			this.mqttConnected = false;
			this.cancelDiscoverySync();
			void this.setStateAsync('info.connection', false, true);
		});
	}

	private async onMqttConnect(): Promise<void> {
		if (this.shuttingDown || !this.mqttClient) {
			return;
		}
		this.mqttConnected = true;
		await this.setStateAsync('info.connection', true, true);
		await this.setStateAsync('info.lastError', '', true);
		this.startDiscoverySync();
		await this.subscribeMqtt(discoverySubscription(this.prefix));
		for (const topic of this.topicReferences.keys()) {
			await this.subscribeMqtt(topic);
		}
	}

	private startDiscoverySync(): void {
		this.cancelDiscoverySync();
		this.discoverySyncActive = true;
		this.restartDiscoverySyncTimer();
	}

	private restartDiscoverySyncTimer(): void {
		if (!this.discoverySyncActive) {
			return;
		}
		if (this.discoverySyncTimer) {
			clearTimeout(this.discoverySyncTimer);
		}
		this.discoverySyncTimer = setTimeout(() => {
			this.discoverySyncTimer = undefined;
			this.messageQueue = this.messageQueue
				.then(() => this.finishDiscoverySync())
				.catch(error => this.reportError('Error synchronizing MQTT discovery', error));
		}, DISCOVERY_SYNC_TIMEOUT_MS);
	}

	private noteDiscoverySyncMessage(topic: string, payload: Buffer): void {
		if (!this.discoverySyncActive || !parseDiscoveryTopic(topic, this.prefix)) {
			return;
		}
		const isAcceptedDiscovery = payload.length === 0 || normalizeDiscovery(topic, this.prefix, payload) !== null;
		if (!isAcceptedDiscovery) {
			return;
		}
		this.discoverySyncSeen.add(topic);
		this.restartDiscoverySyncTimer();
	}

	private cancelDiscoverySync(): void {
		if (this.discoverySyncTimer) {
			clearTimeout(this.discoverySyncTimer);
			this.discoverySyncTimer = undefined;
		}
		this.discoverySyncActive = false;
		this.discoverySyncSeen.clear();
	}

	private scheduleDeviceManagerRefresh(): void {
		if (this.shuttingDown || !this.deviceManagement || this.deviceManagerRefreshTimer) {
			return;
		}
		const deviceManagement = this.deviceManagement;
		this.deviceManagerRefreshTimer = setTimeout(() => {
			this.deviceManagerRefreshTimer = undefined;
			void deviceManagement
				.refreshCards()
				.catch(error => this.reportError('Could not refresh the Device Manager cards', error));
		}, 250);
	}

	private async finishDiscoverySync(): Promise<void> {
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
			`Finished GridVis2MQTT discovery synchronization; removed ${removedDiscoveries} stale discoveries and ${removedObjects} orphaned objects`,
		);
	}

	private async cleanupOrphanedObjects(): Promise<number> {
		const referenced = new Set<string>([DEVICES_ROOT]);
		for (const record of this.discoveries.values()) {
			for (const objectId of record.objectIds ?? []) {
				referenced.add(objectId);
			}
			for (const objectId of record.deviceObjectIds ?? []) {
				referenced.add(objectId);
			}
			for (const entity of record.entities) {
				for (const objectId of entity.objectIds ?? []) {
					referenced.add(objectId);
				}
			}
		}
		referenced.add(COMPARISON_OBJECT_ROOT);
		for (const definition of this.comparisonDefinitions) {
			referenced.add(`${COMPARISON_OBJECT_ROOT}.${definition.id}`);
			definition.entries.forEach((_entry, index) =>
				referenced.add(comparisonDisplayStatePath(definition.id, index)),
			);
		}

		const prefix = `${this.namespace}.${DEVICES_ROOT}`;
		const objects = await this.getObjectListAsync({
			startkey: prefix,
			endkey: `${prefix}\u9999`,
		});
		const orphaned = objects.rows
			.filter(row => {
				const relativeId = row.id.startsWith(`${this.namespace}.`)
					? row.id.slice(this.namespace.length + 1)
					: row.id;
				return relativeId !== DEVICES_ROOT && !referenced.has(relativeId);
			})
			.sort((left, right) => right.id.length - left.id.length);
		for (const row of orphaned) {
			const relativeId = row.id.startsWith(`${this.namespace}.`)
				? row.id.slice(this.namespace.length + 1)
				: row.id;
			await this.deleteManagedObject(relativeId, 'startup-reconciliation');
		}
		return orphaned.length;
	}

	private mqttQos(): 0 | 1 | 2 {
		return Math.min(2, Math.max(0, Math.round(asNumber(this.configValues.qos, 0)))) as 0 | 1 | 2;
	}

	private async subscribeMqtt(topic: string): Promise<void> {
		if (!this.mqttClient || !this.mqttConnected || this.subscribedTopics.has(topic)) {
			return;
		}
		const options: IClientSubscribeOptions = { qos: this.mqttQos() };
		await new Promise<void>((resolve, reject) => {
			this.mqttClient?.subscribe(topic, options, error => (error ? reject(error) : resolve()));
		});
		this.subscribedTopics.add(topic);
	}

	private async unsubscribeMqtt(topic: string): Promise<void> {
		if (!this.mqttClient || !this.mqttConnected || !this.subscribedTopics.has(topic)) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			this.mqttClient?.unsubscribe(topic, error => (error ? reject(error) : resolve()));
		});
		this.subscribedTopics.delete(topic);
	}

	private async addTopicReference(topic: string | undefined, consumer: string): Promise<void> {
		if (!topic) {
			return;
		}
		this.topicReferences.set(topic, (this.topicReferences.get(topic) ?? 0) + 1);
		const consumers = this.topicConsumers.get(topic) ?? new Set<string>();
		consumers.add(consumer);
		this.topicConsumers.set(topic, consumers);
		await this.subscribeMqtt(topic);
		if (topic.endsWith('/availability')) {
			this.log.debug(`Subscribed GridVis2MQTT availability topic ${topic}`);
		}
	}

	private async removeTopicReference(topic: string | undefined, consumer: string): Promise<void> {
		if (!topic) {
			return;
		}
		const consumers = this.topicConsumers.get(topic);
		consumers?.delete(consumer);
		if (consumers && consumers.size > 0) {
			this.topicConsumers.set(topic, consumers);
		} else {
			this.topicConsumers.delete(topic);
		}
		const count = (this.topicReferences.get(topic) ?? 0) - 1;
		if (count > 0) {
			this.topicReferences.set(topic, count);
		} else {
			this.topicReferences.delete(topic);
			await this.unsubscribeMqtt(topic).catch(error =>
				this.reportError(`Could not unsubscribe from ${topic}`, error),
			);
		}
	}

	private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
		this.messageCount += 1;
		void this.setStateAsync('info.messagesReceived', this.messageCount, true);
		if (payload.length > 1024 * 1024) {
			this.log.warn(`Ignoring an MQTT payload larger than 1 MiB on ${topic}`);
			return;
		}
		const topicInfo = parseDiscoveryTopic(topic, this.prefix);
		if (topicInfo) {
			if (payload.length === 0) {
				if (this.discoveries.has(topic)) {
					await this.removeDiscovery(topic);
				}
				return;
			}
			const discovery = normalizeDiscovery(topic, this.prefix, payload);
			if (discovery) {
				await this.applyDiscovery(discovery);
			}
			return;
		}

		const consumers = this.topicConsumers.get(topic);
		if (!consumers) {
			if (topic.endsWith('/availability')) {
				this.log.warn(`Received GridVis2MQTT availability topic without a runtime consumer: ${topic}`);
			}
			return;
		}
		for (const runtimeKey of consumers) {
			const runtime = this.runtimes.get(runtimeKey);
			if (runtime) {
				await this.processEntityMessage(runtime, topic, payload.toString('utf8'));
			}
		}
	}

	private async applyDiscovery(discovery: NormalizedDiscovery): Promise<void> {
		const previousRecord = this.discoveries.get(discovery.topic);
		const runtimeReady = previousRecord?.entities.every(entity =>
			this.runtimes.has(`${discovery.topic}|${entity.key}`),
		);
		if (
			previousRecord &&
			runtimeReady &&
			JSON.stringify(previousRecord.discovery.normalizedPayload) === JSON.stringify(discovery.normalizedPayload)
		) {
			return;
		}
		const record = await this.buildDiscoveryRecord(discovery);
		if (previousRecord) {
			const preservedObjectIds = new Set<string>([
				...record.objectIds,
				...record.deviceObjectIds,
				...record.entities.flatMap(entity => entity.objectIds),
			]);
			await this.removeDiscovery(discovery.topic, preservedObjectIds, false);
		}
		this.discoveries.set(discovery.topic, record);
		await this.installDiscovery(discovery, record);
		this.scheduleDeviceManagerRefresh();
		this.log.debug(`Accepted GridVis2MQTT discovery ${discovery.topic}`);
	}

	public async getDeviceManagerDevices(): Promise<DeviceManagerDevice[]> {
		const devices = new Map<string, DeviceManagerDevice>();

		const addEntity = (
			device: DeviceManagerDevice,
			category: 'online' | 'history' | 'info',
			entity: DeviceManagerEntity,
		): void => {
			const entities = device[category];
			if (!entities.some(candidate => candidate.valueStateId === entity.valueStateId)) {
				entities.push(entity);
			}
		};

		for (const record of this.discoveries.values()) {
			if (isGridvisBridgeDiscovery(record.discovery)) {
				continue;
			}
			const sourceDevice = record.discovery.device ?? record.discovery.entities[0]?.device ?? {};
			const discoveryIcon =
				optionalText(sourceDevice.icon) ??
				record.discovery.entities
					.map(entity => optionalText(entity.config.icon))
					.find((value): value is string => !!value);
			const current = devices.get(record.deviceId);
			const device: DeviceManagerDevice = current ?? {
				id: record.deviceId,
				originalName: optionalText(sourceDevice.name) ?? record.deviceId,
				name: optionalText(sourceDevice.name) ?? record.deviceId,
				identifier: optionalText(sourceDevice.serial_number) ?? record.deviceId,
				icon: discoveryIcon,
				manufacturer: optionalText(sourceDevice.manufacturer),
				model: optionalText(sourceDevice.model) ?? optionalText(sourceDevice.model_id),
				serialNumber: optionalText(sourceDevice.serial_number),
				availableStateId: deviceAvailabilityPath(record.deviceId),
				online: [],
				history: [],
				info: [],
			};
			if (!current) {
				devices.set(record.deviceId, device);
			} else {
				device.name =
					device.originalName === record.deviceId
						? (optionalText(sourceDevice.name) ?? device.originalName)
						: device.originalName;
				device.name = device.customName ?? device.originalName;
				device.icon ??= discoveryIcon;
				device.manufacturer ??= optionalText(sourceDevice.manufacturer);
				device.model ??= optionalText(sourceDevice.model) ?? optionalText(sourceDevice.model_id);
				device.serialNumber ??= optionalText(sourceDevice.serial_number);
				device.identifier ??= device.serialNumber ?? record.deviceId;
			}

			const infoValues: Record<string, unknown> = {
				...sourceDevice,
				origin: record.discovery.origin,
			};
			for (const key of DEVICE_INFO_KEYS) {
				if (infoValues[key] === undefined) {
					continue;
				}
				addEntity(device, 'info', {
					name: key,
					valueStateId: `${DEVICES_ROOT}.${record.deviceId}.info.${key}`,
				});
			}

			for (const entityRecord of record.entities) {
				const entity = record.discovery.entities.find(candidate => candidate.key === entityRecord.key);
				if (!entity) {
					continue;
				}
				const category = entityRecord.category ?? 'online';
				if (category === 'instanceInfo') {
					continue;
				}
				if (category === 'info' && isIconUrlInfo(entityRecord.entityId, entity.config.name)) {
					device.iconStateId = entityRecord.valueStateId;
				}
				const name =
					category === 'history'
						? `${historyMetricName(entity.config.name, entityRecord.historyPeriod)} (${historyPeriodName(
								entity.config.name,
								entityRecord.historyPeriod,
							)})`
						: asString(entity.config.name, entityRecord.entityId);
				addEntity(device, category, {
					name,
					valueStateId: entityRecord.valueStateId,
					...(category === 'history' && entityRecord.historyPeriod
						? { period: entityRecord.historyPeriod }
						: {}),
					...(typeof entity.config.unit_of_measurement === 'string'
						? { unit: entity.config.unit_of_measurement }
						: {}),
				});
			}
		}

		const result = [...devices.values()];
		await Promise.all(
			result.map(async device => {
				const object = await this.getObjectAsync(`${DEVICES_ROOT}.${device.id}`);
				const customName = optionalText(markerOf(object)?.displayName);
				device.customName = customName;
				device.name = customName ?? device.originalName;
			}),
		);
		const physicalDevices = new Map(result.map(device => [device.id, device]));
		for (const definition of this.comparisonDefinitions) {
			const online: DeviceManagerEntity[] = [];
			const history: DeviceManagerEntity[] = [];
			for (const [entryIndex, entry] of definition.entries.entries()) {
				const source = physicalDevices.get(entry.deviceId);
				const sourceEntity = source?.[entry.category].find(
					entity => entity.valueStateId === entry.valueStateId,
				);
				const sourceName = source?.name ?? entry.deviceName;
				const entity: DeviceManagerEntity = {
					name: `${sourceName} · ${sourceEntity?.name ?? entry.name}`,
					valueStateId: entry.valueStateId,
					displayStateId: comparisonDisplayStatePath(definition.id, entryIndex),
					...((sourceEntity?.unit ?? entry.unit) ? { unit: sourceEntity?.unit ?? entry.unit } : {}),
					...(entry.period ? { period: entry.period } : {}),
				};
				(entry.category === 'history' ? history : online).push(entity);
			}
			result.push({
				id: `comparison:${definition.id}`,
				originalName: definition.name,
				name: definition.name,
				kind: 'comparison',
				comparison: definition,
				identifier: `comparison:${definition.id}`,
				manufacturer: 'GridVis2MQTT',
				model: 'Comparison',
				availableStateId: '',
				online,
				history,
				info: [],
			});
		}
		await this.updateComparisonDisplayValues();
		return result.sort((left, right) => left.name.localeCompare(right.name, 'de', { sensitivity: 'base' }));
	}

	private async updateComparisonDisplayValues(): Promise<void> {
		if (!this.comparisonDefinitions.length) {
			return;
		}
		await this.upsertObject(
			COMPARISON_OBJECT_ROOT,
			{
				type: 'folder',
				common: { name: 'Comparisons' },
				native: objectMarker('comparison-root'),
			},
			'comparison',
		);
		for (const definition of this.comparisonDefinitions) {
			const comparisonPath = `${COMPARISON_OBJECT_ROOT}.${definition.id}`;
			await this.upsertObject(
				comparisonPath,
				{
					type: 'channel',
					common: { name: definition.name },
					native: objectMarker('comparison', undefined, definition.id),
				},
				'comparison',
			);
			for (const [entryIndex, entry] of definition.entries.entries()) {
				await this.upsertObject(
					comparisonDisplayStatePath(definition.id, entryIndex),
					{
						type: 'state',
						common: {
							name: entry.name,
							type: 'string',
							role: 'text',
							read: true,
							write: false,
							def: '',
						},
						native: objectMarker('comparison-value', undefined, definition.id),
					},
					'comparison',
				);
			}
			for (const [entryIndex, entry] of definition.entries.entries()) {
				const sourceState = await this.getStateAsync(entry.valueStateId);
				const comparableEntries = definition.entries.filter(
					candidate =>
						candidate.category === entry.category &&
						(entry.category === 'online' || candidate.period === entry.period),
				);
				const values = await Promise.all(
					comparableEntries.map(async candidate => {
						const value = await this.getStateAsync(candidate.valueStateId);
						return typeof value?.val === 'number'
							? value.val
							: typeof value?.val === 'string' && value.val.trim()
								? Number(value.val.trim())
								: Number.NaN;
					}),
				);
				const currentValue =
					typeof sourceState?.val === 'number'
						? sourceState.val
						: typeof sourceState?.val === 'string' && sourceState.val.trim()
							? Number(sourceState.val.trim())
							: Number.NaN;
				const total = values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
				const percentage = Number.isFinite(currentValue) && total !== 0 ? (currentValue / total) * 100 : 0;
				await this.setStateAsync(
					comparisonDisplayStatePath(definition.id, entryIndex),
					comparisonDisplayValue(sourceState?.val, entry.unit, percentage),
					true,
				);
			}
		}
	}

	public async getDeviceManagerComparisonOptions(): Promise<ComparisonOptionGroup[]> {
		const devices = (await this.getDeviceManagerDevices()).filter(device => device.kind !== 'comparison');
		return devices
			.map(device => ({
				label: device.name,
				items: [
					...device.online.map(entity => ({
						value: comparisonEntryKey(device.id, entity.valueStateId),
						label: `Online · ${entity.name}${entity.unit ? ` (${entity.unit})` : ''}`,
					})),
					...device.history.map(entity => ({
						value: comparisonEntryKey(device.id, entity.valueStateId),
						label: `History · ${entity.name}${entity.unit ? ` (${entity.unit})` : ''}`,
					})),
				],
			}))
			.filter(group => group.items.length > 0);
	}

	public async saveDeviceManagerComparison(id: string | undefined, name: string, entryKeys: string[]): Promise<void> {
		const normalizedName = name.trim();
		if (!normalizedName) {
			throw new Error('A comparison name is required');
		}
		const devices = (await this.getDeviceManagerDevices()).filter(device => device.kind !== 'comparison');
		const entities = new Map<
			string,
			{ device: DeviceManagerDevice; entity: DeviceManagerEntity; category: 'online' | 'history' }
		>();
		for (const device of devices) {
			for (const category of ['online', 'history'] as const) {
				for (const entity of device[category]) {
					entities.set(comparisonEntryKey(device.id, entity.valueStateId), { device, entity, category });
				}
			}
		}
		const entries: ComparisonEntry[] = [...new Set(entryKeys)].flatMap(key => {
			const parsed = parseComparisonEntryKey(key);
			const canonicalKey = parsed ? comparisonEntryKey(parsed.deviceId, parsed.valueStateId) : undefined;
			const selected = canonicalKey ? entities.get(canonicalKey) : undefined;
			if (!selected) {
				return [];
			}
			return [
				{
					key: canonicalKey as string,
					deviceId: selected.device.id,
					deviceName: selected.device.name,
					valueStateId: selected.entity.valueStateId,
					category: selected.category,
					name: selected.entity.name,
					...(selected.entity.unit ? { unit: selected.entity.unit } : {}),
					...(selected.entity.period ? { period: selected.entity.period } : {}),
				},
			];
		});
		if (!entries.length) {
			throw new Error('Select at least one value for the comparison');
		}
		const comparisonId = id ?? randomUUID();
		const definition: ComparisonDefinition = { id: comparisonId, name: normalizedName, entries };
		const index = this.comparisonDefinitions.findIndex(candidate => candidate.id === comparisonId);
		if (index >= 0) {
			this.comparisonDefinitions[index] = definition;
		} else {
			this.comparisonDefinitions.push(definition);
		}
		await this.saveComparisonDefinitions();
		this.scheduleDeviceManagerRefresh();
	}

	public async deleteDeviceManagerComparison(id: string): Promise<void> {
		const index = this.comparisonDefinitions.findIndex(candidate => candidate.id === id);
		if (index < 0) {
			throw new Error(`Cannot delete unknown comparison ${id}`);
		}
		this.comparisonDefinitions.splice(index, 1);
		await this.saveComparisonDefinitions();
		this.scheduleDeviceManagerRefresh();
	}

	public async setDeviceManagerName(deviceId: string, name: string): Promise<void> {
		const devicePath = `${DEVICES_ROOT}.${deviceId}`;
		const object = await this.getObjectAsync(devicePath);
		if (!object || !isOwned(object) || object.type !== 'device') {
			throw new Error(`Cannot rename unknown GridVis2MQTT device ${deviceId}`);
		}
		const device = (await this.getDeviceManagerDevices()).find(candidate => candidate.id === deviceId);
		if (!device) {
			throw new Error(`Cannot rename unknown GridVis2MQTT device ${deviceId}`);
		}
		const displayName = name.trim() || device.originalName;
		const marker = { ...(markerOf(object) ?? objectMarker('device', undefined, deviceId)) };
		if (name.trim()) {
			marker.displayName = name.trim();
		} else {
			delete marker.displayName;
		}
		const native: JsonRecord = {
			...(object.native && typeof object.native === 'object' && !Array.isArray(object.native)
				? (object.native as JsonRecord)
				: {}),
			[OWNER]: marker,
		};
		await this.setObjectAsync(devicePath, {
			type: 'device',
			common: { ...object.common, name: displayName },
			native,
		});
		this.scheduleDeviceManagerRefresh();
	}

	private async buildDiscoveryRecord(discovery: NormalizedDiscovery): Promise<DiscoveryRecord> {
		const deviceId = stableDeviceId(discovery);
		const usedPaths = new Set<string>();
		for (const record of this.discoveries.values()) {
			if (record.deviceId === deviceId && record.topic !== discovery.topic) {
				for (const entity of record.entities) {
					usedPaths.add(entityPathKey(entity));
				}
			}
		}
		const entities: DiscoveryEntityRecord[] = [];
		const objectIds: string[] = [];
		for (const entity of discovery.entities) {
			const objectPath = entityObjectPath(discovery, entity);
			if (isGridvisBridgeDiscovery(discovery) && !BRIDGE_INFO_ENTITY_IDS.has(objectPath.entityId)) {
				continue;
			}
			let entityId = objectPath.entityId;
			const category = objectPath.category;
			const historyPeriod = objectPath.historyPeriod;
			let pathKey = entityPathKey({ entityId, category, historyPeriod });
			if (usedPaths.has(pathKey)) {
				entityId = `${entityId}_${Buffer.from(`${discovery.topic}|${entity.key}`).toString('hex').slice(0, 8)}`;
				pathKey = entityPathKey({ entityId, category, historyPeriod });
			}
			usedPaths.add(pathKey);
			const discoveryEntity = { entityId, category, historyPeriod };
			const categoryPath = entityCategoryPath(deviceId, category);
			const entityPath = `${categoryPath}.${entityId}`;
			const base = entityBasePath(deviceId, discoveryEntity);
			const stateIds = isInfoCategory(category)
				? [...new Set(category === 'instanceInfo' ? [entityPath] : [categoryPath, entityPath])]
				: [
						...new Set([
							categoryPath,
							entityPath,
							...(category === 'history' ? [historyEntityAvailabilityPath(deviceId, entityId)] : []),
							base,
							`${base}.value`,
							`${base}.available`,
						]),
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
				valueStateId: isInfoCategory(category) ? base : `${base}.value`,
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
			discovery,
		};
	}

	private async installDiscovery(discovery: NormalizedDiscovery, record: DiscoveryRecord): Promise<void> {
		if (isGridvisBridgeDiscovery(discovery)) {
			await this.createBridgeInstanceInfo(discovery);
		} else {
			await this.createDeviceObjects(discovery, record.deviceId, discovery.topic);
		}
		for (const entityRecord of record.entities) {
			const entity = discovery.entities.find(candidate => candidate.key === entityRecord.key);
			if (!entity) {
				continue;
			}
			const base = entityBasePath(record.deviceId, entityRecord);
			await this.createEntityObjects(discovery, record.deviceId, entityRecord, entity);
			const runtimeKey = `${discovery.topic}|${entity.key}`;
			const runtime: EntityRuntime = {
				key: runtimeKey,
				discoveryTopic: discovery.topic,
				deviceId: record.deviceId,
				entityId: entityRecord.entityId,
				category: entityRecord.category,
				historyPeriod: entityRecord.historyPeriod,
				entity,
				valueStateId: isInfoCategory(entityRecord.category) ? base : `${base}.value`,
				...(isInfoCategory(entityRecord.category) ? {} : { availableStateId: `${base}.available` }),
			};
			this.runtimes.set(runtimeKey, runtime);
			this.stateActions.set(runtime.valueStateId, { runtimeKey, action: 'value' });
			await this.addTopicReference(entity.stateTopic, runtimeKey);
			if (!isInfoCategory(entityRecord.category)) {
				for (const availability of availabilityEntries(entity)) {
					await this.addTopicReference(asString(availability.availability_topic), runtimeKey);
				}
			}
		}
		for (const entityId of new Set(
			record.entities.filter(entity => entity.category === 'history').map(entity => entity.entityId),
		)) {
			await this.updateHistoryAvailability(record.deviceId, entityId);
		}
		await this.updateDeviceIconFromState(record.deviceId);
		await this.updateDeviceAvailability(record.deviceId);
	}

	private async createBridgeInstanceInfo(discovery: NormalizedDiscovery): Promise<void> {
		const device = discovery.device ?? discovery.entities[0]?.device ?? {};
		const value = device.sw_version ?? discovery.origin.sw_version;
		if (value === undefined) {
			return;
		}
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		const stateId = 'info.sw_version';
		await this.upsertObject(
			stateId,
			{
				type: 'state',
				common: { name: 'sw_version', type: 'string', role: 'text', read: true, write: false, def: text ?? '' },
				native: {
					...objectMarker('instance-info-state', discovery.topic),
					discoveryPayload: discovery.normalizedPayload,
				},
			},
			discovery.topic,
		);
		await this.setStateAsync(stateId, text ?? '', true);
	}

	private async createDeviceObjects(
		discovery: NormalizedDiscovery,
		deviceId: string,
		discoveryTopic: string,
	): Promise<void> {
		const device = discovery.device ?? discovery.entities[0]?.device ?? {};
		const name = asString(device.name, deviceId);
		const devicePath = `${DEVICES_ROOT}.${deviceId}`;
		const isBridge = isGridvisBridgeDiscovery(discovery);
		const existingDevice = await this.getObjectAsync(devicePath);
		const customName = optionalText(markerOf(existingDevice)?.displayName);
		const deviceNative = objectMarker('device', undefined, deviceId);
		if (customName) {
			deviceNative.displayName = customName;
		}
		const deviceObject: ioBroker.SettableObject = {
			type: 'device',
			common: {
				name: customName ?? name,
				...(isBridge
					? {}
					: { statusStates: { onlineId: `${this.namespace}.${deviceAvailabilityPath(deviceId)}` } }),
			},
			native: deviceNative,
		};
		if (isBridge && existingDevice && isOwned(existingDevice) && existingDevice.common?.statusStates) {
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
					type: 'state',
					common: {
						name: 'Device available',
						type: 'boolean',
						role: 'indicator.reachable',
						read: true,
						write: false,
						def: false,
						expert: true,
					},
					native: {
						...objectMarker('device-availability', discoveryTopic, deviceId),
						discoveryPayload: discovery.normalizedPayload,
					},
				},
				discoveryTopic,
			);
			await this.setStateAsync(deviceAvailabilityPath(deviceId), false, true);
		}
		await this.upsertObject(
			`${devicePath}.info`,
			{
				type: 'channel',
				common: { name: 'Information' },
				native: objectMarker('device-info', discoveryTopic, deviceId),
			},
			discoveryTopic,
		);
		const values: Record<string, unknown> = {
			name: device.name,
			manufacturer: device.manufacturer,
			model: device.model,
			serial_number: device.serial_number,
			sw_version: device.sw_version,
			hw_version: device.hw_version,
			connections: device.connections,
			origin: discovery.origin,
		};
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) {
				continue;
			}
			const text = typeof value === 'string' ? value : JSON.stringify(value);
			const entityPath = `${DEVICES_ROOT}.${deviceId}.info.${key}`;
			await this.upsertObject(
				entityPath,
				{
					type: 'state',
					common: { name: key, type: 'string', role: 'text', read: true, write: false, def: text ?? '' },
					native: {
						...objectMarker('device-info-state', discoveryTopic, deviceId),
						discoveryPayload: discovery.normalizedPayload,
					},
				},
				discoveryTopic,
			);
			await this.setStateAsync(entityPath, text ?? '', true);
		}
	}

	private async createEntityObjects(
		discovery: NormalizedDiscovery,
		deviceId: string,
		entityRecord: DiscoveryEntityRecord,
		entity: NormalizedEntity,
	): Promise<void> {
		const discoveryTopic = discovery.topic;
		const category = entityRecord.category ?? 'online';
		const categoryPath = entityCategoryPath(deviceId, category);
		const entityPath = `${categoryPath}.${entityRecord.entityId}`;
		const base = entityBasePath(deviceId, entityRecord);
		const hasAvailability = availabilityEntries(entity).length > 0;
		const displayName = historyMetricName(entity.config.name, entityRecord.historyPeriod);
		const isInfo = isInfoCategory(category);
		const isInstanceInfo = category === 'instanceInfo';
		const writable =
			!!entity.commandTopic &&
			(!entity.config.command_template || isSupportedCommandTemplate(entity.config.command_template));
		const common: ioBroker.StateCommon = {
			name: displayName || entityRecord.entityId,
			type: isInfo ? 'string' : stateTypeFor(entity),
			role: isInfo ? 'text' : roleFor(entity),
			read: true,
			write: writable,
		};
		if (typeof entity.config.unit_of_measurement === 'string') {
			common.unit = entity.config.unit_of_measurement;
		}
		if (typeof entity.config.min === 'number') {
			common.min = entity.config.min;
		}
		if (typeof entity.config.max === 'number') {
			common.max = entity.config.max;
		}
		if (typeof entity.config.step === 'number') {
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
						type: 'channel',
						common: { name: 'Information' },
						native: objectMarker('entity-category', discoveryTopic, deviceId),
					},
					discoveryTopic,
				);
			}
			await this.upsertObject(
				entityPath,
				{ type: 'state', common, native: this.stateNative(entity, discovery) },
				discoveryTopic,
			);
			return;
		}
		await this.upsertObject(
			categoryPath,
			{
				type: categoryObjectType(category),
				common: {
					name: category === 'history' ? 'History' : 'Online',
				},
				native: objectMarker('entity-category', discoveryTopic, deviceId),
			},
			discoveryTopic,
		);
		await this.upsertObject(
			entityPath,
			{
				type: entityObjectType(category),
				common: {
					name: common.name,
					...(category === 'online'
						? {
								statusStates: {
									onlineId: `${this.namespace}.${base}.available`,
								},
							}
						: category === 'history'
							? {
									statusStates: {
										onlineId: `${this.namespace}.${historyEntityAvailabilityPath(deviceId, entityRecord.entityId)}`,
									},
								}
							: {}),
				} as unknown as ioBroker.ChannelCommon,
				native: objectMarker('entity', discoveryTopic, deviceId),
			},
			discoveryTopic,
		);
		if (category === 'history') {
			await this.upsertObject(
				historyEntityAvailabilityPath(deviceId, entityRecord.entityId),
				{
					type: 'state',
					common: {
						name: 'Available',
						type: 'boolean',
						role: 'indicator.reachable',
						read: true,
						write: false,
					},
					native: {
						...objectMarker('history-availability', discoveryTopic, deviceId),
						discoveryPayload: discovery.normalizedPayload,
					},
				},
				discoveryTopic,
			);
		}
		if (category === 'history' && entityRecord.historyPeriod && base !== entityPath) {
			await this.upsertObject(
				base,
				{
					type: 'channel',
					common: {
						name: historyPeriodName(entity.config.name, entityRecord.historyPeriod),
						statusStates: {
							onlineId: `${this.namespace}.${base}.available`,
						},
					} as unknown as ioBroker.ChannelCommon,
					native: objectMarker('history-period', discoveryTopic, deviceId),
				},
				discoveryTopic,
			);
		}
		await this.upsertObject(
			`${base}.value`,
			{ type: 'state', common, native: this.stateNative(entity, discovery) },
			discoveryTopic,
		);
		await this.upsertObject(
			`${base}.available`,
			{
				type: 'state',
				common: {
					name: 'Available',
					type: 'boolean',
					role: 'indicator.reachable',
					read: true,
					write: false,
					def: !hasAvailability,
				},
				native: this.stateNative(entity, discovery),
			},
			discoveryTopic,
		);
		const currentAvailability = await this.getStateAsync(`${base}.available`);
		const initializeAvailability =
			this.discoverySyncActive ||
			!currentAvailability ||
			currentAvailability.val === null ||
			currentAvailability.val === undefined;
		if (initializeAvailability) {
			await this.setStateAsync(`${base}.available`, !hasAvailability, true);
		}
	}

	private stateNative(entity: NormalizedEntity, discovery: NormalizedDiscovery): JsonRecord {
		return {
			[OWNER]: objectMarker('state', discovery.topic),
			discoveryTopic: discovery.topic,
			discoveryPayload: discovery.normalizedPayload,
			uniqueId: entity.uniqueId,
			component: entity.component,
			stateTopic: entity.stateTopic,
			availabilityTopic: entity.availabilityTopic,
			jsonAttributesTopic: entity.jsonAttributesTopic,
			commandTopic: entity.commandTopic,
		};
	}

	private async upsertObject(id: string, object: ioBroker.SettableObject, _discoveryTopic: string): Promise<void> {
		const existing = await this.getObjectAsync(id);
		if (existing && !isOwned(existing) && id !== DEVICES_ROOT) {
			this.log.warn(`Cannot use ${id}: an object not created by this adapter already exists`);
			return;
		}
		if (existing && isOwned(existing)) {
			if (existing.type !== object.type) {
				const previousValue = object.type === 'state' ? await this.getStateAsync(`${id}.value`) : undefined;
				await this.delObjectAsync(id, { recursive: false });
				await this.setObjectAsync(id, object);
				if (previousValue && previousValue.val !== null && previousValue.val !== undefined) {
					await this.setStateAsync(id, previousValue.val, previousValue.ack ?? true);
				}
				return;
			}
			await this.extendObjectAsync(id, object);
			return;
		}
		await this.setObjectAsync(id, object);
	}

	private async processEntityMessage(runtime: EntityRuntime, topic: string, payload: string): Promise<void> {
		const entity = runtime.entity;
		const availabilityEntriesForEntity = availabilityEntries(entity);
		const availability = availabilityEntriesForEntity.find(entry => asString(entry.availability_topic) === topic);
		if (availability) {
			const value = availabilityValue(payload, availability);
			this.log.debug(
				`Received GridVis2MQTT availability ${topic}: ${JSON.stringify(payload)} -> ${
					value === undefined ? 'ignored' : String(value)
				} (${runtime.availableStateId})`,
			);
			if (value !== undefined && runtime.availableStateId) {
				await this.setStateAsync(runtime.availableStateId, value, true);
			}
		}
		if (entity.stateTopic === topic) {
			if (availabilityEntriesForEntity.length === 0 && runtime.availableStateId) {
				await this.setStateAsync(runtime.availableStateId, true, true);
			}
			const result = evaluateValueTemplate(entity.config.value_template, payload);
			if (result.supported && result.value !== undefined) {
				const value = coerceStateValue(result.value, entity);
				await this.setStateAsync(runtime.valueStateId, value, true);
				if (isIconUrlInfo(runtime.entityId, entity.config.name)) {
					await this.updateDeviceIcon(runtime.deviceId, value);
				}
				if (stateTypeFor(entity) === 'mixed') {
					if (typeof value === 'number') {
						await this.extendObjectAsync(runtime.valueStateId, {
							common: { type: 'number', role: 'value' },
						});
					} else if (typeof value === 'string') {
						await this.extendObjectAsync(runtime.valueStateId, {
							common: { type: 'string', role: 'text' },
						});
					}
				}
				await this.updateComparisonDisplayValues();
			} else if (!result.supported) {
				this.log.warn(`Unsupported value_template for ${runtime.key}: ${result.error}`);
			}
		}
		if ((runtime.category ?? 'online') === 'history') {
			await this.updateHistoryAvailability(runtime.deviceId, runtime.entityId);
		}
		await this.updateDeviceAvailability(runtime.deviceId);
	}

	private async updateHistoryAvailability(deviceId: string, entityId: string): Promise<void> {
		const aggregateStateId = historyEntityAvailabilityPath(deviceId, entityId);
		if (!isOwned(await this.getObjectAsync(aggregateStateId))) {
			return;
		}
		const availableStateIds = [
			...new Set(
				[...this.runtimes.values()]
					.filter(
						runtime =>
							runtime.deviceId === deviceId &&
							(runtime.category ?? 'online') === 'history' &&
							runtime.entityId === entityId,
					)
					.map(runtime => runtime.availableStateId)
					.filter((stateId): stateId is string => typeof stateId === 'string'),
			),
		];
		let available = false;
		for (const stateId of availableStateIds) {
			const state = await this.getStateAsync(stateId);
			if (state?.val === true) {
				available = true;
				break;
			}
		}
		await this.setStateAsync(aggregateStateId, available, true);
	}

	private async updateDeviceIconFromState(deviceId: string): Promise<void> {
		const iconRuntime = [...this.runtimes.values()].find(
			runtime =>
				runtime.deviceId === deviceId &&
				runtime.category === 'info' &&
				isIconUrlInfo(runtime.entityId, runtime.entity.config.name),
		);
		const state = iconRuntime ? await this.getStateAsync(iconRuntime.valueStateId) : undefined;
		await this.updateDeviceIcon(deviceId, state?.val);
	}

	private async updateDeviceIcon(deviceId: string, value: ioBroker.StateValue | undefined): Promise<void> {
		const devicePath = `${DEVICES_ROOT}.${deviceId}`;
		const object = await this.getObjectAsync(devicePath);
		if (!object || !isOwned(object) || object.type !== 'device') {
			return;
		}
		const icon = await this.resolveDeviceIcon(iconUrlValue(value));
		const currentCommon = object.common as ioBroker.DeviceCommon;
		const currentIcon = typeof currentCommon.icon === 'string' ? currentCommon.icon : undefined;
		if (currentIcon === icon) {
			return;
		}
		const common: ioBroker.DeviceCommon = { ...currentCommon };
		if (icon) {
			common.icon = icon;
		} else {
			delete common.icon;
		}
		await this.setObjectAsync(devicePath, {
			type: 'device',
			common,
			native: object.native ?? {},
		});
	}

	private async resolveDeviceIcon(iconUrl: string | undefined): Promise<string | undefined> {
		if (!iconUrl || iconUrl.startsWith('data:image/')) {
			return iconUrl;
		}
		if (!/^https?:\/\//i.test(iconUrl)) {
			return iconUrl;
		}
		try {
			const response = await fetch(iconUrl, { signal: AbortSignal.timeout(DEVICE_ICON_FETCH_TIMEOUT_MS) });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const contentLength = Number(response.headers.get('content-length'));
			if (Number.isFinite(contentLength) && contentLength > DEVICE_ICON_MAX_BYTES) {
				throw new Error(`image exceeds ${DEVICE_ICON_MAX_BYTES} bytes`);
			}
			const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
			if (!contentType?.startsWith('image/')) {
				throw new Error(`unexpected content type ${contentType ?? 'unknown'}`);
			}
			const data = Buffer.from(await response.arrayBuffer());
			if (data.length > DEVICE_ICON_MAX_BYTES) {
				throw new Error(`image exceeds ${DEVICE_ICON_MAX_BYTES} bytes`);
			}
			return `data:${contentType};base64,${data.toString('base64')}`;
		} catch (error) {
			this.log.debug(`Could not load GridVis device icon ${iconUrl}: ${String(error)}`);
			return undefined;
		}
	}

	private async updateDeviceAvailability(deviceId: string): Promise<void> {
		if (!isOwned(await this.getObjectAsync(deviceAvailabilityPath(deviceId)))) {
			return;
		}
		const availableStateIds = [
			...new Set(
				[...this.runtimes.values()]
					.filter(
						runtime =>
							runtime.deviceId === deviceId &&
							['online', 'history'].includes(runtime.category ?? 'online'),
					)
					.map(runtime => runtime.availableStateId)
					.filter((stateId): stateId is string => typeof stateId === 'string'),
			),
		];
		let online = false;
		for (const stateId of availableStateIds) {
			const state = await this.getStateAsync(stateId);
			if (state?.val === true) {
				online = true;
				break;
			}
		}
		await this.setStateAsync(deviceAvailabilityPath(deviceId), online, true);
		await this.updateDevicePresentation(deviceId, online);
	}

	private async updateDevicePresentation(deviceId: string, online: boolean): Promise<void> {
		const devicePath = `${DEVICES_ROOT}.${deviceId}`;
		const object = await this.getObjectAsync(devicePath);
		if (!object || !isOwned(object) || object.type !== 'device') {
			return;
		}
		const currentCommon = object.common as ioBroker.DeviceCommon;
		const icon = iconUrlValue(currentCommon.icon);
		const statusId = `${this.namespace}.${deviceAvailabilityPath(deviceId)}`;
		const currentStatus = currentCommon.statusStates;
		const hasOwnStatus =
			currentStatus?.onlineId === statusId && Object.keys(currentStatus).every(key => key === 'onlineId');
		const shouldShowStatus = !icon || !online;
		if (shouldShowStatus === !!currentStatus && (!shouldShowStatus || hasOwnStatus)) {
			return;
		}
		const common: ioBroker.DeviceCommon = { ...currentCommon };
		if (shouldShowStatus) {
			common.statusStates = { onlineId: statusId };
		} else if (hasOwnStatus) {
			delete common.statusStates;
		}
		await this.setObjectAsync(devicePath, {
			type: 'device',
			common,
			native: object.native ?? {},
		});
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
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
		if (
			runtime.entity.config.command_template &&
			!isSupportedCommandTemplate(runtime.entity.config.command_template)
		) {
			this.log.warn(`Ignoring command_template for ${action.runtimeKey}: unsupported template`);
			return;
		}
		let value: ioBroker.StateValue = state.val;
		if (action.action === 'press') {
			value = (runtime.entity.config.payload_press as ioBroker.StateValue | undefined) ?? true;
		}
		if (
			runtime.entity.component === 'select' &&
			Array.isArray(runtime.entity.config.options) &&
			!runtime.entity.config.options.includes(value)
		) {
			this.log.warn(`Ignoring value not present in options for ${action.runtimeKey}`);
			return;
		}
		if (typeof value === 'boolean') {
			if (value && runtime.entity.config.payload_on !== undefined) {
				value = runtime.entity.config.payload_on as ioBroker.StateValue;
			}
			if (!value && runtime.entity.config.payload_off !== undefined) {
				value = runtime.entity.config.payload_off as ioBroker.StateValue;
			}
		}
		const rendered = runtime.entity.config.command_template
			? renderCommandTemplate(runtime.entity.config.command_template, value)
			: String(value ?? '');
		if (rendered === null) {
			this.log.warn(`Could not safely render command_template for ${action.runtimeKey}`);
			return;
		}
		await new Promise<void>((resolve, reject) => {
			this.mqttClient?.publish(runtime.entity.commandTopic as string, rendered, { qos: this.mqttQos() }, error =>
				error ? reject(error) : resolve(),
			);
		}).catch(error => this.reportError(`Could not publish command for ${action.runtimeKey}`, error));
	}

	private async removeDiscovery(
		topic: string,
		preservedObjectIds = new Set<string>(),
		logRemoval = true,
	): Promise<void> {
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
					for (const availability of availabilityEntries(runtime.entity)) {
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
			record.entities.filter(entity => entity.category === 'history').map(entity => entity.entityId),
		)) {
			await this.updateHistoryAvailability(record.deviceId, entityId);
		}
		if (
			isGridvisBridgeDiscovery(record.discovery) &&
			![...this.discoveries.values()].some(candidate => isGridvisBridgeDiscovery(candidate.discovery))
		) {
			const bridgeSoftwareVersion = await this.getObjectAsync('info.sw_version');
			if (bridgeSoftwareVersion && isOwned(bridgeSoftwareVersion)) {
				await this.delObjectAsync('info.sw_version');
			}
		}
		await this.updateDeviceAvailability(record.deviceId);
		const hasDeviceReference = [...this.discoveries.values()].some(
			candidate => candidate.deviceId === record.deviceId,
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

	private isObjectReferencedByOtherDiscovery(objectId: string, topic: string): boolean {
		return [...this.discoveries.values()].some(record => {
			if (record.topic === topic) {
				return false;
			}
			return (
				record.objectIds?.includes(objectId) ||
				record.deviceObjectIds?.includes(objectId) ||
				record.entities.some(entity => entity.objectIds.includes(objectId))
			);
		});
	}

	private async deleteManagedObject(id: string, discoveryTopic: string): Promise<void> {
		const object = await this.getObjectAsync(id);
		if (!object) {
			return;
		}
		void discoveryTopic;
		await this.delObjectAsync(id);
	}

	private reportError(message: string, error: unknown): void {
		const text = error instanceof Error ? error.message : String(error);
		this.log.error(`${message}: ${text}`);
		void this.setStateAsync('info.lastError', text, true);
	}

	private async closeMqtt(): Promise<void> {
		const client = this.mqttClient;
		this.mqttClient = undefined;
		this.mqttConnected = false;
		if (!client) {
			return;
		}
		await new Promise<void>(resolve => client.end(true, () => resolve()));
		client.removeAllListeners();
	}

	private onUnload(callback: () => void): void {
		this.shuttingDown = true;
		this.cancelDiscoverySync();
		if (this.deviceManagerRefreshTimer) {
			clearTimeout(this.deviceManagerRefreshTimer);
			this.deviceManagerRefreshTimer = undefined;
		}
		void this.closeMqtt()
			.then(() => callback())
			.catch(error => {
				this.reportError('Error while closing MQTT', error);
				callback();
			});
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Gridvis2mqtt(options);
} else {
	(() => new Gridvis2mqtt())();
}
