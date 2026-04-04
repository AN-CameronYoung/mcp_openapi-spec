export interface Parameter {
	name: string;
	in: string;
	required?: boolean;
	description?: string;
	schema?: Record<string, unknown>;
	type?: string;
}

export interface RequestBody {
	description?: string;
	required?: boolean;
	content?: Record<string, {
		schema?: Record<string, unknown>;
	}>;
}

export interface ResponseObject {
	description?: string;
	content?: Record<string, {
		schema?: Record<string, unknown>;
	}>;
}

export interface Endpoint {
	method: string;
	path: string;
	operationId: string;
	summary: string;
	description: string;
	tags: string[];
	parameters: Parameter[];
	requestBody?: RequestBody;
	responses: Record<string, ResponseObject>;
}

export interface SchemaDefinition {
	name: string;
	description: string;
	properties: Record<string, Record<string, unknown>>;
	required: string[];
	schemaType: string;
	enum?: unknown[];
}
