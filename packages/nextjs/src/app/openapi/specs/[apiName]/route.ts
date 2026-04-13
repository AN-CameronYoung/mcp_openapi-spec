import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";

// ---------------------------------------------------------------------------
// Types (shared with ApiViewer.tsx — keep in sync)
// ---------------------------------------------------------------------------

export interface OASchemaNode {
	type?: string;
	format?: string;
	title?: string;
	description?: string;
	nullable?: boolean;
	required?: string[];
	enum?: unknown[];
	properties?: Record<string, OASchemaNode>;
	items?: OASchemaNode;
	allOf?: OASchemaNode[];
	oneOf?: OASchemaNode[];
	anyOf?: OASchemaNode[];
	example?: unknown;
	default?: unknown;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
}

export interface OAParameter {
	name: string;
	in: "path" | "query" | "header" | "cookie";
	required: boolean;
	description?: string;
	schema?: OASchemaNode;
}

export interface OARequestBody {
	description?: string;
	required: boolean;
	contentType: string;
	schema?: OASchemaNode;
	example?: unknown;
}

export interface OAResponse {
	statusCode: string;
	description?: string;
	contentType?: string;
	schema?: OASchemaNode;
	example?: unknown;
}

export interface OAOperation {
	method: string;
	path: string;
	operationId?: string;
	summary?: string;
	description?: string;
	tags: string[];
	deprecated: boolean;
	parameters: OAParameter[];
	requestBody?: OARequestBody;
	responses: OAResponse[];
	scopes?: string[];
}

export interface OAGroup {
	tag: string;
	ops: OAOperation[];
}

// ---------------------------------------------------------------------------
// Module-level mtime cache — avoids re-parsing unchanged specs
// ---------------------------------------------------------------------------

interface CacheEntry {
	mtime: number;
	title: string;
	version: string;
	description?: string;
	groups: OAGroup[];
}

const specCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SPECS_DIR = process.env.SPECS_DIR ?? path.resolve(process.cwd(), "../../specs");
const MAX_YAML_ALIASES = -1;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ apiName: string }> },
): Promise<Response> {
	const { apiName } = await params;

	// Prevent path traversal
	const safeName = path.basename(decodeURIComponent(apiName));

	// Find spec file
	let specPath: string | null = null;
	for (const ext of [".yaml", ".yml", ".json"]) {
		const candidate = path.join(SPECS_DIR, `${safeName}${ext}`);
		try {
			await fs.promises.access(candidate, fs.constants.R_OK);
			specPath = candidate;
			break;
		} catch {
			// not found, try next
		}
	}

	if (!specPath) {
		return Response.json({ error: "spec not found" }, { status: 404 });
	}

	// Check mtime cache
	const stat = await fs.promises.stat(specPath);
	const mtime = stat.mtimeMs;
	const cached = specCache.get(safeName);

	let entry: CacheEntry;
	if (cached && cached.mtime === mtime) {
		entry = cached;
	} else {
		// Parse and normalize
		const raw = await fs.promises.readFile(specPath, "utf-8");
		const ext = path.extname(specPath).toLowerCase();

		let parsed: Record<string, unknown>;
		try {
			parsed = ext === ".json"
				? JSON.parse(raw) as Record<string, unknown>
				: YAML.parse(raw, { maxAliasCount: MAX_YAML_ALIASES }) as Record<string, unknown>;
		} catch (e) {
			return Response.json({ error: `parse error: ${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
		}

		// Resolve internal $refs (no external file/http resolution for security)
		let resolved: Record<string, unknown>;
		try {
			resolved = await $RefParser.dereference(parsed, {
				resolve: { file: false, http: false },
			}) as Record<string, unknown>;
		} catch {
			// Circular refs or other failures — fall back to bundle (stubs circulars as $ref strings)
			try {
				resolved = await $RefParser.bundle(parsed, {
					resolve: { file: false, http: false },
				}) as Record<string, unknown>;
			} catch {
				resolved = parsed;
			}
		}

		const info = normalizeInfo(resolved);
		const groups = buildGroups(resolved);
		entry = { mtime, ...info, groups };
		specCache.set(safeName, entry);
	}

	// Stream NDJSON
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	const enc = new TextEncoder();

	const send = (obj: object): Promise<void> =>
		writer.write(enc.encode(JSON.stringify(obj) + "\n"));

	void (async () => {
		try {
			await send({
				type: "info",
				title: entry.title,
				version: entry.version,
				description: entry.description,
			});
			for (const group of entry.groups) {
				await send({ type: "group", tag: group.tag, ops: group.ops });
				// Yield between groups so we don't starve the event loop on large specs
				await new Promise<void>((r) => setTimeout(r, 0));
			}
		} finally {
			writer.close();
		}
	})();

	return new Response(readable, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "private, no-store",
		},
	});
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeInfo(spec: Record<string, unknown>) {
	const info = (spec.info ?? {}) as Record<string, unknown>;
	return {
		title: (info.title as string | undefined) ?? "API",
		version: (info.version as string | undefined) ?? "",
		description: (info.description as string | undefined) ?? undefined,
	};
}

function buildGroups(spec: Record<string, unknown>): OAGroup[] {
	const paths = (spec.paths ?? {}) as Record<string, unknown>;
	const specTagOrder = ((spec.tags ?? []) as Array<{ name?: string }>)
		.map((t) => t.name ?? "")
		.filter(Boolean);

	const groupMap = new Map<string, OAOperation[]>();

	for (const [pathStr, pathItem] of Object.entries(paths)) {
		if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
		const pi = pathItem as Record<string, unknown>;
		const pathParams = toArray(pi.parameters).filter(isObj);

		for (const method of HTTP_METHODS) {
			const op = pi[method];
			if (!op || !isObj(op)) continue;

			const opParams = toArray(op.parameters).filter(isObj);
			const merged = mergeParams(pathParams, opParams);

			const tags = (op.tags as string[] | undefined) ?? [];
			const primaryTag = tags[0] ?? "default";

			const scopes = extractScopes(op.security as Record<string, unknown>[] | undefined);

			const operation: OAOperation = {
				method: method.toUpperCase(),
				path: pathStr,
				operationId: (op.operationId as string | undefined) || undefined,
				summary: (op.summary as string | undefined) || undefined,
				description: (op.description as string | undefined) || undefined,
				tags,
				deprecated: (op.deprecated as boolean | undefined) ?? false,
				parameters: merged.map(normalizeParam),
				requestBody: op.requestBody && isObj(op.requestBody)
					? normalizeRequestBody(op.requestBody) ?? undefined
					: undefined,
				responses: normalizeResponses((op.responses ?? {}) as Record<string, unknown>),
				...(scopes.length > 0 && { scopes }),
			};

			const list = groupMap.get(primaryTag) ?? [];
			list.push(operation);
			groupMap.set(primaryTag, list);
		}
	}

	// Emit in spec tag order, then remaining tags, "default" last
	const groups: OAGroup[] = [];
	for (const tag of specTagOrder) {
		const ops = groupMap.get(tag);
		if (ops) { groups.push({ tag, ops }); groupMap.delete(tag); }
	}
	for (const [tag, ops] of groupMap) {
		if (tag !== "default") groups.push({ tag, ops });
	}
	const defaultOps = groupMap.get("default");
	if (defaultOps) groups.push({ tag: "default", ops: defaultOps });

	return groups;
}

function normalizeParam(p: Record<string, unknown>): OAParameter {
	return {
		name: (p.name as string | undefined) ?? "",
		in: (p.in as OAParameter["in"]) ?? "query",
		required: (p.required as boolean | undefined) ?? p.in === "path",
		description: (p.description as string | undefined) || undefined,
		schema: p.schema && isObj(p.schema) ? normalizeSchema(p.schema) : undefined,
	};
}

function normalizeRequestBody(rb: Record<string, unknown>): OARequestBody | null {
	const content = (rb.content ?? {}) as Record<string, unknown>;
	const contentTypes = Object.keys(content);
	const contentType =
		contentTypes.find((ct) => ct.includes("application/json")) ?? contentTypes[0];
	if (!contentType) return null;

	const media = isObj(content[contentType]) ? (content[contentType] as Record<string, unknown>) : {};
	return {
		description: (rb.description as string | undefined) || undefined,
		required: (rb.required as boolean | undefined) ?? false,
		contentType,
		schema: media.schema && isObj(media.schema) ? normalizeSchema(media.schema) : undefined,
		example: media.example !== undefined
			? media.example
			: extractFirstExample(media.examples as Record<string, unknown> | undefined),
	};
}

function normalizeResponses(responses: Record<string, unknown>): OAResponse[] {
	const result: OAResponse[] = [];

	for (const [statusCode, resp] of Object.entries(responses)) {
		if (!isObj(resp)) continue;
		const content = (resp.content ?? {}) as Record<string, unknown>;
		const contentTypes = Object.keys(content);
		const contentType =
			contentTypes.find((ct) => ct.includes("application/json")) ?? contentTypes[0];
		const media = contentType && isObj(content[contentType])
			? (content[contentType] as Record<string, unknown>)
			: {};

		result.push({
			statusCode,
			description: (resp.description as string | undefined) || undefined,
			contentType: contentType || undefined,
			schema: media.schema && isObj(media.schema) ? normalizeSchema(media.schema) : undefined,
			example: media.example !== undefined
				? media.example
				: extractFirstExample(media.examples as Record<string, unknown> | undefined),
		});
	}

	// Sort: 2xx → 3xx → 4xx → 5xx → default
	return result.sort((a, b) => {
		if (a.statusCode === "default") return 1;
		if (b.statusCode === "default") return -1;
		return a.statusCode.localeCompare(b.statusCode);
	});
}

function normalizeSchema(s: Record<string, unknown>, depth = 0): OASchemaNode {
	if (depth > 5) return { type: "object", title: "…" };

	const node: OASchemaNode = {};

	if (s.type) node.type = s.type as string;
	if (s.format) node.format = s.format as string;
	if (s.title) node.title = s.title as string;
	if (s.description) node.description = s.description as string;
	if (s.nullable) node.nullable = true;
	if (Array.isArray(s.required)) node.required = s.required as string[];
	if (Array.isArray(s.enum)) node.enum = s.enum;
	if (s.example !== undefined) node.example = s.example;
	if (s.default !== undefined) node.default = s.default;
	if (typeof s.minimum === "number") node.minimum = s.minimum;
	if (typeof s.maximum === "number") node.maximum = s.maximum;
	if (typeof s.minLength === "number") node.minLength = s.minLength;
	if (typeof s.maxLength === "number") node.maxLength = s.maxLength;
	if (s.pattern) node.pattern = s.pattern as string;

	if (isObj(s.properties)) {
		node.properties = Object.fromEntries(
			Object.entries(s.properties as Record<string, unknown>)
				.filter(([, v]) => isObj(v))
				.map(([k, v]) => [k, normalizeSchema(v as Record<string, unknown>, depth + 1)]),
		);
	}

	if (isObj(s.items)) {
		node.items = normalizeSchema(s.items as Record<string, unknown>, depth + 1);
	}

	if (Array.isArray(s.allOf)) {
		node.allOf = s.allOf.filter(isObj).map((v) => normalizeSchema(v as Record<string, unknown>, depth + 1));
	}
	if (Array.isArray(s.oneOf)) {
		node.oneOf = s.oneOf.filter(isObj).map((v) => normalizeSchema(v as Record<string, unknown>, depth + 1));
	}
	if (Array.isArray(s.anyOf)) {
		node.anyOf = s.anyOf.filter(isObj).map((v) => normalizeSchema(v as Record<string, unknown>, depth + 1));
	}

	return node;
}

function extractFirstExample(examples: Record<string, unknown> | undefined): unknown {
	if (!examples || !isObj(examples)) return undefined;
	const first = Object.values(examples)[0];
	if (isObj(first) && "value" in first) return first.value;
	return first;
}

function mergeParams(
	pathParams: Record<string, unknown>[],
	opParams: Record<string, unknown>[],
): Record<string, unknown>[] {
	const map = new Map<string, Record<string, unknown>>();
	for (const p of pathParams) map.set(`${p.in}:${p.name}`, p);
	for (const p of opParams) map.set(`${p.in}:${p.name}`, p);
	return Array.from(map.values());
}

function extractScopes(security: Record<string, unknown>[] | undefined): string[] {
	if (!security) return [];
	const seen = new Set<string>();
	for (const req of security) {
		for (const scopes of Object.values(req)) {
			if (Array.isArray(scopes)) {
				for (const s of scopes) {
					if (typeof s === "string") seen.add(s);
				}
			}
		}
	}
	return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}
