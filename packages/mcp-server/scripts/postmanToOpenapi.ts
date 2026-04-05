#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import { Command } from "commander";
import YAML from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostmanCollection {
	info?: { name?: string; description?: string };
	item?: PostmanItem[];
}

interface PostmanItem {
	name?: string;
	item?: PostmanItem[];
	request?: PostmanRequest | string;
}

interface PostmanRequest {
	method?: string;
	url?: PostmanUrl | string;
	description?: string | { content?: string };
	header?: PostmanHeader[];
	body?: PostmanBody;
}

interface PostmanUrl {
	raw?: string;
	path?: string[];
	query?: PostmanQuery[];
}

interface PostmanQuery {
	key?: string;
	value?: string;
	description?: string;
	disabled?: boolean;
}

interface PostmanHeader {
	key?: string;
	value?: string;
	description?: string;
	disabled?: boolean;
}

interface PostmanBody {
	mode?: string;
	raw?: string;
	options?: { raw?: { language?: string } };
	urlencoded?: PostmanFormParam[];
	formdata?: PostmanFormParam[];
}

interface PostmanFormParam {
	key?: string;
	value?: string;
	description?: string;
	type?: string;
	disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

function convert(collection: PostmanCollection, title?: string): Record<string, unknown> {
	const info = collection.info ?? {};
	const specTitle = title ?? info.name ?? "Converted API";

	const paths: Record<string, Record<string, unknown>> = {};
	walkItems(collection.item ?? [], paths, []);

	return {
		openapi: "3.0.0",
		info: {
			title: specTitle,
			description: info.description ?? "",
			version: "1.0.0",
		},
		paths,
	};
}

function walkItems(
	items: PostmanItem[],
	paths: Record<string, Record<string, unknown>>,
	tagStack: string[],
): void {
	for (const item of items) {
		if (item.item) {
			walkItems(item.item, paths, [...tagStack, item.name ?? ""]);
		} else if (item.request) {
			processRequest(item, paths, tagStack);
		}
	}
}

function processRequest(
	item: PostmanItem,
	paths: Record<string, Record<string, unknown>>,
	tagStack: string[],
): void {
	const req = item.request;
	if (typeof req === "string") return;
	if (!req) return;

	const method = (req.method ?? "GET").toLowerCase();
	let pathStr: string;
	let queryParams: PostmanQuery[] = [];

	if (typeof req.url === "string") {
		pathStr = urlToPath(req.url);
	} else if (req.url) {
		pathStr = buildPath(req.url);
		queryParams = req.url.query ?? [];
	} else {
		return;
	}

	if (!pathStr) return;

	const operation: Record<string, unknown> = {};

	if (item.name) operation.summary = item.name;

	let desc = req.description ?? "";
	if (typeof desc === "object") desc = desc.content ?? "";
	if (desc) operation.description = desc;

	const tags = tagStack.filter(Boolean);
	if (tags.length > 0) operation.tags = tags;

	// Parameters
	const params: Record<string, unknown>[] = [];

	// Path parameters
	for (const match of pathStr.matchAll(/\{(\w+)\}/g)) {
		params.push({
			name: match[1],
			in: "path",
			required: true,
			schema: { type: "string" },
		});
	}

	// Query parameters
	for (const qp of queryParams) {
		if (!qp || typeof qp !== "object" || qp.disabled) continue;
		const param: Record<string, unknown> = {
			name: qp.key ?? "",
			in: "query",
			required: false,
			schema: { type: "string" },
		};
		if (qp.description) param.description = qp.description;
		if (qp.value) (param.schema as Record<string, unknown>).example = qp.value;
		params.push(param);
	}

	// Headers
	const skipHeaders = new Set(["authorization", "content-type", "accept", "user-agent", "postman-token"]);
	for (const header of req.header ?? []) {
		if (!header || typeof header !== "object" || header.disabled) continue;
		const hname = header.key ?? "";
		if (skipHeaders.has(hname.toLowerCase())) continue;
		const param: Record<string, unknown> = {
			name: hname,
			in: "header",
			required: false,
			schema: { type: "string" },
		};
		if (header.description) param.description = header.description;
		params.push(param);
	}

	if (params.length > 0) operation.parameters = params;

	// Request body
	if (req.body && ["post", "put", "patch", "delete"].includes(method)) {
		const requestBody = buildRequestBody(req.body);
		if (requestBody) operation.requestBody = requestBody;
	}

	operation.responses = { "200": { description: "Successful response" } };

	if (!paths[pathStr]) paths[pathStr] = {};
	paths[pathStr][method] = operation;
}

// ---------------------------------------------------------------------------
// Path Building
// ---------------------------------------------------------------------------

function buildPath(urlObj: PostmanUrl): string {
	const pathParts = urlObj.path ?? [];
	if (pathParts.length === 0) {
		return urlToPath(urlObj.raw ?? "");
	}

	const segments: string[] = [];
	for (const part of pathParts) {
		if (typeof part !== "string") continue;
		if (part.startsWith(":")) {
			segments.push(`{${part.slice(1)}}`);
		} else if (part.startsWith("{{") && part.endsWith("}}")) {
			segments.push(`{${part.slice(2, -2)}}`);
		} else {
			segments.push(part);
		}
	}

	return segments.length > 0 ? "/" + segments.join("/") : "/";
}

function urlToPath(raw: string): string {
	raw = raw.replace(/^\{\{[^}]+\}\}/, "");
	raw = raw.replace(/^https?:\/\/[^/]+/, "");
	raw = raw.replace(/:(\w+)/g, "{$1}");
	raw = raw.replace(/\{\{(\w+)\}\}/g, "{$1}");
	raw = raw.split("?")[0];
	if (!raw.startsWith("/")) raw = "/" + raw;
	return raw;
}

