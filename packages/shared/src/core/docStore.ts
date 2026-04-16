import {
	ChromaClient,
	IncludeEnum,
	DefaultEmbeddingFunction,
	type Collection,
	type IEmbeddingFunction,
} from "chromadb";

import config from "./config";
import { StoreError } from "./errors";
import type { DocInfo } from "#types/doc";
import type { DocumentResult, QueryResult } from "#types/store";

// ---------------------------------------------------------------------------
// Remote Ollama embedding via HTTP
// ---------------------------------------------------------------------------

class RemoteOllamaEmbeddingFunction implements IEmbeddingFunction {
	#url: string;
	#model: string;

	constructor(url: string, model: string) {
		this.#url = url.replace(/\/+$/, "");
		this.#model = model;
	}

	async generate(texts: string[]): Promise<number[][]> {
		const res = await fetch(`${this.#url}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// num_ctx overrides Ollama's default context window (often 512 for embedding models).
			// snowflake-arctic-embed2 supports up to 8 192 tokens; other models vary.
			body: JSON.stringify({ model: this.#model, input: texts, options: { num_ctx: 8192 } }),
			signal: AbortSignal.timeout(300_000),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`Ollama embed failed: ${res.status} model=${this.#model} url=${this.#url} — ${body}`);
		}
		const data = await res.json() as { embeddings: number[][] };
		return data.embeddings;
	}
}

// ---------------------------------------------------------------------------
// Client & Embedding Builders
// ---------------------------------------------------------------------------

const buildEmbeddingFunction = (): IEmbeddingFunction | undefined => {
	if (config.OLLAMA_URL) {
		return new RemoteOllamaEmbeddingFunction(config.OLLAMA_URL, config.OLLAMA_MODEL);
	}
	if (config.CHROMA_HOST) {
		return undefined;
	}
	return new DefaultEmbeddingFunction({ model: config.EMBEDDING_MODEL });
};

const buildClient = (): ChromaClient => {
	const host = config.CHROMA_HOST ?? "localhost";
	const baseUrl = `${config.CHROMA_SSL ? "https" : "http"}://${host}:${config.CHROMA_PORT}`;
	return new ChromaClient({
		path: baseUrl,
		...(config.CHROMA_AUTH_TOKEN && { auth: { provider: "token" as const, credentials: config.CHROMA_AUTH_TOKEN } }),
	});
};

// ---------------------------------------------------------------------------
// DocStore
// ---------------------------------------------------------------------------

export default class DocStore {
	#client: ChromaClient;
	#collection: Collection | null = null;
	#embeddingFunction: IEmbeddingFunction | undefined;
	#collectionName: string;

	static readonly BATCH_SIZE = 100;
	static readonly EMBED_BATCH = 100;
	static readonly SERVER_EMBED_BATCH = 25;

	constructor() {
		this.#client = buildClient();
		this.#embeddingFunction = buildEmbeddingFunction();
		this.#collectionName = config.CHROMA_DOCS_COLLECTION;
	}

