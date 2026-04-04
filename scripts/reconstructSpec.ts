#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import { Command } from "commander";
import YAML from "yaml";
import SpecStore from "../src/store";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface ParsedEndpoint {
	method: string;
	path: string;
	summary: string;
	description: string;
	operationId: string;
	tags: string[];
	parameters: ParsedParam[];
	requestBody: { mediaType: string; schemaHint: string } | null;
	responses: Record<string, { description: string; schemaHint: string }>;
	responseSchema?: string;
}

interface ParsedParam {
	name: string;
	in: string;
	required: boolean;
	type: string;
	description: string;
}

function parseEndpointText(text: string, metadata: Record<string, string>): ParsedEndpoint | null {
	const lines = text.trim().split("\n");
	if (lines.length === 0) return null;

	const first = lines[0].trim();
	const parts = first.split(" ", 2);
	if (parts.length !== 2) return null;

	const ep: ParsedEndpoint = {
		method: parts[0].toUpperCase(),
		path: parts[1],
		summary: "",
		description: "",
		operationId: "",
		tags: [],
		parameters: [],
		requestBody: null,
		responses: {},
	};

	let section: string | null = null;
	let currentResponseCode: string | null = null;
	let i = 1;

	while (i < lines.length) {
		const stripped = lines[i].trim();

		if (stripped.startsWith("Summary: ")) {
			ep.summary = stripped.slice(9);
		} else if (stripped.startsWith("Tags: ")) {
			ep.tags = stripped.slice(6).split(",").map((t) => t.trim());
		} else if (stripped.startsWith("Description: ")) {
			const descLines = [stripped.slice(13)];
			while (
				i + 1 < lines.length &&
				!lines[i + 1].trim().startsWith("Operation ID:") &&
				!lines[i + 1].trim().startsWith("Parameters:") &&
				!lines[i + 1].trim().startsWith("Request Body:") &&
				!lines[i + 1].trim().startsWith("Responses:") &&
				!lines[i + 1].trim().startsWith("Tags:") &&
				!lines[i + 1].trim().startsWith("Summary:")
			) {
				const nextLine = lines[i + 1].trim();
				if (nextLine.startsWith("- ") && section === "parameters") break;
				descLines.push(nextLine);
				i++;
			}
			ep.description = descLines.join("\n");
		} else if (stripped.startsWith("Operation ID: ")) {
			ep.operationId = stripped.slice(14);
		} else if (stripped === "Parameters:") {
			section = "parameters";
		} else if (stripped === "Request Body:") {
			section = "request_body";
		} else if (stripped === "Responses:") {
			section = "responses";
		} else if (section === "parameters" && stripped.startsWith("- ")) {
			const param = parseParameterLine(stripped);
			if (param) ep.parameters.push(param);
		} else if (section === "request_body" && stripped.startsWith("(")) {
			const match = stripped.match(/^\(([^)]+)\):\s*(.*)/);
			if (match) {
				ep.requestBody = { mediaType: match[1], schemaHint: match[2] };
			}
		} else if (section === "responses" && /^\d{3}:/.test(stripped)) {
			const codeMatch = stripped.match(/^(\d{3}):\s*(.*)/);
			if (codeMatch) {
				currentResponseCode = codeMatch[1];
				let rest = codeMatch[2];
				let desc = rest;
				let schemaHint = "";
				if (rest.includes(" — ")) {
					[desc, schemaHint] = rest.split(" — ", 2);
				}
				ep.responses[currentResponseCode] = {
					description: desc.trim(),
					schemaHint: schemaHint.trim(),
				};
			}
		}
		i++;
	}

	if (metadata.operation_id) ep.operationId = metadata.operation_id;
	if (metadata.tags) ep.tags = metadata.tags.split(",").map((t) => t.trim());

	return ep;
}

function parseParameterLine(line: string): ParsedParam | null {
	const m = line.match(
		/^-\s+(\S+)\s+\((\w+),\s*(required|optional)\)(?::\s*(\S+))?(?:\s+—\s+(.*))?$/
	);
	if (!m) return null;
	return {
		name: m[1],
		in: m[2],
		required: m[3] === "required",
		type: m[4] ?? "string",
		description: m[5] ?? "",
	};
}

// ---------------------------------------------------------------------------
// Schema Hint Parsing
// ---------------------------------------------------------------------------

function parseResponseSchemaHint(hint: string): Record<string, unknown> {
	hint = hint.trim();
	if (!hint) return {};

	if (hint.startsWith("array of ")) {
		const inner = parseResponseSchemaHint(hint.slice(9));
		return Object.keys(inner).length > 0
			? { type: "array", items: inner }
			: { type: "array" };
	}

	if (hint.startsWith("{") && hint.endsWith("}")) {
		const inner = hint.slice(1, -1).trim();
		if (!inner) return { type: "object" };

		const props: Record<string, unknown> = {};
		for (let part of splitSchemaFields(inner)) {
			part = part.trim().replace(/,$/, "");
			if (!part || part === "...") continue;
			if (part.includes(": ")) {
				const [k, v] = part.split(": ", 2);
				props[k.trim()] = typeToSchema(v.trim());
			} else {
				props[part.trim()] = { type: "string" };
			}
		}
		return Object.keys(props).length > 0
			? { type: "object", properties: props }
			: { type: "object" };
	}

	return typeToSchema(hint);
}

