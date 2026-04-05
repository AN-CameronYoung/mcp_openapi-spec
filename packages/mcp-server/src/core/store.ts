import {
	ChromaClient,
	IncludeEnum,
	DefaultEmbeddingFunction,
	type Collection,
	type IEmbeddingFunction,
} from "chromadb";

import config from "./config";
import { StoreError } from "./errors";
import type { DocumentResult, QueryResult } from "#types/store";

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

	async generate(texts: string[]): Promise<number[][]> {
		const embeddings: number[][] = [];
		for (const text of texts) {
			const res = await fetch(`${this.#url}/api/embed`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: this.#model, input: text }),
			});
			if (!res.ok) {
				const body = await res.text().catch(() => "");
				throw new Error(`Ollama embed failed: ${res.status} model=${this.#model} url=${this.#url} — ${body}`);
			}
			const data = await res.json() as { embeddings: number[][] };
			embeddings.push(data.embeddings[0]);
		}
		return embeddings;
	}
}

// ---------------------------------------------------------------------------
// Client & Embedding Builders
// ---------------------------------------------------------------------------

function buildEmbeddingFunction(): IEmbeddingFunction | undefined {
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
}

function buildClient(): ChromaClient {
	if (config.CHROMA_HOST) {
		const baseUrl = `${config.CHROMA_SSL ? "https" : "http"}://${config.CHROMA_HOST}:${config.CHROMA_PORT}`;
		return new ChromaClient({
			path: baseUrl,
			auth: config.CHROMA_AUTH_TOKEN
				? { provider: "token", credentials: config.CHROMA_AUTH_TOKEN }
				: undefined,
		});
	}
	return new ChromaClient({ path: config.CHROMA_DB_PATH });
}

// ---------------------------------------------------------------------------
// SpecStore
// ---------------------------------------------------------------------------

export default class SpecStore {
	#client: ChromaClient;
	#collection: Collection | null = null;
	#embeddingFunction: IEmbeddingFunction | undefined;
	#collectionName: string;

	static readonly BATCH_SIZE = 5000;

	constructor() {
		this.#client = buildClient();
		this.#embeddingFunction = buildEmbeddingFunction();
		this.#collectionName = config.CHROMA_COLLECTION;
	}

	async #getCollection(): Promise<Collection> {
		if (!this.#collection) {
			this.#collection = await this.#client.getOrCreateCollection({
				name: this.#collectionName,
				embeddingFunction: this.#embeddingFunction,
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

		// Pre-compute embeddings with progress tracking
		let embeddings: number[][] | undefined;
		if (this.#embeddingFunction) {
			embeddings = [];
			const EMBED_BATCH = 10;
			for (let i = 0; i < texts.length; i += EMBED_BATCH) {
				const batch = texts.slice(i, i + EMBED_BATCH);
				const batchEmbeddings = await this.#embeddingFunction.generate(batch);
				embeddings.push(...batchEmbeddings);
				onProgress?.(Math.min(i + EMBED_BATCH, texts.length), texts.length, "embedding");
			}
		}

		onProgress?.(0, ids.length, "storing");
		const collection = await this.#getCollection();
		for (let i = 0; i < ids.length; i += SpecStore.BATCH_SIZE) {
			const end = Math.min(i + SpecStore.BATCH_SIZE, ids.length);
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

	async deleteApi(apiName: string): Promise<void> {
		const collection = await this.#getCollection();
		const results = await collection.get({ where: { api: apiName } });
		const ids = results.ids ?? [];
		if (ids.length > 0) {
			await collection.delete({ ids });
		}
	}

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

	async getById(docId: string): Promise<DocumentResult | null> {
		const collection = await this.#getCollection();
		const results = await collection.get({
			ids: [docId],
			include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
		});

		const ids = results.ids ?? [];
		if (ids.length === 0) return null;

		return {
			id: ids[0],
			text: (results.documents?.[0] as string) ?? "",
			metadata: (results.metadatas?.[0] as Record<string, string>) ?? {},
		};
	}

	// ------------------------------------------------------------------
	// Metadata
	// ------------------------------------------------------------------

	async listApis(): Promise<string[]> {
		const collection = await this.#getCollection();
		const results = await collection.get({ include: [IncludeEnum.Metadatas] });
		const apis = new Set<string>();
		for (const meta of results.metadatas ?? []) {
			const m = meta as Record<string, string> | null;
			if (m?.api) apis.add(m.api);
		}
		return Array.from(apis).sort();
	}

	async count(): Promise<number> {
		const collection = await this.#getCollection();
		return collection.count();
	}
}
