export type SourceType = "internal" | "external";

export type Document = [id: string, text: string, metadata: Record<string, string>];

export interface QueryResult {
	id: string;
	text: string;
	metadata: Record<string, string>;
	distance: number;
}

export interface DocumentResult {
	id: string;
	text: string;
	metadata: Record<string, string>;
}

export interface IngestSummary {
	api: string;
	endpointsIngested: number;
	schemasIngested: number;
	total: number;
}

export interface ApiInfo {
	name: string;
	endpoints: number;
	schemas: number;
	project: string;
}
