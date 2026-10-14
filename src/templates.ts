import type { JsonRecord } from './types';

/**
 *
 */
export interface TemplateResult {
	/**
	 *
	 */
	supported: boolean;
	/**
	 *
	 */
	value?: ioBroker.StateValue;
	/**
	 *
	 */
	error?: string;
}

function parseJson(payload: string): unknown {
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

function getPath(value: unknown, path: string): unknown {
	let current = value;
	const tokens = path.match(/(?:^|\.)([a-zA-Z0-9_-]+)|\[(\d+)\]/g) ?? [];
	for (const token of tokens) {
		const key = token.startsWith('[') ? Number(token.slice(1, -1)) : token.replace(/^\./, '');
		if (current === null || current === undefined || (typeof current !== 'object' && typeof current !== 'string')) {
			return undefined;
		}
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

function convert(value: unknown, filter: string | undefined): ioBroker.StateValue | undefined {
	if (!filter) {
		if (value === null || value === undefined) {
			return undefined;
		}
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			return value;
		}
		return JSON.stringify(value);
	}
	const name = filter.trim().toLowerCase();
	if (name === 'string' || name === 'str') {
		return String(value ?? '');
	}
	if (name === 'float' || name === 'number') {
		const result = typeof value === 'number' ? value : Number(String(value).trim());
		return Number.isFinite(result) ? result : undefined;
	}
	if (name === 'int' || name === 'integer') {
		const result = Number.parseInt(String(value), 10);
		return Number.isFinite(result) ? result : undefined;
	}
	if (name === 'bool' || name === 'boolean') {
		if (typeof value === 'boolean') {
			return value;
		}
		const text = String(value).trim().toLowerCase();
		if (['true', '1', 'on', 'yes', 'online'].includes(text)) {
			return true;
		}
		if (['false', '0', 'off', 'no', 'offline'].includes(text)) {
			return false;
		}
		return undefined;
	}
	return undefined;
}

/**
 *
 */
export function evaluateValueTemplate(template: unknown, payload: string): TemplateResult {
	if (typeof template !== 'string' || !template.trim()) {
		return { supported: true, value: payload };
	}
	const expression = template.trim().match(/^\{\{\s*(.*?)\s*\}\}$/)?.[1];
	if (!expression) {
		return { supported: false, error: `Unsupported template syntax: ${template}` };
	}
	const parts = expression.split('|').map(part => part.trim());
	const source = parts.shift() ?? '';
	const filter = parts.length === 1 ? parts[0] : parts.length === 0 ? undefined : undefined;
	if (
		parts.length > 1 ||
		(filter &&
			!['float', 'number', 'int', 'integer', 'bool', 'boolean', 'string', 'str'].includes(filter.toLowerCase()))
	) {
		return { supported: false, error: `Unsupported template filter: ${template}` };
	}

	let value: unknown;
	if (source === 'value') {
		value = payload;
	} else if (source.startsWith('value_json')) {
		const suffix = source.slice('value_json'.length);
		if (suffix && !/^(?:\.[a-zA-Z0-9_-]+|\[\d+\])+$/.test(suffix)) {
			return { supported: false, error: `Unsupported JSON path in template: ${template}` };
		}
		const parsed = parseJson(payload);
		if (parsed === undefined) {
			return { supported: false, error: 'Payload is not valid JSON' };
		}
		value = suffix ? getPath(parsed, suffix) : parsed;
	} else {
		return { supported: false, error: `Unsupported template expression: ${template}` };
	}

	const converted = convert(value, filter);
	if (converted === undefined) {
		return { supported: false, error: `Template produced no supported value: ${template}` };
	}
	return { supported: true, value: converted };
}

/**
 *
 */
export function renderCommandTemplate(template: unknown, value: ioBroker.StateValue): string | null {
	if (typeof template !== 'string' || !template.trim()) {
		return String(value ?? '');
	}
	const expression = template.trim().match(/^\{\{\s*(.*?)\s*\}\}$/)?.[1];
	if (!expression) {
		return null;
	}
	const parts = expression.split('|').map(part => part.trim());
	const source = parts.shift();
	if (source !== 'value' || parts.length > 1) {
		return null;
	}
	if (parts.length === 0) {
		return String(value ?? '');
	}
	const filter = parts[0].toLowerCase();
	if (!['float', 'number', 'int', 'integer', 'bool', 'boolean', 'string', 'str'].includes(filter)) {
		return null;
	}
	const converted = convert(value, filter);
	return converted === undefined ? null : String(converted);
}

/**
 *
 */
export function jsonAttributesFromPayload(template: unknown, payload: string): string | null {
	if (typeof template === 'string' && template.trim()) {
		const result = evaluateValueTemplate(template, payload);
		return result.supported && result.value !== undefined ? String(result.value) : null;
	}
	const parsed = parseJson(payload);
	return parsed === undefined ? null : JSON.stringify(parsed);
}

/**
 *
 */
export function isSupportedCommandTemplate(template: unknown): boolean {
	return renderCommandTemplate(template, 'test') !== null;
}

/**
 *
 */
export function jsonObject(value: unknown): JsonRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}