// ---------------------------------------------------------------------------
// Request Body
// ---------------------------------------------------------------------------

function buildRequestBody(body: PostmanBody): Record<string, unknown> | null {
	const mode = body.mode ?? "";

	if (mode === "raw") {
		const raw = body.raw ?? "";
		const lang = body.options?.raw?.language ?? "json";

		if (lang === "json" && raw.trim()) {
			try {
				const example = JSON.parse(raw);
				const schema = inferSchema(example);
				return {
					content: {
						"application/json": { schema, example },
					},
				};
			} catch {
				// Not valid JSON
			}
		}
		return { content: { "application/json": { schema: { type: "object" } } } };
	}

	if (mode === "urlencoded") {
		const props: Record<string, unknown> = {};
		for (const param of body.urlencoded ?? []) {
			if (!param || typeof param !== "object") continue;
			const key = param.key ?? "";
			props[key] = { type: "string" };
			if (param.description) (props[key] as Record<string, unknown>).description = param.description;
		}
		return {
			content: {
				"application/x-www-form-urlencoded": {
					schema: Object.keys(props).length > 0
						? { type: "object", properties: props }
						: { type: "object" },
				},
			},
		};
	}

	if (mode === "formdata") {
		const props: Record<string, unknown> = {};
		for (const param of body.formdata ?? []) {
			if (!param || typeof param !== "object") continue;
			const key = param.key ?? "";
			if (param.type === "file") {
				props[key] = { type: "string", format: "binary" };
			} else {
				props[key] = { type: "string" };
			}
			if (param.description) (props[key] as Record<string, unknown>).description = param.description;
		}
		return {
			content: {
				"multipart/form-data": {
					schema: Object.keys(props).length > 0
						? { type: "object", properties: props }
						: { type: "object" },
				},
			},
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Schema Inference
// ---------------------------------------------------------------------------

function inferSchema(value: unknown): Record<string, unknown> {
	if (value === null || value === undefined) return { type: "string", nullable: true };
	if (typeof value === "boolean") return { type: "boolean" };
	if (typeof value === "number") return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
	if (typeof value === "string") return { type: "string" };
	if (Array.isArray(value)) {
		if (value.length > 0) return { type: "array", items: inferSchema(value[0]) };
		return { type: "array", items: {} };
	}
	if (typeof value === "object") {
		const props: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			props[k] = inferSchema(v);
		}
		return { type: "object", properties: props };
	}
	return { type: "string" };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
	.argument("<input>", "Path to Postman Collection JSON file")
	.option("-o, --output <path>", "Output YAML file path (default: stdout)")
	.option("--title <title>", "API title (default: collection name)")
	.action(async (input: string, opts: { output?: string; title?: string }) => {
		const raw = await fs.readFile(input, "utf-8");
		const collection = JSON.parse(raw) as PostmanCollection;
		const spec = convert(collection, opts.title);

		if (opts.output) {
			const outputPath = path.resolve(opts.output);
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(outputPath, YAML.stringify(spec, { lineWidth: 120 }), "utf-8");
			const pathCount = Object.keys(spec.paths as Record<string, unknown>).length;
			const opCount = Object.values(spec.paths as Record<string, Record<string, unknown>>)
				.reduce((acc, v) => acc + Object.keys(v).length, 0);
			console.log(`Wrote ${opCount} operations across ${pathCount} paths to ${outputPath}`);
		} else {
			process.stdout.write(YAML.stringify(spec, { lineWidth: 120 }));
		}
	});

program.parse();
