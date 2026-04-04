import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import config from "./config";
import { createMcpServer, WRITE_TOOLS } from "./mcpServer";
import Retriever from "./retriever";
import { renderSwaggerUi } from "./swaggerUi";

const SPECS_DIR = path.resolve(import.meta.dirname ?? ".", "..", "specs");
const SIZE_WARN_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Spec Discovery
// ---------------------------------------------------------------------------

interface SpecEntry {
	url: string;
	name: string;
}

function discoverSpecs(): SpecEntry[] {
	if (!fs.existsSync(SPECS_DIR)) return [];

	const entries = fs.readdirSync(SPECS_DIR).sort();
	const specs: SpecEntry[] = [];

	for (const filename of entries) {
		const ext = path.extname(filename);
		if (![".yaml", ".yml", ".json"].includes(ext)) continue;

		const name = path.basename(filename, ext);
		const filePath = path.join(SPECS_DIR, filename);
		const size = fs.statSync(filePath).size;

		let label: string;
		if (size > SIZE_WARN_BYTES) {
			const mb = Math.floor(size / (1024 * 1024));
			label = `${name} (${mb} MB \u26a0\ufe0f WILL FREEZE BROWSER)`;
		} else if (size > 1024 * 1024) {
			const mb = (size / (1024 * 1024)).toFixed(1);
			label = `${name} (${mb} MB)`;
		} else {
			const kb = Math.round(size / 1024);
			label = `${name} (${kb} KB)`;
		}

		specs.push({ url: `/openapi/specs/${filename}`, name: label });
	}

	return specs;
}

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------

function isAuthEnabled(): boolean {
	return config.nodeEnv === "production" && !!(config.mcpAdminToken || config.mcpReadToken);
}

function getRole(authHeader: string | undefined): "admin" | "read" | null {
	if (!isAuthEnabled()) return "admin";

	const token = authHeader?.startsWith("Bearer ")
		? authHeader.slice(7).trim()
		: "";

	if (config.mcpAdminToken && token === config.mcpAdminToken) return "admin";
	if (config.mcpReadToken && token === config.mcpReadToken) return "read";
	return null;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

export async function runHttpServer(host: string, port: number): Promise<void> {
	const app = new Hono();
	const retriever = new Retriever();

	// ── Auth middleware ────────────────────────────────────────────
	app.use("/openapi/*", async (c, next) => {
		const role = getRole(c.req.header("authorization"));
		if (role === null) {
			return c.json({ error: "unauthorized" }, 401);
		}

		// Block write tools for read-only tokens via MCP
		if (role === "read" && c.req.method === "POST" && c.req.path.replace(/\/+$/, "") === "/openapi") {
			try {
				const body = await c.req.json();
				if (body?.method === "tools/call") {
					const toolName = body?.params?.name ?? "";
					if (WRITE_TOOLS.has(toolName)) {
						return c.json({ error: `read-only token cannot call '${toolName}'` }, 403);
					}
				}
			} catch {
				// Not JSON or parse error — let it through to MCP handler
			}
		}

		c.set("role" as never, role as never);
		await next();
	});

	// ── Swagger UI ────────────────────────────────────────────────
	if (fs.existsSync(SPECS_DIR)) {
		app.get("/openapi/docs", (c) => {
			const specs = discoverSpecs();
			return c.html(renderSwaggerUi(specs));
		});

		app.use("/openapi/specs/*", serveStatic({ root: path.resolve(SPECS_DIR, "..") }));
	}

	// ── REST search endpoint ──────────────────────────────────────
	app.get("/openapi/search", async (c) => {
		const q = c.req.query("q")?.trim();
		if (!q) {
			return c.json({ error: "missing ?q= parameter" }, 400);
		}

		const api = c.req.query("api") || undefined;
		const n = Math.min(Number(c.req.query("n") ?? 10), 50);

		const results = await retriever.searchEndpoints(q, api, undefined, undefined, n);

		const items = results.map((r) => {
			const meta = r.metadata;
			const tags = meta.tags ?? "";
			const firstTag = tags.split(",")[0]?.trim() ?? "";
			return {
				method: meta.method ?? "",
				path: meta.path ?? "",
				api: meta.api ?? "",
				operation_id: meta.operation_id ?? "",
				tag: firstTag,
				tags,
				distance: Math.round((r.distance ?? 0) * 10000) / 10000,
				text: meta.full_text ?? r.text,
			};
		});

		return c.json(items);
	});

	// ── MCP HTTP transport ────────────────────────────────────────
	const mcpServer = createMcpServer();

	app.all("/openapi", async (c) => {
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});
		await mcpServer.connect(transport);
		const response = await transport.handleRequest(c.req.raw);
		return response;
	});

	// ── Start server ──────────────────────────────────────────────
	if (isAuthEnabled()) {
		console.log(`[auth] token auth enabled — admin: ${config.mcpAdminToken ? "set" : "unset"}, read: ${config.mcpReadToken ? "set" : "unset"}`);
	} else if (config.nodeEnv === "production") {
		console.log("[auth] WARNING: no auth tokens set — all endpoints are open");
	} else {
		console.log("[auth] auth disabled (NODE_ENV != production)");
	}

	console.log(`[server] listening on ${host}:${port}`);

	Bun.serve({
		fetch: app.fetch,
		hostname: host,
		port,
	});
}
