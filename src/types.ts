export type JsonRecord = Record<string, unknown>;

export interface DiscoveryTopicInfo {
	prefix: string;
	component: string;
	nodeId?: string;
	objectId: string;
	deviceDiscovery: boolean;
}

export interface NormalizedEntity {
	key: string;
	component: string;
	config: JsonRecord;
	uniqueId?: string;
	stateTopic?: string;
	availabilityTopic?: string;
	jsonAttributesTopic?: string;
	commandTopic?: string;
	device?: JsonRecord;
	origin?: JsonRecord;
}

export interface NormalizedDiscovery {
	topic: string;
	prefix: string;
	component: string;
	nodeId?: string;
	objectId: string;
	deviceDiscovery: boolean;
	device?: JsonRecord;
	origin: JsonRecord;
	baseTopic?: string;
	entities: NormalizedEntity[];
	normalizedPayload: JsonRecord;
}

export type EntityCategory = 'online' | 'history' | 'info' | 'instanceInfo';

export interface EntityObjectPath {
	entityId: string;
	category: EntityCategory;
	historyPeriod?: string;
}

export interface DiscoveryEntityRecord {
	key: string;
	entityId: string;
	category?: EntityCategory;
	historyPeriod?: string;
	component: string;
	uniqueId?: string;
	stateTopic?: string;
	availabilityTopic?: string;
	jsonAttributesTopic?: string;
	commandTopic?: string;
	objectIds: string[];
	valueStateId: string;
	pressStateId?: string;
}

export interface DiscoveryRecord {
	topic: string;
	deviceId: string;
	entities: DiscoveryEntityRecord[];
	objectIds: string[];
	deviceObjectIds: string[];
	discovery: NormalizedDiscovery;
}

export interface AdapterConfig {
	enabled?: boolean;
	brokerUrl?: string;
	host?: string;
	port?: number | string;
	protocol?: string;
	username?: string;
	password?: string;
	clientId?: string;
	keepalive?: number | string;
	qos?: number | string;
	discoveryPrefix?: string;
	rejectUnauthorized?: boolean;
	ca?: string;
	cert?: string;
	key?: string;
}

export type ComparisonValueCategory = 'online' | 'history';

export interface ComparisonEntry {
	key: string;
	deviceId: string;
	deviceName: string;
	valueStateId: string;
	category: ComparisonValueCategory;
	name: string;
	unit?: string;
	period?: string;
}

export interface ComparisonDefinition {
	id: string;
	name: string;
	entries: ComparisonEntry[];
}

export interface ComparisonOption {
	value: string;
	label: string;
}

export interface ComparisonOptionGroup {
	label: string;
	items: ComparisonOption[];
}

export interface TopicSubscription {
	topic: string;
	kind: 'state' | 'availability' | 'attributes';
	entityKey: string;
}

export interface EntityRuntime {
	key: string;
	discoveryTopic: string;
	deviceId: string;
	entityId: string;
	category?: EntityCategory;
	historyPeriod?: string;
	entity: NormalizedEntity;
	valueStateId: string;
	availableStateId?: string;
}
