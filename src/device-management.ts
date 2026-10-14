import type { AdapterInstance } from '@iobroker/adapter-core';
import {
	DeviceManagement,
	type ActionContext,
	type ConfigItemAny,
	type ConfigItemPanel,
	type DeviceDetails,
	type DeviceInfo,
	type DeviceLoadContext,
	type InstanceDetails,
	type JsonFormSchema,
} from '@iobroker/dm-utils';
import type { ComparisonDefinition, ComparisonOptionGroup } from './types';

export interface DeviceManagerEntity {
	name: string;
	valueStateId: string;
	displayStateId?: string;
	unit?: string;
	period?: string;
}

export interface DeviceManagerDevice {
	id: string;
	originalName: string;
	name: string;
	kind?: 'device' | 'comparison';
	comparison?: ComparisonDefinition;
	customName?: string;
	identifier?: string;
	icon?: string;
	iconStateId?: string;
	manufacturer?: string;
	model?: string;
	serialNumber?: string;
	availableStateId: string;
	online: DeviceManagerEntity[];
	history: DeviceManagerEntity[];
	info: DeviceManagerEntity[];
}

export interface Gridvis2mqttDeviceManagerAdapter extends AdapterInstance {
	getDeviceManagerDevices(): Promise<DeviceManagerDevice[]>;
	getDeviceManagerComparisonOptions(): Promise<ComparisonOptionGroup[]>;
	saveDeviceManagerComparison(id: string | undefined, name: string, entryKeys: string[]): Promise<void>;
	deleteDeviceManagerComparison(id: string): Promise<void>;
	setDeviceManagerName(deviceId: string, name: string): Promise<void>;
}

function stateItem(
	entity: DeviceManagerEntity,
	label = entity.name,
	hidden?: string,
	stateId = entity.valueStateId,
): ConfigItemAny {
	return {
		type: 'state',
		oid: stateId,
		control: 'text',
		label,
		digits: 2,
		...(stateId === entity.valueStateId && entity.unit ? { unit: entity.unit } : {}),
		...(hidden ? { hidden } : {}),
	};
}

function stateItems(
	entities: DeviceManagerEntity[],
	options: {
		keyPrefix?: string;
		label?: (entity: DeviceManagerEntity) => string;
		hidden?: string;
		stateId?: (entity: DeviceManagerEntity) => string;
	} = {},
): Record<string, ConfigItemAny> {
	const keyPrefix = options.keyPrefix ?? 'state';
	return Object.fromEntries(
		entities.map((entity, index) => [
			`${keyPrefix}_${index}_${entity.valueStateId}`,
			stateItem(
				entity,
				options.label?.(entity) ?? entity.name,
				options.hidden,
				options.stateId?.(entity) ?? entity.valueStateId,
			),
		]),
	);
}

const HISTORY_PERIOD_ORDER: Record<string, number> = {
	today: 0,
	yesterday: 1,
	thisweek: 2,
	lastweek: 3,
	thismonth: 4,
	lastmonth: 5,
	thisyear: 6,
	lastyear: 7,
	last3months: 8,
};

function compareHistoryEntities(left: DeviceManagerEntity, right: DeviceManagerEntity): number {
	const leftMetric = left.name.replace(/\s+\([^)]*\)$/, '');
	const rightMetric = right.name.replace(/\s+\([^)]*\)$/, '');
	const metricOrder = leftMetric.localeCompare(rightMetric, 'de', { sensitivity: 'base' });
	if (metricOrder !== 0) {
		return metricOrder;
	}
	const periodOrder =
		(HISTORY_PERIOD_ORDER[left.period?.toLowerCase() ?? ''] ?? 999) -
		(HISTORY_PERIOD_ORDER[right.period?.toLowerCase() ?? ''] ?? 999);
	return periodOrder || left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
}

function compareHistoryChronologically(left: DeviceManagerEntity, right: DeviceManagerEntity): number {
	const periodOrder =
		(HISTORY_PERIOD_ORDER[left.period?.toLowerCase() ?? ''] ?? 999) -
		(HISTORY_PERIOD_ORDER[right.period?.toLowerCase() ?? ''] ?? 999);
	if (periodOrder !== 0) {
		return periodOrder;
	}
	return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
}

