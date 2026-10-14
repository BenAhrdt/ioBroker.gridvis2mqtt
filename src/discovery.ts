import { createHash } from 'crypto';
import type { DiscoveryTopicInfo, EntityObjectPath, JsonRecord, NormalizedDiscovery, NormalizedEntity } from './types';

const KEY_ALIASES: Record<string, string> = {
	dev: 'device',
	ids: 'identifiers',
	mf: 'manufacturer',
	mdl: 'model',
	sw: 'sw_version',
	sn: 'serial_number',
	hw: 'hw_version',
	o: 'origin',
	cmps: 'components',
	p: 'platform',
	stat_t: 'state_topic',
	val_tpl: 'value_template',
	avty_t: 'availability_topic',
	pl_avail: 'payload_available',
	pl_not_avail: 'payload_not_available',
	cmd_t: 'command_topic',
	cmd_tpl: 'command_template',
	uniq_id: 'unique_id',
	dev_cla: 'device_class',
	unit_of_meas: 'unit_of_measurement',
	stat_cla: 'state_class',
	sug_dsp_prc: 'suggested_display_precision',
	json_attr_t: 'json_attributes_topic',
	json_attr_tpl: 'json_attributes_template',
};

/**
 *
 */
export function normalizeDiscoveryPrefix(value: unknown): string {
	const raw = typeof value === 'string' && value.trim() ? value.trim() : 'homeassistant';
	return raw.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/#$/, '');
}

/**
 *
 */
export function discoverySubscription(prefix: string): string {
	return `${normalizeDiscoveryPrefix(prefix)}/#`;
}

/**
 *
 */
export function parseDiscoveryTopic(topic: string, prefix: string): DiscoveryTopicInfo | null {
	const normalizedPrefix = normalizeDiscoveryPrefix(prefix);
	if (!topic.startsWith(`${normalizedPrefix}/`)) {
		return null;
	}

	const segments = topic.slice(normalizedPrefix.length + 1).split('/');
	if (segments.length < 3 || segments.length > 4 || segments.at(-1) !== 'config') {
		return null;
	}

	const component = segments[0];
	const objectId = segments.at(-2);
	if (!component || !objectId || !/^[a-zA-Z0-9_-]+$/.test(component) || !/^[a-zA-Z0-9_-]+$/.test(objectId)) {
		return null;
	}

	if (segments.length === 3) {
		return { prefix: normalizedPrefix, component, objectId, deviceDiscovery: component === 'device' };
	}

	const nodeId = segments[1];
	if (!nodeId || !/^[a-zA-Z0-9_-]+$/.test(nodeId)) {
		return null;
	}
	return { prefix: normalizedPrefix, component, nodeId, objectId, deviceDiscovery: false };
}

function normalizeObject(input: unknown): JsonRecord {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return {};
	}
	const source = input as JsonRecord;
	const result: JsonRecord = {};
	for (const [key, value] of Object.entries(source)) {
		const normalizedKey = KEY_ALIASES[key] ?? key;
		if (result[normalizedKey] !== undefined && key !== normalizedKey) {
			continue;
		}
		if (normalizedKey === 'device' || normalizedKey === 'origin') {
			result[normalizedKey] = normalizeObject(value);
		} else if (normalizedKey === 'components' && value && typeof value === 'object' && !Array.isArray(value)) {
			const components: JsonRecord = {};
			for (const [componentKey, componentValue] of Object.entries(value as JsonRecord)) {
				components[componentKey] = normalizeObject(componentValue);
			}
			result.components = components;
		} else if (normalizedKey === 'availability' && Array.isArray(value)) {
			result.availability = value.map(entry => {
				const normalized = normalizeObject(entry);
				if (normalized.availability_topic === undefined && typeof normalized.topic === 'string') {
					normalized.availability_topic = normalized.topic;
				}
				return normalized;
			});
		} else {
			result[normalizedKey] = value;
		}
	}
	if (typeof source['~'] === 'string' && result.base_topic === undefined) {
		result.base_topic = source['~'];
	}
	return result;
}

/**
 *
 */
export function parseJsonPayload(payload: string | Buffer): JsonRecord | null {
	const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
	if (!text.trim()) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? normalizeObject(parsed) : null;
	} catch {
		return null;
	}
}

function resolveTopic(topic: unknown, baseTopic: string | undefined): string | undefined {
	if (typeof topic !== 'string' || !topic.trim()) {
		return undefined;
	}
	const value = topic.trim();
	if (value === '~') {
		return baseTopic;
	}
	if (value.startsWith('~/')) {
		return baseTopic ? `${baseTopic}/${value.slice(2)}` : value;
	}
	return value;
}

