import { expect } from 'chai';
import {
	availabilityEntries,
	discoverySubscription,
	entityObjectPath,
	isGridvisBridgeDiscovery,
	normalizeDiscovery,
	normalizeDiscoveryPrefix,
	parseDiscoveryTopic,
	stableDeviceId,
	stableEntityId,
} from './discovery';
import { evaluateValueTemplate, isSupportedCommandTemplate, renderCommandTemplate } from './templates';

const singlePayload = {
	name: 'Temperature',
	unique_id: 'gridvis_device_temperature',
	state_topic: 'gridvis/device/temperature/state',
	value_template: '{{ value_json.value }}',
	availability_topic: 'gridvis/device/temperature/availability',
	payload_available: 'online',
	payload_not_available: 'offline',
	device: { identifiers: ['device-1'], name: 'Device 1', manufacturer: 'Janitza' },
	origin: { name: 'GridVis2MQTT', sw: '0.3.11' },
};

describe('discovery topic handling', () => {
	it('normalizes a configured prefix and accepts a subscription suffix', () => {
		expect(normalizeDiscoveryPrefix('homeassistant/#')).to.equal('homeassistant');
		expect(discoverySubscription('gridvis/discovery')).to.equal('gridvis/discovery/#');
	});

	it('parses topics with and without node_id', () => {
		expect(parseDiscoveryTopic('homeassistant/sensor/temperature/config', 'homeassistant')).to.deep.include({
			component: 'sensor',
			objectId: 'temperature',
		});
		expect(parseDiscoveryTopic('homeassistant/sensor/device1/temperature/config', 'homeassistant')).to.deep.include(
			{ component: 'sensor', nodeId: 'device1', objectId: 'temperature' },
		);
		expect(parseDiscoveryTopic('homeassistant/status', 'homeassistant')).to.equal(null);
		expect(parseDiscoveryTopic('homeassistant/sensor/device1/temperature/state', 'homeassistant')).to.equal(null);
		expect(parseDiscoveryTopic('homeassistant/sensor/device/with/slash/config', 'homeassistant')).to.equal(null);
	});

	it('accepts the long and abbreviated origin only for GridVis2MQTT', () => {
		const long = normalizeDiscovery(
			'homeassistant/sensor/device1/temperature/config',
			'homeassistant',
			JSON.stringify(singlePayload),
		);
		expect(long?.entities).to.have.length(1);
		const abbreviated = { ...singlePayload, origin: undefined, o: { name: 'GridVis2MQTT' } };
		const short = normalizeDiscovery(
			'homeassistant/sensor/device1/temperature/config',
			'homeassistant',
			JSON.stringify(abbreviated),
		);
		expect(short?.entities[0].origin?.name).to.equal('GridVis2MQTT');
		const foreign = normalizeDiscovery(
			'homeassistant/sensor/device1/temperature/config',
			'homeassistant',
			JSON.stringify({ ...singlePayload, origin: { name: 'Other' } }),
		);
		expect(foreign).to.equal(null);
	});

	it('normalizes device discovery and removes no component implicitly', () => {
		const payload = {
			dev: { ids: 'device-1', name: 'Device 1' },
			o: { name: 'GridVis2MQTT' },
			stat_t: 'gridvis/device/state',
			cmps: {
				temperature: { p: 'sensor', unique_id: 'temp', unit_of_meas: '°C' },
				active: { p: 'binary_sensor', unique_id: 'active' },
			},
		};
		const result = normalizeDiscovery(
			'homeassistant/device/device1/config',
			'homeassistant',
			JSON.stringify(payload),
		);
		expect(result?.entities.map(entity => entity.component)).to.deep.equal(['sensor', 'binary_sensor']);
		expect(result?.entities[0].stateTopic).to.equal('gridvis/device/state');
	});

	it('resolves the Home Assistant base topic placeholder', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/device1/temperature/config',
			'homeassistant',
			JSON.stringify({ ...singlePayload, '~': 'gridvis/device', state_topic: '~/state' }),
		);
		expect(result?.entities[0].stateTopic).to.equal('gridvis/device/state');
	});

	it('supports availability arrays', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/device1/temperature/config',
			'homeassistant',
			JSON.stringify({
				...singlePayload,
				availability: [{ topic: 'gridvis/availability', payload_available: 'yes' }],
			}),
		);
		expect(availabilityEntries(result!.entities[0])).to.deep.equal([
			{
				topic: 'gridvis/availability',
				availability_topic: 'gridvis/availability',
				payload_available: 'yes',
			},
		]);
	});

	it('creates stable device IDs from identifiers and fallback data', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/node/temperature/config',
			'homeassistant',
			JSON.stringify(singlePayload),
		);
		expect(stableDeviceId(result!)).to.equal('node');
		const fallback = normalizeDiscovery(
			'homeassistant/sensor/node/temperature/config',
			'homeassistant',
			JSON.stringify({ ...singlePayload, device: undefined }),
		);
		expect(stableDeviceId(fallback!)).to.equal('node');
	});

	it('derives device and entity IDs from the discovery topic', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/27/activeenergyconsumed_sum13/config',
			'homeassistant',
			JSON.stringify({
				unique_id: 'gridvis2mqtt_27_activeenergyconsumed_sum13',
				device: { identifiers: ['gridvis2mqtt_27'], name: '27' },
				origin: { name: 'GridVis2MQTT' },
			}),
		);
		expect(stableDeviceId(result!)).to.equal('27');
		expect(stableEntityId(result!, result!.entities[0])).to.equal('activeenergyconsumed_sum13');
		expect(entityObjectPath(result!, result!.entities[0])).to.deep.equal({
			entityId: 'activeenergyconsumed_sum13',
			category: 'online',
		});
	});

	it('places history entities below the metric and period', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/27/activeenergyconsumed_sum13_history_today/config',
			'homeassistant',
			JSON.stringify({ origin: { name: 'GridVis2MQTT' }, name: 'Today' }),
		);
		expect(entityObjectPath(result!, result!.entities[0])).to.deep.equal({
			entityId: 'activeenergyconsumed_sum13',
			category: 'history',
			historyPeriod: 'today',
		});
	});

	it('places device info entities below the info channel', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/27/device_info_firmware_homeassistant/config',
			'homeassistant',
			JSON.stringify({ origin: { name: 'GridVis2MQTT' }, name: 'Firmware' }),
		);
		expect(entityObjectPath(result!, result!.entities[0])).to.deep.equal({
			entityId: 'firmware',
			category: 'info',
		});
	});

	it('places GridVis2MQTT bridge entities directly below its info channel', () => {
		const result = normalizeDiscovery(
			'homeassistant/sensor/gridvis2mqtt/bridge_gridvis_version_homeassistant/config',
			'homeassistant',
			JSON.stringify({
				name: 'GridVis-Version',
				unique_id: 'gridvis2mqtt_bridge_gridvis_version_homeassistant',
				state_topic: 'gridvis2mqtt/bridge/gridvis_version/homeassistant/state',
				availability_topic: 'gridvis2mqtt/bridge/availability',
				device: {
					identifiers: ['gridvis2mqtt_bridge'],
					name: 'GridVis2MQTT',
					manufacturer: 'GridVis2MQTT',
					model_id: 'gridvis2mqtt',
				},
				origin: { name: 'GridVis2MQTT' },
			}),
		);
		expect(isGridvisBridgeDiscovery(result!)).to.equal(true);
		expect(stableDeviceId(result!)).to.equal('gridvis2mqtt');
		expect(entityObjectPath(result!, result!.entities[0])).to.deep.equal({
			entityId: 'gridvis_version',
			category: 'instanceInfo',
		});
	});
});

describe('safe MQTT templates', () => {
	it('evaluates value_json paths and array accesses', () => {
		expect(evaluateValueTemplate('{{ value_json.value }}', '{"value": 23.4}')).to.deep.include({
			supported: true,
			value: 23.4,
		});
		expect(evaluateValueTemplate('{{ value_json.values[1] }}', '{"values": [1, 2]}')).to.deep.include({
			supported: true,
			value: 2,
		});
		expect(evaluateValueTemplate('{{ value_json.value | float }}', '{"value": "23.4"}')).to.deep.include({
			supported: true,
			value: 23.4,
		});
	});

	it('does not execute or silently accept unsupported templates', () => {
		expect(evaluateValueTemplate('{{ value_json.foo.bar | default(0) }}', '{}').supported).to.equal(false);
		expect(evaluateValueTemplate('{{ (function () { return 1; })() }}', '{}').supported).to.equal(false);
	});

	it('renders only the documented safe command templates', () => {
		expect(isSupportedCommandTemplate('{{ value }}')).to.equal(true);
		expect(renderCommandTemplate('{{ value | string }}', true)).to.equal('true');
		expect(isSupportedCommandTemplate('{{ value | tojson }}')).to.equal(false);
	});
});
