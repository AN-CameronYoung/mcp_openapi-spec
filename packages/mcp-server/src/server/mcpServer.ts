import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import config from "@greg/shared/core/config";
import Retriever from "@greg/shared/core/retriever";
import DocRetriever from "@greg/shared/core/docRetriever";
import type { QueryResult } from "@greg/shared";

// ---------------------------------------------------------------------------
// MCP Server Setup
// ---------------------------------------------------------------------------

let retriever: Retriever | null = null;
let docRetriever: DocRetriever | null = null;
let cachedTaxonomy: string | null = null;

/**
 * Returns the shared Retriever instance, creating it lazily on first call.
 */
const getRetriever = (): Retriever => {
	if (!retriever) {
		retriever = new Retriever();
	}
	return retriever;
};

/**
 * Returns the shared DocRetriever instance, creating it lazily on first call.
 */
const getDocRetriever = (): DocRetriever => {
	if (!docRetriever) {
		docRetriever = new DocRetriever();
	}
	return docRetriever;
};

/**
 * Builds a project taxonomy string from both API and doc collections.
 * Format: "Indexed projects: ibm-cos (APIs: cos-s3 | Docs: auth-guide, quickstart), ..."
 */
const getProjectTaxonomy = async (): Promise<string> => {
	if (cachedTaxonomy !== null) return cachedTaxonomy;

	const [apis, docs] = await Promise.all([
		getRetriever().listApis(),
		getDocRetriever().listDocs(),
	]);

	const projects = new Map<string, { apis: string[]; docs: string[] }>();

	for (const api of apis) {
		const proj = api.project ?? api.name;
		const entry = projects.get(proj) ?? { apis: [], docs: [] };
		entry.apis.push(api.name);
		projects.set(proj, entry);
	}

	for (const doc of docs) {
		const proj = doc.project;
		const entry = projects.get(proj) ?? { apis: [], docs: [] };
		entry.docs.push(doc.name);
		projects.set(proj, entry);
	}

	if (projects.size === 0) {
		cachedTaxonomy = "";
		return cachedTaxonomy;
	}

	const parts: string[] = [];
	for (const [proj, { apis: projApis, docs: projDocs }] of [...projects.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const apiStr = projApis.length > 0 ? `APIs: ${projApis.join(", ")}` : "APIs: none";
		const docStr = projDocs.length > 0 ? `Docs: ${projDocs.join(", ")}` : "Docs: none";
		parts.push(`${proj} (${apiStr} | ${docStr})`);
	}

	cachedTaxonomy = ` Indexed projects: ${parts.join(", ")}.`;
	return cachedTaxonomy;
};

// ---------------------------------------------------------------------------
// Session state (tool call cap + dedup)
// ---------------------------------------------------------------------------

const SESSION_TIMEOUT_MS = 60_000;
let searchCallCount = 0;
let lastSearchTime = 0;
const returnedIds = new Set<string>();

/**
 * Resets the per-session search counter and dedup set when the session has gone stale.
 */
const resetSessionIfStale = (): void => {
	if (Date.now() - lastSearchTime > SESSION_TIMEOUT_MS) {
		searchCallCount = 0;
		returnedIds.clear();
	}
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures a new MCP Server instance with all tool definitions and handlers.
 */
export const createMcpServer = (): Server => {
	const server = new Server(
		{ name: "greg", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	// ------------------------------------------------------------------
	// Tool definitions
	// ------------------------------------------------------------------

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		const taxonomy = await getProjectTaxonomy();

		return {
			tools: [
				{
					name: "search_apis",
					description:
						"Search indexed OpenAPI specs. Returns endpoints by default, or schemas with type='schema'. Medium detail is usually enough to write code." +
						taxonomy,
					inputSchema: {
						type: "object" as const,
						properties: {
							query: { type: "string", description: "What to search for" },
							type: { type: "string", enum: ["endpoint", "schema"], description: "endpoint (default) or schema", default: "endpoint" },
							api: { type: "string", description: "Filter to specific API" },
							method: { type: "string", description: "HTTP method filter" },
							tag: { type: "string", description: "Filter by tag" },
							n: { type: "integer", description: "Max results (default: 2)", default: 2 },
							maxDistance: { type: "number", description: "Max distance threshold (default: 0.5, lower = stricter)", default: 0.5 },
							detail: { type: "string", enum: ["compact", "medium", "full"], description: "compact (browse), medium (default, code-ready), full (raw spec)", default: "medium" },
						},
						required: ["query"],
					},
				},
				{
					name: "get_endpoint",
					description: "Get full raw spec for an endpoint by method+path. Only needed when search results lack detail.",
					inputSchema: {
						type: "object" as const,
						properties: {
							path: { type: "string", description: "Endpoint path (e.g. /payments/create)" },
							method: { type: "string", description: "HTTP method (e.g. POST)" },
							api: { type: "string", description: "API name" },
						},
						required: ["path", "method"],
					},
				},
				{
					name: "list_apis",
					description: "List all ingested API specs.",
					inputSchema: { type: "object" as const, properties: {}, required: [] },
				},
				{
					name: "list_endpoints",
					description: "List all endpoints for an API.",
					inputSchema: {
						type: "object" as const,
						properties: {
							api: { type: "string", description: "API name (e.g. 'proxmox')" },
							verbose: { type: "boolean", description: "Full details (default: false)", default: false },
						},
						required: ["api"],
					},
				},
				{
					name: "ingest_spec",
					description: "Ingest an OpenAPI spec from file path or URL.",
					inputSchema: {
						type: "object" as const,
						properties: {
							source: { type: "string", description: "File path or URL to spec (YAML/JSON)" },
							api_name: { type: "string", description: "Short API name (e.g. 'stripe')" },
							project: { type: "string", description: "Project name to link this API to (defaults to api_name)" },
						},
						required: ["source", "api_name"],
					},
				},
				{
					name: "delete_api",
					description: "Remove all documents for an API.",
					inputSchema: {
						type: "object" as const,
						properties: {
							api_name: { type: "string", description: "API name to delete" },
						},
						required: ["api_name"],
					},
				},
				// ── Doc tools ──────────────────────────────────
				{
					name: "search_docs",
					description:
						"Semantic search across indexed documentation. Filter by project, category, tags, author, or status." +
						taxonomy,
					inputSchema: {
						type: "object" as const,
						properties: {
							query: { type: "string", description: "What to search for" },
							project: { type: "string", description: "Filter to a project" },
							category: { type: "string", enum: ["guide", "reference", "tutorial", "changelog", "runbook"], description: "Filter by category" },
							tags: { type: "string", description: "Filter by tag (exact match within comma-separated list)" },
							author: { type: "string", description: "Filter by author" },
							status: { type: "string", enum: ["draft", "published", "deprecated"], description: "Filter by status" },
							n: { type: "integer", description: "Max results (default: 5)", default: 5 },
							maxDistance: { type: "number", description: "Max distance threshold (default: 0.75)", default: 0.75 },
						},
						required: ["query"],
					},
				},
				{
					name: "get_doc",
					description: "Retrieve a full document by name, a single chunk by ID, or a section by doc_name + heading.",
					inputSchema: {
						type: "object" as const,
						properties: {
							id: { type: "string", description: "Full chunk ID (e.g. doc:auth-guide:0:authentication)" },
							doc_name: { type: "string", description: "Document name — returns all chunks when used alone, or a specific section when used with heading" },
							heading: { type: "string", description: "Section heading (use with doc_name for a specific section)" },
						},
					},
				},
				{
					name: "list_docs",
					description: "List ingested documentation sources with chunk counts. Optionally filter by project.",
					inputSchema: {
						type: "object" as const,
						properties: {
							project: { type: "string", description: "Filter to a specific project" },
						},
						required: [],
					},
				},
				{
					name: "ingest_doc",
					description: "Ingest a markdown document with a # Meta header. Use doc_help for format details.",
					inputSchema: {
						type: "object" as const,
						properties: {
							content: { type: "string", description: "Full markdown content including # Meta header" },
							doc_name: { type: "string", description: "Short document name (e.g. 'auth-guide')" },
						},
						required: ["content", "doc_name"],
					},
				},
				{
					name: "delete_doc",
					description: "Remove all chunks for a document.",
					inputSchema: {
						type: "object" as const,
						properties: {
							doc_name: { type: "string", description: "Document name to delete" },
						},
						required: ["doc_name"],
					},
				},
				// ── Cross-linking tools ────────────────────────
				{
					name: "list_projects",
					description: "Unified view of all projects with their APIs and docs.",
					inputSchema: { type: "object" as const, properties: {}, required: [] },
				},
				{
					name: "search_all",
					description: "Search across both APIs and docs in parallel, results interleaved by distance. Filter by project.",
					inputSchema: {
						type: "object" as const,
						properties: {
							query: { type: "string", description: "What to search for" },
							project: { type: "string", description: "Filter to a project" },
							n: { type: "integer", description: "Max results per source (default: 5)", default: 5 },
							maxDistance: { type: "number", description: "Max distance threshold (default: 0.75)", default: 0.75 },
						},
						required: ["query"],
					},
				},
				{
					name: "doc_help",
					description: "Returns the full documentation format spec, including meta fields, cross-linking, and examples.",
					inputSchema: { type: "object" as const, properties: {}, required: [] },
				},
			],
		};
	});

	// ------------------------------------------------------------------
	// Tool execution
	// ------------------------------------------------------------------

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const r = getRetriever();

		switch (name) {
			case "search_apis": {
				// ── Session gate ──────────────────────────────────
				resetSessionIfStale();
				const cap = config.MAX_TOOL_CALLS_PER_SESSION;
				if (searchCallCount >= cap) {
					return {
						content: [{
							type: "text",
							text: `Search limit reached (${cap} calls this session). Review the results you already have before searching again. The counter resets after 60 s of inactivity.`,
						}],
					};
				}
				searchCallCount++;
				lastSearchTime = Date.now();

				// ── Execute search ────────────────────────────────
				const query = args?.query as string;
				const type = (args?.type as string) ?? "endpoint";
				const n = Number(args?.n ?? 2);
				const maxDistance = args?.maxDistance != null ? Number(args.maxDistance) : undefined;
				const detail = ((args?.detail as string) ?? "medium") as "compact" | "medium" | "full";

				const results = type === "schema"
					? await r.searchSchemas(query, args?.api as string | undefined, n, maxDistance)
					: await r.searchEndpoints(query, args?.api as string | undefined, args?.method as string | undefined, args?.tag as string | undefined, n, maxDistance);

				// ── Dedup against session ─────────────────────────
				const newResults: QueryResult[] = [];
				const dupCount = { value: 0 };
				for (const res of results) {
					if (returnedIds.has(res.id)) {
						dupCount.value++;
					} else {
						newResults.push(res);
						returnedIds.add(res.id);
					}
				}

				if (results.length > 0 && newResults.length === 0) {
					return {
						content: [{
							type: "text",
							text: `All ${results.length} results for "${query}" were already returned in this session. Try a more specific query or use get_endpoint for full details on a known endpoint.`,
						}],
					};
				}

				const dupNote = dupCount.value > 0
					? `(${dupCount.value} duplicate result${dupCount.value > 1 ? "s" : ""} filtered)\n`
					: "";
				return { content: [{ type: "text", text: dupNote + formatResults(newResults, query, detail) }] };
			}

			case "get_endpoint": {
				const result = await r.getEndpoint(
					args?.path as string,
					args?.method as string,
					args?.api as string | undefined,
				);
				if (!result) {
					return { content: [{ type: "text", text: "Endpoint not found." }] };
				}
				const displayText = result.metadata.full_text ?? result.text;
				return { content: [{ type: "text", text: displayText }] };
			}

			case "list_apis": {
				const apis = await r.listApis();
				if (apis.length === 0) {
					return { content: [{ type: "text", text: "No APIs ingested yet." }] };
				}
				const lines = apis.map((a) => `- ${a.name} (${a.endpoints} endpoints, ${a.schemas} schemas)`);
				return { content: [{ type: "text", text: `Indexed APIs:\n${lines.join("\n")}` }] };
			}

			case "list_endpoints": {
				const apiName = args?.api as string;
				const verbose = args?.verbose === true;
				const endpoints = await r.listEndpoints(apiName);
				if (endpoints.length === 0) {
					return { content: [{ type: "text", text: `No endpoints found for API '${apiName}'.` }] };
				}
				const sorted = endpoints.sort((a, b) => {
					const pa = a.metadata.path ?? "";
					const pb = b.metadata.path ?? "";
					if (pa !== pb) return pa.localeCompare(pb);
					return (a.metadata.method ?? "").localeCompare(b.metadata.method ?? "");
				});
				if (verbose) {
					const lines = sorted.map((ep) => ep.metadata.full_text ?? ep.text);
					return { content: [{ type: "text", text: lines.join("\n\n---\n\n") }] };
				}
				const lines = sorted.map((ep) => {
					const m = ep.metadata.method ?? "?";
					const p = ep.metadata.path ?? "?";
					const summary = ep.text.split("\n")[1] ?? "";
					return summary ? `${m} ${p} - ${summary}` : `${m} ${p}`;
				});
				return { content: [{ type: "text", text: `${apiName} (${lines.length} endpoints):\n${lines.join("\n")}` }] };
			}

			case "ingest_spec": {
				const project = args?.project as string | undefined;
				const summary = await r.ingest(
					args?.source as string,
					args?.api_name as string,
					undefined,
					{ project },
				);
				cachedTaxonomy = null;
				return {
					content: [{
						type: "text",
						text: `Ingested API '${summary.api}': ${summary.endpointsIngested} endpoints, ${summary.schemasIngested} schemas (${summary.total} total documents).`,
					}],
				};
			}

			case "delete_api": {
				const apiName = args?.api_name as string;
				await r.deleteApi(apiName);
				cachedTaxonomy = null;
				return { content: [{ type: "text", text: `Deleted all documents for API '${apiName}'.` }] };
			}

			// ── Doc tools ──────────────────────────────────

			case "search_docs": {
				const dr = getDocRetriever();
				const query = args?.query as string;
				const n = Number(args?.n ?? 5);
				const maxDistance = args?.maxDistance != null ? Number(args.maxDistance) : undefined;
				const results = await dr.searchDocs(
					query,
					{
						project: args?.project as string | undefined,
						category: args?.category as string | undefined,
						tags: args?.tags as string | undefined,
						author: args?.author as string | undefined,
						status: args?.status as string | undefined,
					},
					n,
					maxDistance,
				);
				return { content: [{ type: "text", text: formatDocResults(results, query) }] };
			}

			case "get_doc": {
				const dr = getDocRetriever();
				if (args?.id) {
					const result = await dr.getDoc(args.id as string);
					if (!result) return { content: [{ type: "text", text: "Document chunk not found." }] };
					const heading = result.metadata.heading_path ?? result.metadata.heading ?? "";
					const text = heading ? `## ${heading}\n\n${result.metadata.full_text ?? result.text}` : (result.metadata.full_text ?? result.text);
					return { content: [{ type: "text", text }] };
				}
				if (args?.doc_name && args?.heading) {
					const results = await dr.getDocByHeading(args.doc_name as string, args.heading as string);
					if (results.length === 0) return { content: [{ type: "text", text: "No matching section found." }] };
					const res = results[0]!;
					const heading = res.metadata.heading_path ?? res.metadata.heading ?? "";
					const text = heading ? `## ${heading}\n\n${res.metadata.full_text ?? res.text}` : (res.metadata.full_text ?? res.text);
					return { content: [{ type: "text", text }] };
				}
				if (args?.doc_name) {
					const chunks = await dr.getDocChunks(args.doc_name as string);
					if (chunks.length === 0) return { content: [{ type: "text", text: `No document found with name '${args.doc_name}'.` }] };
					chunks.sort((a, b) => {
						const ai = parseInt(a.metadata.chunk_index ?? "0", 10);
						const bi = parseInt(b.metadata.chunk_index ?? "0", 10);
						return ai - bi;
					});
					const parts = chunks.map((c) => {
						const heading = c.metadata.heading;
						const level = parseInt(c.metadata.heading_level ?? "0", 10);
						const body = c.metadata.full_text ?? c.text;
						if (heading && level > 0) {
							const prefix = "#".repeat(level);
							return `${prefix} ${heading}\n\n${body}`;
						}
						return body;
					});
					return { content: [{ type: "text", text: parts.join("\n\n") }] };
				}
				return { content: [{ type: "text", text: "Provide 'id', 'doc_name', or 'doc_name' + 'heading'." }] };
			}

			case "list_docs": {
				const dr = getDocRetriever();
				let docs = await dr.listDocs();
				const projectFilter = args?.project as string | undefined;
				if (projectFilter) {
					docs = docs.filter((d) => d.project === projectFilter);
				}
				if (docs.length === 0) {
					const msg = projectFilter ? `No documents found for project '${projectFilter}'.` : "No documents ingested yet.";
					return { content: [{ type: "text", text: msg }] };
				}
				const label = projectFilter ? `Docs in project '${projectFilter}'` : "Indexed docs";
				const lines = docs.map((d) => `- ${d.name} [${d.category}] (project: ${d.project}, ${d.chunks} chunks)`);
				return { content: [{ type: "text", text: `${label}:\n${lines.join("\n")}` }] };
			}

			case "ingest_doc": {
				const dr = getDocRetriever();
				const summary = await dr.ingestContent(
					args?.content as string,
					args?.doc_name as string,
				);
				cachedTaxonomy = null;
				return {
					content: [{
						type: "text",
						text: `Ingested doc '${summary.docName}' (project: ${summary.project}): ${summary.chunksIngested} chunks.`,
					}],
				};
			}

			case "delete_doc": {
				const dr = getDocRetriever();
				const docName = args?.doc_name as string;
				await dr.deleteDoc(docName);
				cachedTaxonomy = null;
				return { content: [{ type: "text", text: `Deleted all chunks for doc '${docName}'.` }] };
			}

			// ── Cross-linking tools ────────────────────────

			case "list_projects": {
				const [apis, docs] = await Promise.all([
					r.listApis(),
					getDocRetriever().listDocs(),
				]);

				const projects = new Map<string, { apis: { name: string; endpoints: number; schemas: number }[]; docs: { name: string; category: string; chunks: number }[] }>();
				for (const api of apis) {
					const proj = api.project ?? api.name;
					const entry = projects.get(proj) ?? { apis: [], docs: [] };
					entry.apis.push({ name: api.name, endpoints: api.endpoints, schemas: api.schemas });
					projects.set(proj, entry);
				}
				for (const doc of docs) {
					const entry = projects.get(doc.project) ?? { apis: [], docs: [] };
					entry.docs.push({ name: doc.name, category: doc.category, chunks: doc.chunks });
					projects.set(doc.project, entry);
				}

				if (projects.size === 0) return { content: [{ type: "text", text: "No projects indexed yet." }] };

				const lines: string[] = [];
				for (const [proj, data] of [...projects.entries()].sort(([a], [b]) => a.localeCompare(b))) {
					lines.push(`## ${proj}`);
					if (data.apis.length > 0) {
						lines.push("APIs:");
						for (const api of data.apis) {
							lines.push(`  - ${api.name} (${api.endpoints} endpoints, ${api.schemas} schemas)`);
						}
					} else {
						lines.push("APIs: none");
					}
					if (data.docs.length > 0) {
						lines.push("Docs:");
						for (const doc of data.docs) {
							lines.push(`  - ${doc.name} [${doc.category}] (${doc.chunks} chunks)`);
						}
					} else {
						lines.push("Docs: none");
					}
					lines.push("");
				}
				return { content: [{ type: "text", text: lines.join("\n") }] };
			}

			case "search_all": {
				const query = args?.query as string;
				const project = args?.project as string | undefined;
				const n = Number(args?.n ?? 5);
				const maxDistance = args?.maxDistance != null ? Number(args.maxDistance) : 0.75;

				const [apiResults, docResults] = await Promise.all([
					r.searchEndpoints(query, project, undefined, undefined, n, maxDistance),
					getDocRetriever().searchDocs(query, project ? { project } : undefined, n, maxDistance),
				]);

				const tagged = [
					...apiResults.map((r) => ({ ...r, _source: "API" as const })),
					...docResults.map((r) => ({ ...r, _source: "DOC" as const })),
				].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

				if (tagged.length === 0) {
					return { content: [{ type: "text", text: `No results found for "${query}".` }] };
				}

				const lines: string[] = [];
				for (let i = 0; i < tagged.length; i++) {
					if (i > 0) lines.push("---");
					const res = tagged[i]!;
					const dist = (res.distance ?? 0).toFixed(2);
					if (res._source === "API") {
						const meta = res.metadata;
						lines.push(`[${i + 1}] [API] ${meta.method ?? "?"} ${meta.path ?? "?"} (${meta.api ?? "?"}, d=${dist})`);
						if (meta.medium_text) lines.push(meta.medium_text);
					} else {
						const meta = res.metadata;
						lines.push(`[${i + 1}] [DOC] ${meta.doc_name ?? "?"}${meta.heading ? ` > ${meta.heading}` : ""} (${meta.project ?? "?"}, d=${dist})`);
						const text = meta.full_text ?? res.text;
						if (text) lines.push(text.length > 300 ? text.slice(0, 300) + "..." : text);
						if (meta.api_refs) lines.push(`Linked APIs: ${meta.api_refs}`);
					}
				}
				return { content: [{ type: "text", text: lines.join("\n") }] };
			}

			case "doc_help": {
				return { content: [{ type: "text", text: DOC_HELP_TEXT }] };
			}

			default:
				return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
		}
	});

	return server;
};

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = new Set(["ingest_spec", "delete_api", "ingest_doc", "delete_doc"]);

