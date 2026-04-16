import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ExternalMcpClient } from "@greg/shared/chat";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config schema — same format as Claude Desktop / Claude Code mcp-servers.json
// ---------------------------------------------------------------------------

interface McpServerConfig {
	url?: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
}

interface McpServersFile {
	mcpServers: Record<string, McpServerConfig>;
}

// ---------------------------------------------------------------------------
// Per-server state
// ---------------------------------------------------------------------------

interface ServerState {
	name: string;
	config: McpServerConfig;
	client: Client | null;
	tools: Anthropic.Tool[];
	initPromise: Promise<void> | null;
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

function loadConfig(): McpServersFile {
	const configPath =
		process.env.MCP_SERVERS_CONFIG ??
		resolve(process.cwd(), "mcp-servers.json");

	if (!existsSync(configPath)) return { mcpServers: {} };

	try {
		return JSON.parse(readFileSync(configPath, "utf-8")) as McpServersFile;
	} catch (err) {
		console.error("[mcp-registry] failed to read config:", err);
		return { mcpServers: {} };
	}
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function connectServer(state: ServerState): Promise<void> {
	const { config, name } = state;
	try {
		let transport: StreamableHTTPClientTransport | StdioClientTransport;

		if (config.url) {
			transport = new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: config.headers
					? { headers: config.headers }
					: undefined,
			});
		} else if (config.command) {
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args ?? [],
				env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
			});
		} else {
			console.warn(`[mcp-registry] '${name}' has neither url nor command — skipping`);
			return;
		}

		const client = new Client({ name: "greg", version: "0.1.0" });
		await client.connect(transport);

		const { tools } = await client.listTools();
		state.tools = tools.map((t) => ({
			name: t.name,
			description: t.description ?? t.name,
			input_schema: (t.inputSchema ?? {
				type: "object",
				properties: {},
				required: [],
			}) as Anthropic.Tool["input_schema"],
		}));

		state.client = client;
		console.log(
			`[mcp-registry] '${name}' connected — ${state.tools.length} tool(s): ${state.tools.map((t) => t.name).join(", ")}`,
		);
	} catch (err) {
		console.error(`[mcp-registry] '${name}' failed to connect:`, err);
		state.client = null;
		state.tools = [];
		state.initPromise = null; // allow retry on next request
	}
}

// ---------------------------------------------------------------------------
// Registry init
// ---------------------------------------------------------------------------

const servers = new Map<string, ServerState>();

// tool name → server name (for routing callTool)
const toolOwner = new Map<string, string>();

function rebuildToolIndex(): void {
	toolOwner.clear();
	for (const [serverName, state] of servers.entries()) {
		for (const tool of state.tools) {
			if (!toolOwner.has(tool.name)) {
				toolOwner.set(tool.name, serverName);
			}
		}
	}
}

function buildRegistry(): void {
	const { mcpServers } = loadConfig();
	for (const [name, config] of Object.entries(mcpServers)) {
		const state: ServerState = { name, config, client: null, tools: [], initPromise: null };
		state.initPromise = connectServer(state).then(rebuildToolIndex);
		servers.set(name, state);
	}

	if (servers.size === 0) {
		console.log("[mcp-registry] no servers configured (mcp-servers.json not found or empty)");
	}
}

buildRegistry();

// ---------------------------------------------------------------------------
// Exported client (implements ExternalMcpClient)
// ---------------------------------------------------------------------------

export const mcpRegistry: ExternalMcpClient = {
	ensureReady: async () => {
		await Promise.allSettled(
			[...servers.values()].map((s) => s.initPromise).filter(Boolean),
		);
		rebuildToolIndex();
	},

	getTools: () => {
		const all: Anthropic.Tool[] = [];
		for (const state of servers.values()) {
			all.push(...state.tools);
		}
		return all;
	},

	callTool: async (name, args) => {
		const serverName = toolOwner.get(name);
		if (!serverName) return `Unknown MCP tool: '${name}'`;

		const state = servers.get(serverName);
		if (!state?.client) return `MCP server '${serverName}' is not connected.`;

		try {
			const result = await state.client.callTool({ name, arguments: args });
			const blocks = result.content as Array<{ type: string; text?: string }>;
			const text = blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text ?? "")
				.join("\n");
			return text || "Tool returned no text content.";
		} catch (err) {
			return `MCP tool error: ${err instanceof Error ? err.message : String(err)}`;
		}
	},
};