function entityFromConfig(key: string, component: string, config: JsonRecord): NormalizedEntity {
	const baseTopic = typeof config.base_topic === 'string' ? config.base_topic : undefined;
	const stateTopic = resolveTopic(config.state_topic, baseTopic);
	const availabilityTopic = resolveTopic(config.availability_topic, baseTopic);
	const jsonAttributesTopic = resolveTopic(config.json_attributes_topic, baseTopic);
	const commandTopic = resolveTopic(config.command_topic, baseTopic);
	const availability = Array.isArray(config.availability)
		? config.availability.map(entry => {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
					return entry;
				}
				const normalized = { ...(entry as JsonRecord) };
				const topic = normalized.availability_topic ?? normalized.topic;
				normalized.availability_topic = resolveTopic(topic, baseTopic);
				return normalized;
			})
		: config.availability && typeof config.availability === 'object'
			? [
					{
						...(config.availability as JsonRecord),
						availability_topic: resolveTopic(
							(config.availability as JsonRecord).availability_topic ??
								(config.availability as JsonRecord).topic,
							baseTopic,
						),
					},
				]
			: config.availability;
	return {
		key,
		component,
		config: {
			...config,
			state_topic: stateTopic,
			availability_topic: availabilityTopic,
			json_attributes_topic: jsonAttributesTopic,
			command_topic: commandTopic,
			availability,
		},
		uniqueId: typeof config.unique_id === 'string' ? config.unique_id : undefined,
		stateTopic,
		availabilityTopic,
		jsonAttributesTopic,
		commandTopic,
		device: config.device as JsonRecord | undefined,
		origin: config.origin as JsonRecord | undefined,
	};
}

/**
 *
 */
export function normalizeDiscovery(
	topic: string,
	prefix: string,
	payload: string | Buffer,
): NormalizedDiscovery | null {
	const topicInfo = parseDiscoveryTopic(topic, prefix);
	if (!topicInfo) {
		return null;
	}
	const normalizedPayload = parseJsonPayload(payload);
	if (!normalizedPayload) {
		return null;
	}

	const origin = normalizedPayload.origin;
	if (!origin || typeof origin !== 'object' || (origin as JsonRecord).name !== 'GridVis2MQTT') {
		return null;
	}
	const baseTopic = typeof normalizedPayload.base_topic === 'string' ? normalizedPayload.base_topic : undefined;

	if (topicInfo.deviceDiscovery) {
		const componentMap = normalizedPayload.components;
		if (!componentMap || typeof componentMap !== 'object' || Array.isArray(componentMap)) {
			return null;
		}
		const entities: NormalizedEntity[] = [];
		for (const [key, value] of Object.entries(componentMap as JsonRecord)) {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				continue;
			}
			const componentConfig = value as JsonRecord;
			const component = typeof componentConfig.platform === 'string' ? componentConfig.platform : '';
			if (!component) {
				continue;
			}
			const inherited: JsonRecord = { ...normalizedPayload, ...componentConfig };
			delete inherited.components;
			delete inherited.platform;
			const entity = entityFromConfig(key, component, inherited);
			entity.config = { ...inherited, ...entity.config };
			entity.device =
				(inherited.device as JsonRecord | undefined) ?? (normalizedPayload.device as JsonRecord | undefined);
			entity.origin = origin as JsonRecord;
			entities.push(entity);
		}
		return {
			topic,
			prefix: topicInfo.prefix,
			component: topicInfo.component,
			objectId: topicInfo.objectId,
			deviceDiscovery: true,
			device: normalizedPayload.device as JsonRecord | undefined,
			origin: origin as JsonRecord,
			baseTopic,
			entities,
			normalizedPayload,
		};
	}

	const component = topicInfo.component;
	const entity = entityFromConfig(topicInfo.objectId, component, normalizedPayload);
	entity.origin = origin as JsonRecord;
	return {
		topic,
		prefix: topicInfo.prefix,
		component,
		nodeId: topicInfo.nodeId,
		objectId: topicInfo.objectId,
		deviceDiscovery: false,
		device: normalizedPayload.device as JsonRecord | undefined,
		origin: origin as JsonRecord,
		baseTopic,
		entities: [entity],
		normalizedPayload,
	};
}

/**
 *
 */