function historyMetricName(entity: DeviceManagerEntity): string {
	return entity.name.replace(/\s+\([^)]*\)$/, '');
}

function historyPeriodLabel(entity: DeviceManagerEntity): string {
	const match = entity.name.match(/\(([^()]*)\)$/);
	return match?.[1] ?? entity.period ?? entity.name;
}

function historyGroups(history: DeviceManagerEntity[]): Array<{ name: string; entities: DeviceManagerEntity[] }> {
	const groups = new Map<string, DeviceManagerEntity[]>();
	for (const entity of history) {
		const name = historyMetricName(entity);
		const entities = groups.get(name) ?? [];
		entities.push(entity);
		groups.set(name, entities);
	}
	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right, 'de', { sensitivity: 'base' }))
		.map(([name, entities]) => ({ name, entities: entities.sort(compareHistoryEntities) }));
}

function historyPeriodGroups(history: DeviceManagerEntity[]): Array<{ name: string; entities: DeviceManagerEntity[] }> {
	const groups = new Map<string, DeviceManagerEntity[]>();
	for (const entity of history) {
		const key = entity.period?.toLowerCase() ?? historyPeriodLabel(entity).toLowerCase();
		const entities = groups.get(key) ?? [];
		entities.push(entity);
		groups.set(key, entities);
	}
	return [...groups.entries()]
		.sort(([left], [right]) => {
			const periodOrder = (HISTORY_PERIOD_ORDER[left] ?? 999) - (HISTORY_PERIOD_ORDER[right] ?? 999);
			return periodOrder || left.localeCompare(right, 'de', { sensitivity: 'base' });
		})
		.map(([, entities]) => ({
			name: historyPeriodLabel(entities[0]),
			entities: entities.sort((left, right) =>
				historyMetricName(left).localeCompare(historyMetricName(right), 'de', { sensitivity: 'base' }),
			),
		}));
}

function fixedPanelStyle(height: number): Record<string, unknown> {
	return {
		height,
		minHeight: height,
		boxSizing: 'border-box',
		alignContent: 'flex-start',
		justifyContent: 'flex-start',
	};
}

function panel(
	label: string,
	entities: DeviceManagerEntity[],
	height: number,
	stateId?: (entity: DeviceManagerEntity) => string,
): ConfigItemPanel {
	return {
		type: 'panel',
		label,
		innerStyle: fixedPanelStyle(height),
		items: stateItems(entities, { stateId }),
	};
}

function detailsSchema(device: DeviceManagerDevice): JsonFormSchema {
	const items: Record<string, ConfigItemPanel> = {};
	const history = [...device.history].sort(compareHistoryEntities);
	const groups = historyGroups(history);
	const periodGroups = historyPeriodGroups(history);
	const historyItemCount = history.length + Math.max(groups.length, periodGroups.length) + 1;
	const maxItemCount = Math.max(device.online.length, historyItemCount, device.info.length, 1);
	const panelHeight = Math.max(220, maxItemCount * 42 + 80);
	const comparisonDisplayState =
		device.kind === 'comparison'
			? (entity: DeviceManagerEntity) => entity.displayStateId ?? entity.valueStateId
			: undefined;
	if (device.online.length) {
		items.online = panel('Online', device.online, panelHeight, comparisonDisplayState);
	}
	if (history.length) {
		const historyItems: Record<string, ConfigItemAny> = {
			historyGrouping: {
				type: 'select',
				label: { en: 'Group history by', de: 'Historie gruppieren nach' },
				options: [
					{ value: 'type', label: { en: 'Type', de: 'Typ' } },
					{ value: 'chronological', label: { en: 'Chronological', de: 'Chronologisch' } },
				],
				default: 'type',
				newLine: true,
			},
		};
		for (const [index, group] of groups.entries()) {
			Object.assign(historyItems, {
				[`typeHeader_${index}`]: {
					type: 'header',
					text: group.name,
					size: 5,
					newLine: true,
					noTranslation: true,
					hidden: "data.historyGrouping !== 'type'",
				},
			});
			Object.assign(
				historyItems,
				stateItems(group.entities, {
					keyPrefix: `type_${index}`,
					label: historyPeriodLabel,
					hidden: "data.historyGrouping !== 'type'",
					stateId: comparisonDisplayState,
				}),
			);
		}
		for (const [index, group] of periodGroups.entries()) {
			Object.assign(historyItems, {
				[`chronologicalHeader_${index}`]: {
					type: 'header',
					text: group.name,
					size: 5,
					newLine: true,
					noTranslation: true,
					hidden: "data.historyGrouping !== 'chronological'",
				},
			});
			Object.assign(
				historyItems,
				stateItems(group.entities.sort(compareHistoryChronologically), {
					keyPrefix: `chronological_${index}`,
					label: historyMetricName,
					hidden: "data.historyGrouping !== 'chronological'",
					stateId: comparisonDisplayState,
				}),
			);
		}
		items.history = {
			type: 'panel',
			label: 'History',
			innerStyle: fixedPanelStyle(panelHeight),
			items: historyItems,
		};
	}
	if (device.info.length) {
		items.info = panel('Information', device.info, panelHeight);
	}
	return {
		type: 'tabs',
		tabsStyle: { minWidth: 850 },
		items,
	};
}