	async #getCollection(): Promise<Collection> {
		if (!this.#collection) {
			this.#collection = await this.#client.getOrCreateCollection({
				name: this.#collectionName,
				...(this.#embeddingFunction && { embeddingFunction: this.#embeddingFunction }),
				metadata: { "hnsw:space": "cosine" },
			});
		}
		return this.#collection;
	}

	// ------------------------------------------------------------------
	// Ingest
	// ------------------------------------------------------------------

	async upsert(
		documents: [string, string, Record<string, string>][],
		onProgress?: (done: number, total: number, phase: "embedding" | "storing") => void,
	): Promise<number> {
		if (documents.length === 0) return 0;

		const ids = documents.map((d) => d[0]);
		const texts = documents.map((d) => d[1]);
		const metadatas = documents.map((d) => d[2]);

		let embeddings: number[][] | undefined;
		if (this.#embeddingFunction) {
			embeddings = [];
			for (let i = 0; i < texts.length; i += DocStore.EMBED_BATCH) {
				const batch = texts.slice(i, i + DocStore.EMBED_BATCH);
				const batchEmbeddings = await this.#embeddingFunction.generate(batch);
				embeddings.push(...batchEmbeddings);
				onProgress?.(Math.min(i + DocStore.EMBED_BATCH, texts.length), texts.length, "embedding");
			}
		}

		onProgress?.(0, ids.length, "storing");
		const collection = await this.#getCollection();
		const batchSize = this.#embeddingFunction ? DocStore.BATCH_SIZE : DocStore.SERVER_EMBED_BATCH;
		for (let i = 0; i < ids.length; i += batchSize) {
			const end = Math.min(i + batchSize, ids.length);
			const upsertParams: Record<string, unknown> = {
				ids: ids.slice(i, end),
				documents: texts.slice(i, end),
				metadatas: metadatas.slice(i, end),
			};
			if (embeddings) {
				upsertParams.embeddings = embeddings.slice(i, end);
			}
			await collection.upsert(upsertParams as Parameters<Collection["upsert"]>[0]);
			onProgress?.(end, ids.length, "storing");
		}

		return ids.length;
	}

	async deleteByDocName(docName: string): Promise<void> {
		const collection = await this.#getCollection();
		await collection.delete({ where: { doc_name: docName } });
	}

	// ------------------------------------------------------------------
	// Query
	// ------------------------------------------------------------------

	async query(
		queryText: string,
		nResults: number = 5,
		where?: Record<string, unknown>,
	): Promise<QueryResult[]> {
		const collection = await this.#getCollection();

		const queryParams: Record<string, unknown> = {
			queryTexts: [queryText],
			nResults,
			include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
		};
		if (where) queryParams.where = where;

		try {
			const results = await collection.query(queryParams as Parameters<Collection["query"]>[0]);

			const ids = results.ids?.[0] ?? [];
			const docs = results.documents?.[0] ?? [];
			const metas = results.metadatas?.[0] ?? [];
			const dists = results.distances?.[0] ?? [];

			return ids.map((id, i) => ({
				id: id ?? "",
				text: (docs[i] as string) ?? "",
				metadata: (metas[i] as Record<string, string>) ?? {},
				distance: (dists[i] as number) ?? 0,
			}));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			throw new StoreError(`Doc query failed: ${message}`);
		}
	}

	async getById(docId: string): Promise<DocumentResult | null> {
		const collection = await this.#getCollection();
		const results = await collection.get({
			ids: [docId],
			include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
		});

		const ids = results.ids ?? [];
		if (ids.length === 0) return null;

		return {
			id: ids[0]!,
			text: (results.documents?.[0] as string) ?? "",
			metadata: (results.metadatas?.[0] as Record<string, string>) ?? {},
		};
	}

	async getAll(docName: string): Promise<DocumentResult[]> {
		const collection = await this.#getCollection();
		const results = await collection.get({
			where: { doc_name: docName },
			include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
		});

		const ids = results.ids ?? [];
		const docs = results.documents ?? [];
		const metas = results.metadatas ?? [];

		return ids.map((id, i) => ({
			id,
			text: (docs[i] as string) ?? "",
			metadata: (metas[i] as Record<string, string>) ?? {},
		}));
	}

	// ------------------------------------------------------------------
	// Metadata
	// ------------------------------------------------------------------

	async listDocs(): Promise<DocInfo[]> {
		const collection = await this.#getCollection();
		const total = await collection.count();
		if (total === 0) return [];
		const results = await collection.get({ include: [IncludeEnum.Metadatas], limit: total });
		const counts = new Map<string, { project: string; category: string; chunks: number; apiRefs: string[] }>();
		for (const meta of results.metadatas ?? []) {
			const m = meta as Record<string, string> | null;
			if (!m?.doc_name) continue;
			const entry = counts.get(m.doc_name) ?? {
				project: m.project ?? "",
				category: m.category ?? "guide",
				chunks: 0,
				apiRefs: m.api_refs ? m.api_refs.split(",").map((r) => r.trim()).filter(Boolean) : [],
			};
			entry.chunks++;
			counts.set(m.doc_name, entry);
		}
		return Array.from(counts.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, c]) => ({
				name,
				project: c.project,
				category: c.category as DocInfo["category"],
				chunks: c.chunks,
				apiRefs: c.apiRefs,
			}));
	}

	async count(): Promise<number> {
		const collection = await this.#getCollection();
		return collection.count();
	}
}
