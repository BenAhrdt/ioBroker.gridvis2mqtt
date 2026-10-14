// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			enabled: boolean;
			brokerUrl: string;
			host: string;
			port: number;
			protocol: string;
			username: string;
			password: string;
			clientId: string;
			keepalive: number;
			qos: number;
			discoveryPrefix: string;
			rejectUnauthorized: boolean;
			ca: string;
			cert: string;
			key: string;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