const renameSchema: JsonFormSchema = {
	type: 'panel',
	items: {
		name: {
			type: 'text',
			label: { en: 'Device name', de: 'Gerätename' },
			maxLength: 120,
			trim: true,
		},
	},
};

function comparisonSchema(optionGroups: ComparisonOptionGroup[]): JsonFormSchema {
	return {
		type: 'panel',
		items: {
			name: {
				type: 'text',
				label: { en: 'Comparison name', de: 'Name des Vergleichs' },
				maxLength: 120,
				trim: true,
			},
			entries: {
				type: 'select',
				label: { en: 'Values to compare', de: 'Zu vergleichende Werte' },
				options: optionGroups.map(group => ({
					label: group.label,
					items: group.items,
				})),
				multiple: true,
				format: 'dropdown',
				newLine: true,
			},
		},
	};
}

export class Gridvis2mqttDeviceManagement extends DeviceManagement<Gridvis2mqttDeviceManagerAdapter, string> {
	public constructor(adapter: Gridvis2mqttDeviceManagerAdapter) {
		super(adapter, true);
	}

	public async refreshCards(): Promise<void> {
		await this.sendCommandToGui({ command: 'all' });
	}

	protected getInstanceInfo(): InstanceDetails {
		return {
			apiVersion: 'v3',
			communicationStateId: 'info.deviceManager',
			actions: [
				{
					id: 'createComparison',
					icon: 'add',
					title: { en: 'Create comparison', de: 'Vergleich anlegen' },
					description: { en: 'Create a comparison device', de: 'Ein Vergleichsgerät anlegen' },
					handler: async context => {
						const optionGroups = await this.adapter.getDeviceManagerComparisonOptions();
						const data = await context.showForm(comparisonSchema(optionGroups), {
							title: { en: 'Create comparison', de: 'Vergleich anlegen' },
							data: { name: '', entries: [] },
							buttons: ['apply', 'cancel'],
						});
						if (!data) {
							return { refresh: false };
						}
						const name = typeof data.name === 'string' ? data.name.trim() : '';
						const entries = Array.isArray(data.entries)
							? data.entries.filter((entry): entry is string => typeof entry === 'string')
							: [];
						await this.adapter.saveDeviceManagerComparison(undefined, name, entries);
						return { refresh: true };
					},
				},
			],
		};
	}

