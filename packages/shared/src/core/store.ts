import {
	ChromaClient,
	IncludeEnum,
	DefaultEmbeddingFunction,
	type Collection,
	type IEmbeddingFunction,
} from "chromadb";

import config from "./config";
import { StoreError } from "./errors";
import type { ApiInfo, DocumentResult, QueryResult } from "#types/store";

// ---------------------------------------------------------------------------
// Remote Ollama embedding via HTTP (no ollama npm dep needed)
// ---------------------------------------------------------------------------

class RemoteOllamaEmbeddingFunction implements IEmbeddingFunction {
	#url: string;
	#model: string;

	constructor(url: string, model: string) {
		this.#url = url.replace(/\/+$/, "");
		this.#model = model;
	}

	/**
	 * Generates embeddings for an array of texts via the Ollama /api/embed endpoint.
	 */
	async generate(texts: string[]): Promise<number[][]> {
		const res = await fetch(`${this.#url}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: this.#model, input: texts }),
			signal: AbortSignal.timeout(300_000), // 5 min for large batches
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

/**
 * Constructs the appropriate IEmbeddingFunction based on the current config.
 * Returns undefined when ChromaDB should handle embeddings server-side.
 */
const buildEmbeddingFunction = (): IEmbeddingFunction | undefined => {
	if (config.OLLAMA_URL) {
		console.log(`[embeddings] using Ollama  url=${config.OLLAMA_URL}  model=${config.OLLAMA_MODEL}`);
		return new RemoteOllamaEmbeddingFunction(config.OLLAMA_URL, config.OLLAMA_MODEL);
	}
	if (config.CHROMA_HOST) {
		console.log("[embeddings] using ChromaDB server-side embeddings");
		return undefined;
	}
	console.log(`[embeddings] using default chromadb embeddings  model=${config.EMBEDDING_MODEL}`);
	return new DefaultEmbeddingFunction({ model: config.EMBEDDING_MODEL });
};

/**
 * Constructs a ChromaClient pointed at the configured host and port.
 */
const buildClient = (): ChromaClient => {
	const host = config.CHROMA_HOST ?? "localhost";
	const baseUrl = `${config.CHROMA_SSL ? "https" : "http"}://${host}:${config.CHROMA_PORT}`;
	return new ChromaClient({
		path: baseUrl,
		...(config.CHROMA_AUTH_TOKEN && { auth: { provider: "token" as const, credentials: config.CHROMA_AUTH_TOKEN } }),
	});
};

// ---------------------------------------------------------------------------
// SpecStore
// ---------------------------------------------------------------------------

export default class SpecStore {
	#client: ChromaClient;
	#collection: Collection | null = null;
	#embeddingFunction: IEmbeddingFunction | undefined;
	#collectionName: string;

	static readonly BATCH_SIZE = 100;   // upsert batch when using local pre-computed embeddings
	static readonly EMBED_BATCH = 100;  // embed 100 texts at a time (local embedding function)
	static readonly SERVER_EMBED_BATCH = 25; // smaller batches when ChromaDB server embeds (blocking per batch)

	constructor() {
		this.#client = buildClient();
		this.#embeddingFunction = buildEmbeddingFunction();
		this.#collectionName = config.CHROMA_COLLECTION;
	}

	/**
	 * Returns the ChromaDB collection, creating it if it doesn't exist yet.
	 */
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

	/**
	 * Upserts a batch of documents into the ChromaDB collection.
	 * Pre-computes embeddings locally if an embedding function is configured,
	 * then stores them in batches with progress callbacks.
	 */
	async upsert(
		documents: [string, string, Record<string, string>][],
		onProgress?: (done: number, total: number, phase: "embedding" | "storing") => void,
	): Promise<number> {
		if (documents.length === 0) return 0;

		const ids = documents.map((d) => d[0]);
		const texts = documents.map((d) => d[1]);
		const metadatas = documents.map((d) => d[2]);

		// Pre-compute embeddings with progress tracking
		let embeddings: number[][] | undefined;
		if (this.#embeddingFunction) {
			embeddings = [];
			for (let i = 0; i < texts.length; i += SpecStore.EMBED_BATCH) {
				const batch = texts.slice(i, i + SpecStore.EMBED_BATCH);
				const batchEmbeddings = await this.#embeddingFunction.generate(batch);
				embeddings.push(...batchEmbeddings);
				onProgress?.(Math.min(i + SpecStore.EMBED_BATCH, texts.length), texts.length, "embedding");
			}
		}

		onProgress?.(0, ids.length, "storing");
		const collection = await this.#getCollection();
		const batchSize = this.#embeddingFunction ? SpecStore.BATCH_SIZE : SpecStore.SERVER_EMBED_BATCH;
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

	/**
	 * Deletes all documents belonging to a given API from the collection.
	 */
	async deleteApi(apiName: string): Promise<void> {
		const collection = await this.#getCollection();
		await collection.delete({ where: { api: apiName } });
	}

	/**
	 * Retrieves all documents for a given API, returning them as DocumentResult objects.
	 */
	async getAll(apiName: string): Promise<DocumentResult[]> {
		const collection = await this.#getCollection();
		const results = await collection.get({
			where: { api: apiName },
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
	// Query
	// ------------------------------------------------------------------

	/**
	 * Performs a semantic similarity query against the collection.
	 * Optionally filters by a where clause and returns the top nResults matches.
	 */
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
			throw new StoreError(`Query failed: ${message}`);
		}
	}

	/**
	 * Retrieves a single document by its ID, or null if not found.
	 */
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

	// ------------------------------------------------------------------
	// Metadata
	// ------------------------------------------------------------------

	/**
	 * Lists all indexed APIs with their endpoint and schema counts, sorted alphabetically.
	 */
	async listApis(): Promise<ApiInfo[]> {
		const collection = await this.#getCollection();
		const results = await collection.get({ include: [IncludeEnum.Metadatas] });
		const counts = new Map<string, { endpoints: number; schemas: number }>();
		for (const meta of results.metadatas ?? []) {
			const m = meta as Record<string, string> | null;
			if (!m?.api) continue;
			const entry = counts.get(m.api) ?? { endpoints: 0, schemas: 0 };
			if (m.type === "endpoint") entry.endpoints++;
			else if (m.type === "schema") entry.schemas++;
			counts.set(m.api, entry);
		}
		return Array.from(counts.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, c]) => ({ name, endpoints: c.endpoints, schemas: c.schemas }));
	}

	/**
	 * Returns the total number of documents in the collection.
	 */
	async count(): Promise<number> {
		const collection = await this.#getCollection();
		return collection.count();
	}
}
