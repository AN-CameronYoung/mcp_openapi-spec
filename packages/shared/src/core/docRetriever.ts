import DocStore from "./docStore";
import { docToDocuments, parseMeta } from "./docChunker";
import type { DocInfo, DocIngestSummary } from "#types/doc";
import type { DocumentResult, QueryResult, SourceType } from "#types/store";

export interface DocProgressEvent {
	phase: "parsing" | "parsed" | "deleting" | "embedding" | "storing" | "done";
	message: string;
	done?: number;
	total?: number;
}

// ---------------------------------------------------------------------------
// DocRetriever
// ---------------------------------------------------------------------------

export default class DocRetriever {
	#store: DocStore;

	constructor(store?: DocStore) {
		this.#store = store ?? new DocStore();
	}

	// ------------------------------------------------------------------
	// Ingest
	// ------------------------------------------------------------------

	async ingestContent(
		raw: string,
		docName: string,
		onProgress?: (event: DocProgressEvent) => void,
		opts?: { sourceType?: SourceType },
	): Promise<DocIngestSummary> {
		onProgress?.({ phase: "parsing", message: "Parsing document..." });
		const { meta } = parseMeta(raw);
		const docs = docToDocuments(raw, docName, opts?.sourceType);
		onProgress?.({ phase: "parsed", message: `Found ${docs.length} chunks` });

		onProgress?.({ phase: "deleting", message: "Removing old data..." });
		await this.#store.deleteByDocName(docName);

		await this.#store.upsert(docs, (done, total, storePhase) => {
			onProgress?.({ phase: storePhase, message: `${storePhase === "embedding" ? "Embedding" : "Storing"} ${done}/${total}`, done, total });
		});

		const summary: DocIngestSummary = { docName, project: meta.project, chunksIngested: docs.length };
		onProgress?.({ phase: "done", message: `Done — ${docs.length} chunks` });
		return summary;
	}

	// ------------------------------------------------------------------
	// Search
	// ------------------------------------------------------------------

	async searchDocs(
		query: string,
		filters?: { project?: string; category?: string; tags?: string; author?: string; status?: string; sourceType?: SourceType },
		n: number = 5,
		maxDistance: number = 0.75,
	): Promise<QueryResult[]> {
		const where = buildDocWhere(filters);
		let results = await this.#store.query(query, n * 3, where ?? undefined);
		results = results.filter((r) => (r.distance ?? 1) <= maxDistance);
		return results.slice(0, n);
	}

	// ------------------------------------------------------------------
	// Exact lookups
	// ------------------------------------------------------------------

	async getDoc(id: string): Promise<DocumentResult | null> {
		return this.#store.getById(id);
	}

	async getDocChunks(docName: string): Promise<DocumentResult[]> {
		return this.#store.getAll(docName);
	}

	async getDocByHeading(docName: string, heading: string): Promise<QueryResult[]> {
		const where: Record<string, unknown> = {
			$and: [
				{ doc_name: docName },
				{ heading },
			],
		};
		return this.#store.query(heading, 3, where);
	}

	// ------------------------------------------------------------------
	// Metadata
	// ------------------------------------------------------------------

	async listDocs(): Promise<DocInfo[]> {
		return this.#store.listDocs();
	}

	async deleteDoc(docName: string): Promise<void> {
		await this.#store.deleteByDocName(docName);
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const buildDocWhere = (
	filters?: { project?: string; category?: string; tags?: string; author?: string; status?: string; sourceType?: SourceType },
): Record<string, unknown> | null => {
	if (!filters) return null;

	const clauses: Record<string, unknown>[] = [];

	if (filters.project) clauses.push({ project: filters.project });
	if (filters.category) clauses.push({ category: filters.category });
	if (filters.author) clauses.push({ author: filters.author });
	if (filters.status) clauses.push({ status: filters.status });
	if (filters.tags) {
		clauses.push({ tags: { $contains: filters.tags } });
	}
	if (filters.sourceType) clauses.push({ source_type: filters.sourceType });

	if (clauses.length === 0) return null;
	if (clauses.length === 1) return clauses[0]!;
	return { $and: clauses };
};