/**
 * Connects an MCP server to a stdio transport and starts listening.
 */
export const runStdioServer = async (): Promise<void> => {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a list of search results into a human-readable string for the MCP response.
 * Includes low-confidence warnings when result distances exceed the threshold.
 */
const formatResults = (results: QueryResult[], query: string, detail: "compact" | "medium" | "full" = "medium"): string => {
	if (results.length === 0) {
		return (
			`No results found for "${query}" (0 results within distance threshold).\n` +
			`This likely means the API is not indexed — use list_apis to check what's available.\n` +
			`Do not retry with different search terms unless you've confirmed the API exists.`
		);
	}

	const lines: string[] = [];
	let hasLowConfidence = false;

	for (let i = 0; i < results.length; i++) {
		if (i > 0) lines.push("---");
		const res = results[i]!;
		const meta = res.metadata;
		const dist = res.distance ?? 0;
		const header = meta.method && meta.path
			? `[${i + 1}] ${meta.method} ${meta.path}  (${meta.api ?? "?"}, d=${dist.toFixed(2)})`
			: `[${i + 1}] ${meta.name ?? "?"}  (${meta.api ?? "?"}, d=${dist.toFixed(2)})`;
		lines.push(header);

		switch (detail) {
			case "compact": break;
			case "full": lines.push(meta.full_text ?? res.text); break;
			default: lines.push(meta.medium_text ?? meta.full_text ?? res.text); break;
		}

		// Append warnings from ingestion metadata (skip for compact)
		if (detail !== "compact" && meta.warnings) {
			for (const w of meta.warnings.split("|")) {
				if (w.trim()) lines.push(`⚠️ ${w.trim()}`);
			}
		}

		if (dist > 0.4) hasLowConfidence = true;
	}

	if (hasLowConfidence) {
		lines.push("---");
		lines.push("⚠️ Some results have high distance (>0.4) — confidence is low. Verify these match your intent before using.");
	}

	return lines.join("\n");
};

/**
 * Formats doc search results into a human-readable string.
 */
const formatDocResults = (results: QueryResult[], query: string): string => {
	if (results.length === 0) {
		return (
			`No doc results found for "${query}".\n` +
			`Use list_docs to check what's indexed, or ingest_doc to add documentation.`
		);
	}

	const lines: string[] = [];
	for (let i = 0; i < results.length; i++) {
		if (i > 0) lines.push("---");
		const res = results[i]!;
		const meta = res.metadata;
		const dist = (res.distance ?? 0).toFixed(2);
		const heading = meta.heading_path ?? meta.heading ?? "";
		lines.push(`[${i + 1}] ${meta.doc_name ?? "?"}${heading ? ` > ${heading}` : ""} (${meta.project ?? "?"}, d=${dist})`);
		const text = meta.full_text ?? res.text;
		if (text) lines.push(text.length > 500 ? text.slice(0, 500) + "..." : text);
		if (meta.api_refs) lines.push(`Linked APIs: ${meta.api_refs}`);
	}
	return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Doc help text
// ---------------------------------------------------------------------------

const DOC_HELP_TEXT = `Greg Documentation Format
=========================

Documents must start with a # Meta section containing key-value pairs:

# Meta
title: <string, required> Document title
author: <string, required> Author name
category: <enum, required> One of: guide, reference, tutorial, changelog, runbook
tags: <string, required> Comma-separated, no spaces (e.g. auth,oauth,setup)
project: <string, required> Project name — primary grouping key for list_projects
status: <enum, optional> One of: draft, published, deprecated (default: published)
audience: <enum, optional> One of: developer, ops, end-user (default: developer)
version: <string, optional> Version string
api_refs: <string, optional> Comma-separated API names this doc links to (e.g. unifi-network-api,unifi-controller)

Cross-Linking
-------------
The \`project\` field is the primary grouping key for \`list_projects\`.
The \`api_refs\` field links a doc to one or more API specs by their
api_name. This is a many-to-many join — a single doc can reference
multiple APIs, and multiple docs can reference the same API.

Use \`list_projects\` to see all projects with their APIs and docs.
Use \`search_all\` to search both APIs and docs in one call.

Chunking
--------
After the # Meta section, write standard markdown. The document is split
by H1/H2/H3 headings at ingest time. Each section becomes a separately
searchable chunk with its heading path as context.

Example
-------
# Meta
title: UniFi Collector
author: Cameron
category: reference
tags: internal,collector,unifi,devices,clients
project: loom
status: published
audience: developer
api_refs: unifi-network-api,unifi-controller

# Overview
How the UniFi collector works...

## Device Collection
Pulls device inventory from the Network API...

## Client Collection
Polls active clients via the Controller API...`;
