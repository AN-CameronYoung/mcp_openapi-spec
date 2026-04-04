import { ChromaClient, IncludeEnum, type Collection, type IEmbeddingFunction } from "chromadb";
import axios from "axios";

import config from "./config";
import { StoreError } from "./errors";
import type { DocumentResult, QueryResult } from "../types/store";

// ---------------------------------------------------------------------------
// Ollama Embedding Function
// ---------------------------------------------------------------------------

class OllamaEmbeddingFunction implements IEmbeddingFunction {
	#url: string;
	#model: string;

	constructor(url: string, model: string) {
		this.#url = url.replace(/\/+$/, "") + "/api/embed";
		this.#model = model;
	}

	async generate(texts: string[]): Promise<number[][]> {
		const truncated = texts.map((t) => t.slice(0, 8000));
		const batchSize = 16;
		const embeddings: number[][] = [];

		for (let i = 0; i < truncated.length; i += batchSize) {
			const batch = truncated.slice(i, i + batchSize);
			const response = await axios.post(this.#url, {
				model: this.#model,
				input: batch,
				truncate: true,
			}, { timeout: 120000 });

			embeddings.push(...response.data.embeddings);
		}

		return embeddings;
	}
}

// ---------------------------------------------------------------------------
// Client & Embedding Builders
// ---------------------------------------------------------------------------

function buildEmbeddingFunction(): IEmbeddingFunction {
	if (config.ollamaUrl) {
		console.log(`[embeddings] using Ollama  url=${config.ollamaUrl}  model=${config.ollamaModel}`);
		return new OllamaEmbeddingFunction(config.ollamaUrl, config.ollamaModel);
	}
	console.log(`[embeddings] using default chromadb embeddings  model=${config.embeddingModel}`);
	return new OllamaEmbeddingFunction("http://localhost:11434", config.embeddingModel);
}

function buildClient(): ChromaClient {
	if (config.chromaHost) {
		const baseUrl = `${config.chromaSsl ? "https" : "http"}://${config.chromaHost}:${config.chromaPort}`;
		return new ChromaClient({
			path: baseUrl,
			auth: config.chromaAuthToken
				? { provider: "token", credentials: config.chromaAuthToken }
				: undefined,
		});
	}
	return new ChromaClient({ path: config.chromaDbPath });
}

// ---------------------------------------------------------------------------
// SpecStore
// ---------------------------------------------------------------------------

export default class SpecStore {
	#client: ChromaClient;
	#collection: Collection | null = null;
	#embeddingFunction: IEmbeddingFunction;
	#collectionName: string;

	static readonly BATCH_SIZE = 5000;

	constructor() {
		this.#client = buildClient();
		this.#embeddingFunction = buildEmbeddingFunction();
		this.#collectionName = config.chromaCollection;
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

	async upsert(documents: [string, string, Record<string, string>][]): Promise<number> {
		if (documents.length === 0) return 0;

		const ids = documents.map((d) => d[0]);
		const texts = documents.map((d) => d[1]);
		const metadatas = documents.map((d) => d[2]);

		const collection = await this.#getCollection();
		for (let i = 0; i < ids.length; i += SpecStore.BATCH_SIZE) {
			await collection.upsert({
				ids: ids.slice(i, i + SpecStore.BATCH_SIZE),
				documents: texts.slice(i, i + SpecStore.BATCH_SIZE),
				metadatas: metadatas.slice(i, i + SpecStore.BATCH_SIZE),
			});
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
