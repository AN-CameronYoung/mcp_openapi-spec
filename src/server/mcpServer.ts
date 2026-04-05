import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import Retriever from "../core/retriever";
import type { QueryResult } from "#types/store";

// ---------------------------------------------------------------------------
// MCP Server Setup
// ---------------------------------------------------------------------------

let retriever: Retriever | null = null;

function getRetriever(): Retriever {
	if (!retriever) {
		retriever = new Retriever();
	}
	return retriever;
}

export function createMcpServer(): Server {
	const server = new Server(
		{ name: "openapi-chroma", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	// ------------------------------------------------------------------
	// Tool definitions
	// ------------------------------------------------------------------

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "search_endpoints",
				description: "Semantic search over ingested OpenAPI endpoints. Use this to find endpoints related to a task or feature.",
				inputSchema: {
					type: "object" as const,
					properties: {
						query: { type: "string", description: "Natural language description of what you're looking for" },
						api: { type: "string", description: "Optional: filter to a specific API name" },
						method: { type: "string", description: "Optional: filter by HTTP method (GET, POST, PUT, DELETE, ...)" },
						tag: { type: "string", description: "Optional: filter by tag (substring match)" },
						n: { type: "integer", description: "Number of results to return (default: 5)", default: 5 },
					},
					required: ["query"],
				},
			},
			{
				name: "search_schemas",
				description: "Semantic search over ingested OpenAPI data schemas. Use this to understand the shape of request/response objects.",
				inputSchema: {
					type: "object" as const,
					properties: {
						query: { type: "string", description: "Natural language description of the schema you're looking for" },
						api: { type: "string", description: "Optional: filter to a specific API name" },
						n: { type: "integer", description: "Number of results to return (default: 5)", default: 5 },
					},
					required: ["query"],
				},
			},
			{
				name: "get_endpoint",
				description: "Exact lookup of a specific endpoint by HTTP method and path.",
				inputSchema: {
					type: "object" as const,
					properties: {
						path: { type: "string", description: "The endpoint path, e.g. /payments/create" },
						method: { type: "string", description: "The HTTP method, e.g. POST" },
						api: { type: "string", description: "Optional: restrict to a specific API name" },
					},
					required: ["path", "method"],
				},
			},
			{
				name: "list_apis",
				description: "List all API specs that have been ingested into the knowledge base.",
				inputSchema: { type: "object" as const, properties: {}, required: [] },
			},
			{
				name: "list_endpoints",
				description: "List all endpoints for a given API. Returns method, path, summary, and tags for every endpoint.",
				inputSchema: {
					type: "object" as const,
					properties: {
						api: { type: "string", description: "The API name to list endpoints for (e.g. 'proxmox')" },
					},
					required: ["api"],
				},
			},
			{
				name: "ingest_spec",
				description: "Ingest an OpenAPI spec from a file path or URL into the knowledge base. Use this when the user wants to add a new API.",
				inputSchema: {
					type: "object" as const,
					properties: {
						source: { type: "string", description: "File path or URL to the OpenAPI spec (YAML or JSON)" },
						api_name: { type: "string", description: "Short name to identify this API (e.g. 'stripe', 'github')" },
					},
					required: ["source", "api_name"],
				},
			},
			{
				name: "delete_api",
				description: "Remove all documents for a given API from the knowledge base.",
				inputSchema: {
					type: "object" as const,
					properties: {
						api_name: { type: "string", description: "The API name to delete (e.g. 'proxmox')" },
					},
					required: ["api_name"],
				},
			},
		],
	}));

	// ------------------------------------------------------------------
	// Tool execution
	// ------------------------------------------------------------------

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const r = getRetriever();

		switch (name) {
			case "search_endpoints": {
				const results = await r.searchEndpoints(
					args?.query as string,
					args?.api as string | undefined,
					args?.method as string | undefined,
					args?.tag as string | undefined,
					Number(args?.n ?? 5),
				);
				return { content: [{ type: "text", text: formatResults(results) }] };
			}

			case "search_schemas": {
				const results = await r.searchSchemas(
					args?.query as string,
					args?.api as string | undefined,
					Number(args?.n ?? 5),
				);
				return { content: [{ type: "text", text: formatResults(results) }] };
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
				return { content: [{ type: "text", text: `Ingested APIs:\n${apis.map((a) => `- ${a}`).join("\n")}` }] };
			}

			case "list_endpoints": {
				const apiName = args?.api as string;
				const endpoints = await r.listEndpoints(apiName);
				if (endpoints.length === 0) {
					return { content: [{ type: "text", text: `No endpoints found for API '${apiName}'.` }] };
				}
				const lines = endpoints
					.sort((a, b) => {
						const pa = a.metadata.path ?? "";
						const pb = b.metadata.path ?? "";
						if (pa !== pb) return pa.localeCompare(pb);
						return (a.metadata.method ?? "").localeCompare(b.metadata.method ?? "");
					})
					.map((ep) => ep.metadata.full_text ?? ep.text);
				return { content: [{ type: "text", text: lines.join("\n\n---\n\n") }] };
			}

			case "ingest_spec": {
				const summary = await r.ingest(
					args?.source as string,
					args?.api_name as string,
				);
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
				return { content: [{ type: "text", text: `Deleted all documents for API '${apiName}'.` }] };
			}

			default:
				return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
		}
	});

	return server;
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = new Set(["ingest_spec", "delete_api"]);

export async function runStdioServer(): Promise<void> {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatResults(results: QueryResult[]): string {
	if (results.length === 0) return "No results found.";

	const parts = results.map((res, i) => {
		const meta = res.metadata;
		const dist = res.distance ?? 0;
		const header = `[${i + 1}] ${meta.method ?? ""} ${meta.path ?? meta.name ?? ""}  (api: ${meta.api ?? "?"}, distance: ${dist.toFixed(4)})`;
		const displayText = meta.full_text ?? res.text;
		return `${header}\n${displayText}`;
	});

	return parts.join("\n\n---\n\n");
}