	protected async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
		const devices = await this.adapter.getDeviceManagerDevices();
		context.setTotalDevices(devices.length);
		for (const device of devices) {
			context.addDevice(this.toDeviceInfo(device));
		}
	}

	protected async getDeviceDetails(id: string): Promise<DeviceDetails<string> | null> {
		const device = (await this.adapter.getDeviceManagerDevices()).find(candidate => candidate.id === id);
		return device ? { id, schema: detailsSchema(device), data: { historyGrouping: 'type' } } : null;
	}

	private toDeviceInfo(device: DeviceManagerDevice): DeviceInfo<string> {
		const hasDetails = device.online.length > 0 || device.history.length > 0 || device.info.length > 0;
		const entityCount = device.online.length + device.history.length;
		const isComparison = device.kind === 'comparison';
		const actions: DeviceInfo<string>['actions'] =
			isComparison && device.comparison
				? [
						{
							id: 'editComparison',
							icon: 'edit',
							description: { en: 'Edit comparison', de: 'Vergleich bearbeiten' },
							handler: async (_deviceId: string, context: ActionContext) => {
								const optionGroups = await this.adapter.getDeviceManagerComparisonOptions();
								const data = await context.showForm(comparisonSchema(optionGroups), {
									title: { en: 'Edit comparison', de: 'Vergleich bearbeiten' },
									data: {
										name: device.name,
										entries: device.comparison?.entries.map(entry => entry.key) ?? [],
									},
									buttons: ['apply', 'cancel'],
								});
								if (!data) {
									return { refresh: 'none' as const };
								}
								const name = typeof data.name === 'string' ? data.name.trim() : '';
								const entries = Array.isArray(data.entries)
									? data.entries.filter((entry): entry is string => typeof entry === 'string')
									: [];
								await this.adapter.saveDeviceManagerComparison(device.comparison?.id, name, entries);
								return { refresh: 'devices' as const };
							},
						},
						{
							id: 'deleteComparison',
							icon: 'delete',
							description: { en: 'Delete comparison', de: 'Vergleich löschen' },
							confirmation: { en: 'Delete this comparison?', de: 'Diesen Vergleich löschen?' },
							handler: async () => {
								await this.adapter.deleteDeviceManagerComparison(device.comparison?.id ?? '');
								return { refresh: 'devices' as const };
							},
						},
					]
				: [
						{
							id: 'rename',
							icon: 'rename',
							description: { en: 'Change device name', de: 'Gerätenamen ändern' },
							handler: async (_deviceId: string, context: ActionContext) => {
								const data = await context.showForm(renameSchema, {
									title: { en: 'Change device name', de: 'Gerätenamen ändern' },
									data: { name: device.customName ?? device.originalName },
									buttons: ['apply', 'cancel'],
								});
								if (!data) {
									return { refresh: 'none' as const };
								}
								const name = typeof data.name === 'string' ? data.name.trim() : '';
								await this.adapter.setDeviceManagerName(device.id, name);
								return { refresh: 'devices' as const };
							},
						},
					];
		return {
			id: device.id,
			identifier: device.identifier ?? device.id,
			name: device.name,
			icon: device.iconStateId
				? { stateId: `${this.adapter.namespace}.${device.iconStateId}` }
				: (device.icon ?? `/adapter/${this.adapter.name}/gridvis2mqtt.png`),
			...((device.manufacturer ?? (isComparison ? 'GridVis2MQTT' : undefined))
				? { manufacturer: device.manufacturer ?? 'GridVis2MQTT' }
				: {}),
			...((device.model ?? (isComparison ? 'Comparison' : undefined))
				? { model: device.model ?? 'Comparison' }
				: {}),
			color: '#fff',
			backgroundColor: isComparison ? 'secondary' : 'primary',
			actions,
			...(isComparison
				? { group: { key: 'comparisons', name: { en: 'Comparisons', de: 'Vergleiche' }, icon: 'group' } }
				: {}),
			indicators: entityCount
				? [
						{
							id: 'entitySummary',
							value: entityCount,
							icon: 'lines',
							color: 'info',
							text: {
								en: `${device.online.length} online · ${device.history.length} history`,
								de: `${device.online.length} online · ${device.history.length} Historie`,
							},
							tooltip: { en: 'Discovered values', de: 'Erkannte Werte' },
						},
					]
				: [],
			hasDetails,
		};
	}
}