function splitSchemaFields(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";

	for (const ch of s) {
		if (ch === "{" || ch === "[") {
			depth++;
			current += ch;
		} else if (ch === "}" || ch === "]") {
			depth--;
			current += ch;
		} else if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	if (current.trim()) parts.push(current);
	return parts;
}

function typeToSchema(t: string): Record<string, unknown> {
	t = t.trim();
	if (["string", "integer", "number", "boolean"].includes(t)) {
		return { type: t };
	}
	if (t.startsWith("array of ")) {
		return { type: "array", items: typeToSchema(t.slice(9)) };
	}
	if (t.startsWith("{")) {
		return parseResponseSchemaHint(t);
	}
	if (t === "object") {
		return { type: "object" };
	}
	return { type: "string" };
}

// ---------------------------------------------------------------------------
// OpenAPI Builder
// ---------------------------------------------------------------------------

function buildOpenapi(apiName: string, endpoints: ParsedEndpoint[]): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};

	for (const ep of endpoints) {
		const method = ep.method.toLowerCase();
		const operation: Record<string, unknown> = {};

		if (ep.summary) operation.summary = ep.summary;
		if (ep.description) operation.description = ep.description;
		if (ep.operationId) operation.operationId = ep.operationId;
		if (ep.tags.length > 0) operation.tags = ep.tags;

		if (ep.parameters.length > 0) {
			operation.parameters = ep.parameters.map((p) => {
				const param: Record<string, unknown> = {
					name: p.name,
					in: p.in,
					required: p.required,
					schema: { type: p.type },
				};
				if (p.description) param.description = p.description;
				return param;
			});
		}

		if (ep.requestBody) {
			const schema = parseResponseSchemaHint(ep.requestBody.schemaHint);
			operation.requestBody = {
				content: {
					[ep.requestBody.mediaType]: Object.keys(schema).length > 0 ? { schema } : {},
				},
			};
		}

		if (Object.keys(ep.responses).length > 0) {
			const responses: Record<string, unknown> = {};
			for (const [code, respInfo] of Object.entries(ep.responses)) {
				const resp: Record<string, unknown> = { description: respInfo.description };
				const fullSchema = code.startsWith("2") ? ep.responseSchema : undefined;
				const schemaHint = respInfo.schemaHint;
				let schema: Record<string, unknown> | null = null;
				if (fullSchema) {
					schema = parseResponseSchemaHint(fullSchema);
				} else if (schemaHint) {
					schema = parseResponseSchemaHint(schemaHint);
				}
				if (schema && Object.keys(schema).length > 0) {
					resp.content = { "application/json": { schema } };
				}
				responses[code] = resp;
			}
			operation.responses = responses;
		} else {
			operation.responses = { "200": { description: "Successful response" } };
		}

		if (!paths[ep.path]) paths[ep.path] = {};
		paths[ep.path][method] = operation;
	}

	return {
		openapi: "3.0.0",
		info: {
			title: `${apiName} API`,
			description: `Reconstructed from ChromaDB ingested data for ${apiName}.`,
			version: "1.0.0",
		},
		paths,
	};
}

// ---------------------------------------------------------------------------
// Search Results Splitter
// ---------------------------------------------------------------------------

function splitSearchResults(text: string): string[] {
	const blocks = text.split("\n---\n");
	const result: string[] = [];
	for (let block of blocks) {
		block = block.trim();
		const lines = block.split("\n");
		if (lines.length > 0 && /^\[\d+\]/.test(lines[0])) {
			block = lines.slice(1).join("\n").trim();
		}
		if (block) result.push(block);
	}
	return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
	.argument("<api>", "API name (used for spec title)")
	.option("-o, --output <path>", "Output YAML file path")
	.option("-f, --from-file <path>", "Parse from a text dump file instead of ChromaDB")
	.action(async (api: string, opts: { output?: string; fromFile?: string }) => {
		const outputPath = opts.output ?? path.resolve("specs", `${api}.yaml`);
		const endpoints: ParsedEndpoint[] = [];

		if (opts.fromFile) {
			const text = await fs.readFile(opts.fromFile, "utf-8");
			const blocks = splitSearchResults(text);
			for (const block of blocks) {
				const ep = parseEndpointText(block, {});
				if (ep) endpoints.push(ep);
			}
		} else {
			const store = new SpecStore();
			const docs = await store.getAll(api);
			if (docs.length === 0) {
				console.log(`No documents found for API '${api}'`);
				process.exit(1);
			}
			for (const doc of docs) {
				const meta = doc.metadata;
				if (meta.type !== "endpoint") continue;
				const ep = parseEndpointText(doc.text, meta);
				if (ep) {
					if (meta.response_schema) ep.responseSchema = meta.response_schema;
					endpoints.push(ep);
				}
			}
		}

		if (endpoints.length === 0) {
			console.log(`No endpoints found for API '${api}'`);
			process.exit(1);
		}

		const spec = buildOpenapi(api, endpoints);
		const dir = path.dirname(outputPath);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(outputPath, YAML.stringify(spec, { lineWidth: 120 }), "utf-8");
		console.log(`Wrote ${endpoints.length} endpoints to ${outputPath}`);
	});

program.parse();
