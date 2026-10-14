import { expect } from 'chai';
import type { NormalizedEntity } from './types';
import { roleFor, stateTypeFor } from './roles';

function entity(component: string, config: Record<string, unknown>, key = 'entity'): NormalizedEntity {
	return { key, component, config };
}

describe('Home Assistant to ioBroker role mapping', () => {
	it('maps active power to the specialised active-power role', () => {
		expect(
			roleFor(
				entity(
					'sensor',
					{
						name: 'Wirkleistung Summe L1..L3',
						device_class: 'power',
						state_class: 'measurement',
						unit_of_measurement: 'W',
					},
					'poweractive_sum13',
				),
			),
		).to.equal('value.power.active');
	});

	it('distinguishes consumed energy from active energy', () => {
		expect(roleFor(entity('sensor', { device_class: 'energy' }, 'activeenergyconsumed_sum13'))).to.equal(
			'value.energy.consumed',
		);
		expect(roleFor(entity('sensor', { device_class: 'energy' }, 'activeenergy_sum13'))).to.equal(
			'value.energy.active',
		);
	});

	it('maps common measurement classes and state classes', () => {
		expect(roleFor(entity('sensor', { device_class: 'temperature', state_class: 'measurement' }))).to.equal(
			'value.temperature',
		);
		expect(roleFor(entity('sensor', { device_class: 'reactive_power', state_class: 'measurement' }))).to.equal(
			'value.power.reactive',
		);
		expect(
			roleFor(entity('sensor', { device_class: 'wind_direction', state_class: 'measurement_angle' })),
		).to.equal('value.direction');
		expect(roleFor(entity('sensor', { device_class: 'energy', state_class: 'total_increasing' }))).to.equal(
			'value.energy',
		);
	});

	it('maps boolean and writable discovery components', () => {
		expect(roleFor(entity('binary_sensor', { device_class: 'motion' }))).to.equal('sensor.motion');
		expect(roleFor(entity('binary_sensor', { device_class: 'smoke' }))).to.equal('sensor.alarm.fire');
		expect(roleFor(entity('binary_sensor', { device_class: 'battery' }))).to.equal('indicator.lowbat');
		expect(roleFor(entity('binary_sensor', { device_class: 'opening' }))).to.equal('sensor.contact');
		expect(roleFor(entity('lock', {}))).to.equal('switch.lock');
		expect(roleFor(entity('light', {}))).to.equal('switch.light');
		expect(roleFor(entity('number', { device_class: 'temperature' }))).to.equal('level.temperature');
		expect(roleFor(entity('select', {}))).to.equal('text');
	});

	it('keeps enum and date-like sensors as strings', () => {
		expect(stateTypeFor(entity('sensor', { device_class: 'enum', options: ['idle', 'run'] }))).to.equal('string');
		expect(roleFor(entity('sensor', { device_class: 'enum' }))).to.equal('text');
		expect(stateTypeFor(entity('sensor', { device_class: 'timestamp' }))).to.equal('string');
		expect(roleFor(entity('sensor', { device_class: 'timestamp' }))).to.equal('date');
	});

	it('uses the generic state role when a sensor has no type metadata', () => {
		expect(roleFor(entity('sensor', {}))).to.equal('state');
	});
});