export function normalizeIdentifier(value: unknown): string {
	const normalized = String(value ?? '')
		.trim()
		.replace(/[^a-zA-Z0-9_-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[_-]+|[_-]+$/g, '');
	return normalized || 'item';
}

const GRIDVIS_IDENTIFIER_PREFIX = /^gridvis2mqtt_/i;

function removeGridvisIdentifierPrefix(value: string): string {
	return value.replace(GRIDVIS_IDENTIFIER_PREFIX, '');
}

function startsWithIgnoreCase(value: string, prefix: string): boolean {
	return value.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

function deviceIdentifierVariants(discovery: NormalizedDiscovery): string[] {
	const identifiers = discovery.device?.identifiers;
	const values = Array.isArray(identifiers) ? [...identifiers] : identifiers !== undefined ? [identifiers] : [];
	if (discovery.nodeId) {
		values.push(discovery.nodeId);
	}
	return values
		.flatMap(value => {
			const text = String(value).trim();
			return text ? [text, removeGridvisIdentifierPrefix(text)] : [];
		})
		.sort((left, right) => right.length - left.length);
}

function removeGridvisEntityDevicePrefix(discovery: NormalizedDiscovery, value: string): string {
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

function hasGridvisBridgeIdentity(discovery: NormalizedDiscovery): boolean {
	const device = discovery.device ?? discovery.entities[0]?.device ?? {};
	const identifiers = Array.isArray(device.identifiers)
		? device.identifiers
		: device.identifiers === undefined
			? []
			: [device.identifiers];
	return (
		discovery.nodeId?.toLowerCase() === 'gridvis2mqtt' ||
		String(device.model_id ?? '').toLowerCase() === 'gridvis2mqtt' ||
		identifiers.some(identifier => String(identifier).toLowerCase() === 'gridvis2mqtt_bridge')
	);
}

function shortHash(value: string): string {
	return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

/**
 *
 */
export function stableDeviceId(discovery: NormalizedDiscovery): string {
	if (hasGridvisBridgeIdentity(discovery)) {
		return 'gridvis2mqtt';
	}
	if (discovery.nodeId) {
		return normalizeIdentifier(removeGridvisIdentifierPrefix(discovery.nodeId));
	}
	const device = discovery.device;
	const identifiers = device?.identifiers;
	const values = Array.isArray(identifiers) ? identifiers : identifiers !== undefined ? [identifiers] : [];
	if (values.length) {
		return normalizeIdentifier(
			values
				.map(value => removeGridvisIdentifierPrefix(String(value)))
				.sort()
				.join('_'),
		);
	}
	return `${normalizeIdentifier(removeGridvisIdentifierPrefix(discovery.nodeId ?? discovery.objectId))}_${shortHash(`${discovery.prefix}|${discovery.nodeId ?? ''}|${discovery.objectId}`)}`;
}

/**
 * The GridVis2MQTT bridge is informational only. Its entities are exposed
 * directly below the adapter instance's info channel instead of as a device.
 */
export function isGridvisBridgeDiscovery(discovery: NormalizedDiscovery): boolean {
	return hasGridvisBridgeIdentity(discovery);
}

/**
 *
 */
export function entityObjectPath(discovery: NormalizedDiscovery, entity: NormalizedEntity): EntityObjectPath {
	const source = discovery.deviceDiscovery ? entity.key : discovery.objectId;
	const identifier = removeGridvisEntityDevicePrefix(discovery, String(source));
	if (isGridvisBridgeDiscovery(discovery)) {
		const infoIdentifier = identifier
			.replace(/^gridvis2mqtt_bridge_/i, '')
			.replace(/^bridge_/i, '')
			.replace(/_homeassistant$/i, '');
		return { entityId: normalizeIdentifier(infoIdentifier), category: 'instanceInfo' };
	}
	if (/^device_info_/i.test(identifier)) {
		const infoIdentifier = identifier.replace(/^device_info_/i, '').replace(/_homeassistant$/i, '');
		return { entityId: normalizeIdentifier(infoIdentifier), category: 'info' };
	}
	const historyMatch = identifier.match(/^(.+)_history_(.+)$/i);
	if (historyMatch?.[1] && historyMatch[2]) {
		return {
			entityId: normalizeIdentifier(historyMatch[1]),
			category: 'history',
			historyPeriod: normalizeIdentifier(historyMatch[2]),
		};
	}
	return { entityId: normalizeIdentifier(identifier), category: 'online' };
}

/**
 *
 */
export function stableEntityId(discovery: NormalizedDiscovery, entity: NormalizedEntity): string {
	return entityObjectPath(discovery, entity).entityId;
}

/**
 *
 */
export function availabilityEntries(entity: NormalizedEntity): JsonRecord[] {
	const entries = entity.config.availability;
	if (Array.isArray(entries)) {
		const validEntries = entries.filter(
			(entry): entry is JsonRecord =>
				!!entry &&
				typeof entry === 'object' &&
				!Array.isArray(entry) &&
				typeof entry.availability_topic === 'string' &&
				entry.availability_topic.trim().length > 0,
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
				payload_not_available: entity.config.payload_not_available,
			},
		];
	}
	return [];
}
