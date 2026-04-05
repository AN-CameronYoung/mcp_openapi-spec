import SpecStore from "./store";
import { loadSpec, extractEndpoints, extractSchemas } from "./parser";
import { endpointToDocument, schemaToDocument } from "./chunker";
import type { DocumentResult, IngestSummary, QueryResult } from "#types/store";

// ---------------------------------------------------------------------------
// Retriever
// ---------------------------------------------------------------------------

export default class Retriever {
	#store: SpecStore;

	constructor(store?: SpecStore) {
		this.#store = store ?? new SpecStore();
	}

	// ------------------------------------------------------------------
	// Ingest
	// ------------------------------------------------------------------

	async ingest(source: string, apiName: string): Promise<IngestSummary> {
		const spec = await loadSpec(source);
		const endpoints = extractEndpoints(spec);
		const schemas = extractSchemas(spec);

		const endpointDocs = endpoints.map((e) => endpointToDocument(e, apiName));
		const schemaDocs = schemas.map((s) => schemaToDocument(s, apiName));

		await this.#store.deleteApi(apiName);
		await this.#store.upsert([...endpointDocs, ...schemaDocs]);

		return {
			api: apiName,
			endpointsIngested: endpointDocs.length,
			schemasIngested: schemaDocs.length,
			total: endpointDocs.length + schemaDocs.length,
		};
	}

	// ------------------------------------------------------------------
	// Search
	// ------------------------------------------------------------------

	async searchEndpoints(
		query: string,
		api?: string,
		method?: string,
		tag?: string,
		n: number = 5,
	): Promise<QueryResult[]> {
		const where = buildWhere({ type: "endpoint", api, method });
		let results = await this.#store.query(query, n, where ?? undefined);

		if (tag) {
			const tagLower = tag.toLowerCase();
			results = results.filter(
				(r) => r.metadata.tags?.toLowerCase().includes(tagLower)
			);
		}

		return results;
	}

	async searchSchemas(
		query: string,
		api?: string,
		n: number = 5,
	): Promise<QueryResult[]> {
		const where = buildWhere({ type: "schema", api });
		return this.#store.query(query, n, where ?? undefined);
	}

	async getEndpoint(
		path: string,
		method: string,
		api?: string,
	): Promise<DocumentResult | null> {
		if (api) {
			const docId = `${api}:endpoint:${method.toUpperCase()}:${path}`;
			return this.#store.getById(docId);
		}

		const where = {
			$and: [
				{ type: "endpoint" },
				{ method: method.toUpperCase() },
				{ path },
			],
		};
		const results = await this.#store.query(`${method.toUpperCase()} ${path}`, 1, where);
		return results[0] ?? null;
	}

	// ------------------------------------------------------------------
	// Metadata
	// ------------------------------------------------------------------

	async deleteApi(apiName: string): Promise<void> {
		await this.#store.deleteApi(apiName);
	}

	async listApis(): Promise<string[]> {
		return this.#store.listApis();
	}

	async listEndpoints(apiName: string): Promise<DocumentResult[]> {
		const docs = await this.#store.getAll(apiName);
		return docs.filter((d) => d.metadata.type === "endpoint");
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface WhereFilters {
	type?: string;
	api?: string;
	method?: string;
}

function buildWhere(filters: WhereFilters): Record<string, unknown> | null {
	const clauses: Record<string, string>[] = [];

	if (filters.type) clauses.push({ type: filters.type });
	if (filters.api) clauses.push({ api: filters.api });
	if (filters.method) clauses.push({ method: filters.method.toUpperCase() });

	if (clauses.length === 0) return null;
	if (clauses.length === 1) return clauses[0];
	return { $and: clauses };
}
