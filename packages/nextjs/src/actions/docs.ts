"use server";

import { getDocRetriever } from "@/lib/retriever";
import { getRetriever } from "@/lib/retriever";
import DocStore from "@greg/shared/core/docStore";
import { formatDocSearchResult, formatQueryResult, type SearchResult, type ProjectInfo } from "@/lib/formatters";
import type { DocInfo } from "#types/doc";
import type { ApiInfo } from "#types/store";

export async function listDocs(): Promise<DocInfo[]> {
	return getDocRetriever().listDocs();
}

export async function getDocContent(docName: string): Promise<string> {
	// Use DocStore directly — the globalThis singleton may be stale after HMR
	const store = new DocStore();
	const chunks = await store.getAll(docName);
	// Sort by chunk_index metadata to reconstruct document order
	chunks.sort((a, b) => {
		const ai = parseInt(a.metadata.chunk_index ?? "0", 10);
		const bi = parseInt(b.metadata.chunk_index ?? "0", 10);
		return ai - bi;
	});
	// Reconstruct markdown with headings from metadata
	return chunks.map((c) => {
		const heading = c.metadata.heading;
		const level = parseInt(c.metadata.heading_level ?? "0", 10);
		const body = c.metadata.full_text ?? c.text;
		if (heading && level > 0) {
			const prefix = "#".repeat(level);
			return `${prefix} ${heading}\n\n${body}`;
		}
		return body;
	}).join("\n\n");
}

export async function deleteDoc(docName: string): Promise<void> {
	await getDocRetriever().deleteDoc(docName);
}

export async function searchDocs(
	query: string,
	filters?: { project?: string; category?: string; tags?: string; author?: string; status?: string },
	limit = 10,
): Promise<SearchResult[]> {
	const results = await getDocRetriever().searchDocs(query, filters, limit);
	return results.map(formatDocSearchResult);
}

export async function listProjects(): Promise<ProjectInfo[]> {
	const [apis, docs] = await Promise.all([
		getRetriever().listApis() as Promise<ApiInfo[]>,
		getDocRetriever().listDocs(),
	]);

	const map = new Map<string, ProjectInfo>();

	for (const api of apis) {
		const key = api.project || api.name;
		if (!map.has(key)) map.set(key, { name: key, apis: [], docs: [] });
		map.get(key)!.apis.push(api);
	}

	for (const doc of docs) {
		// Link doc to its primary project
		const key = doc.project || doc.name;
		if (!map.has(key)) map.set(key, { name: key, apis: [], docs: [] });
		map.get(key)!.docs.push(doc);

		// Also link doc to each API it references via api_refs
		for (const apiRef of doc.apiRefs) {
			const refKey = apiRef;
			if (refKey === key) continue; // already linked via project
			if (!map.has(refKey)) map.set(refKey, { name: refKey, apis: [], docs: [] });
			map.get(refKey)!.docs.push(doc);
		}
	}

	return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchAll(
	query: string,
	project?: string,
	limit = 10,
): Promise<(SearchResult & { _source: "api" | "doc" })[]> {
	const apiFilter = project || undefined;

	const [apiResults, docResults] = await Promise.all([
		getRetriever().searchEndpoints(query, apiFilter, undefined, undefined, limit),
		getDocRetriever().searchDocs(query, project ? { project } : undefined, limit),
	]);

	const tagged = [
		...apiResults.map((r) => ({ ...formatQueryResult(r), _source: "api" as const })),
		...docResults.map((r) => ({ ...formatDocSearchResult(r), _source: "doc" as const })),
	];

	tagged.sort((a, b) => b.score - a.score);
	return tagged.slice(0, limit);
}
