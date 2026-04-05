import type { Endpoint, SchemaDefinition } from "#types/openapi";
import type { Document } from "#types/store";

// ---------------------------------------------------------------------------
// Endpoint → Document
// ---------------------------------------------------------------------------

export function endpointToDocument(endpoint: Endpoint, apiName: string): Document {
	const { method, path } = endpoint;
	const docId = `${apiName}:endpoint:${method}:${path}`;

	// ── Full text (stored in metadata, used for display) ───────────
	const fullLines: string[] = [`${method} ${path}`];

	if (endpoint.summary) {
		fullLines.push(`Summary: ${endpoint.summary}`);
	}
	if (endpoint.tags.length > 0) {
		fullLines.push(`Tags: ${endpoint.tags.join(", ")}`);
	}
	if (endpoint.description) {
		fullLines.push(`Description: ${endpoint.description}`);
	}
	if (endpoint.operationId) {
		fullLines.push(`Operation ID: ${endpoint.operationId}`);
	}

	const params = endpoint.parameters ?? [];
	if (params.length > 0) {
		fullLines.push("Parameters:");
		for (const p of params) {
			if (!p || typeof p !== "object") continue;
			const name = p.name ?? "?";
			const location = p.in ?? "";
			const required = p.required ? "required" : "optional";
			const schema = (p.schema ?? {}) as Record<string, unknown>;
			const ptype = (schema.type as string) ?? p.type ?? "";
			const desc = p.description ?? (schema.description as string) ?? "";
			let line = `  - ${name} (${location}, ${required})`;
			if (ptype) line += `: ${ptype}`;
			if (desc) line += ` — ${desc}`;
			fullLines.push(line);
		}
	}

	const reqBody = endpoint.requestBody;
	if (reqBody && typeof reqBody === "object") {
		fullLines.push("Request Body:");
		if (reqBody.description) {
			fullLines.push(`  ${reqBody.description}`);
		}
		const content = reqBody.content ?? {};
		for (const [mediaType, mediaObj] of Object.entries(content)) {
			if (!mediaObj || typeof mediaObj !== "object") continue;
			const schema = mediaObj.schema ?? {};
			fullLines.push(`  (${mediaType}): ${schemaSummary(schema)}`);
		}
	}

	const responses = endpoint.responses ?? {};
	if (Object.keys(responses).length > 0) {
		fullLines.push("Responses:");
		for (const [status, resp] of Object.entries(responses)) {
			if (!resp || typeof resp !== "object") continue;
			const desc = resp.description ?? "";
			const content = resp.content ?? {};
			let schemaStr = "";
			let fullSchemaStr = "";
			for (const mediaObj of Object.values(content)) {
				if (mediaObj && typeof mediaObj === "object") {
					const schema = mediaObj.schema ?? {};
					schemaStr = schemaSummary(schema);
					fullSchemaStr = fullSchemaToStr(schema);
					break;
				}
			}
			let line = `  ${status}: ${desc}`;
			if (schemaStr) line += ` — ${schemaStr}`;
			fullLines.push(line);
			if (fullSchemaStr && fullSchemaStr !== schemaStr) {
				fullLines.push(`    Schema: ${fullSchemaStr}`);
			}
		}
	}

	const fullText = fullLines.join("\n");

	// ── Embedding text (short, semantic) ──────────────────────────
	const embedParts: string[] = [`${method} ${path}`];
	if (endpoint.summary) embedParts.push(endpoint.summary);
	if (endpoint.tags.length > 0) embedParts.push(endpoint.tags.join(", "));
	if (endpoint.description) {
		const firstSentence = endpoint.description.split(". ")[0].split(".\n")[0];
		embedParts.push(firstSentence);
	}
	if (params.length > 0) {
		const paramNames = params
			.filter((p): p is typeof p & { name: string } => typeof p === "object" && !!p.name)
			.map((p) => p.name);
		if (paramNames.length > 0) {
			embedParts.push(`params: ${paramNames.join(", ")}`);
		}
	}
	const embedText = embedParts.join("\n");

	// ── Metadata ──────────────────────────────────────────────────
	const metadata: Record<string, string> = {
		type: "endpoint",
		method,
		path,
		api: apiName,
		full_text: fullText,
	};
	if (endpoint.operationId) metadata.operation_id = endpoint.operationId;
	if (endpoint.tags.length > 0) metadata.tags = endpoint.tags.join(", ");

	// Store full response schema for exact lookups
	for (const [status, resp] of Object.entries(responses)) {
		if (String(status).startsWith("2") && resp && typeof resp === "object") {
			const content = resp.content ?? {};
			for (const mediaObj of Object.values(content)) {
				if (mediaObj && typeof mediaObj === "object") {
					const schema = fullSchemaToStr(mediaObj.schema ?? {});
					if (schema) metadata.response_schema = schema;
				}
			}
			break;
		}
	}

	return [docId, embedText, metadata];
}

// ---------------------------------------------------------------------------
// Schema → Document
// ---------------------------------------------------------------------------

export function schemaToDocument(schema: SchemaDefinition, apiName: string): Document {
	const { name } = schema;
	const docId = `${apiName}:schema:${name}`;

	const lines: string[] = [`Schema: ${name}`];
	if (schema.description) lines.push(`Description: ${schema.description}`);
	if (schema.schemaType) lines.push(`Type: ${schema.schemaType}`);
	if (schema.enum) {
		lines.push(`Enum values: ${schema.enum.map(String).join(", ")}`);
	}

	const props = schema.properties ?? {};
	const requiredSet = new Set(schema.required ?? []);
	if (Object.keys(props).length > 0) {
		lines.push("Properties:");
		for (const [propName, propSchema] of Object.entries(props)) {
			if (!propSchema || typeof propSchema !== "object") continue;
			const req = requiredSet.has(propName) ? "required" : "optional";
			const ptype = (propSchema.type as string) ?? "";
			const desc = (propSchema.description as string) ?? "";
			const enumVals = propSchema.enum as unknown[] | undefined;
			let line = `  - ${propName} (${ptype}, ${req})`;
			if (desc) line += `: ${desc}`;
			if (enumVals) line += ` — one of: ${enumVals.map(String).join(", ")}`;
			lines.push(line);
		}
	}

	const text = lines.join("\n");
	const metadata: Record<string, string> = {
		type: "schema",
		name,
		api: apiName,
	};

	return [docId, text, metadata];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Build a simplified JSON-like object representing the schema shape.
// Returns a serializable object so the frontend can JSON.stringify(schema, null, 2).
function schemaToShape(schema: unknown, depth: number = 0): unknown {
	if (!schema || typeof schema !== "object" || depth > 8) return null;

	const s = schema as Record<string, unknown>;
	const stype = (s.type as string) ?? "";

	if (stype === "array") {
		const itemShape = schemaToShape(s.items, depth + 1);
		return itemShape != null ? [itemShape] : ["unknown"];
	}
	if (stype === "object" || s.properties) {
		const props = (s.properties ?? {}) as Record<string, unknown>;
		if (Object.keys(props).length === 0) return {};
		const obj: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(props)) {
			obj[k] = schemaToShape(v, depth + 1) ?? (stype || "unknown");
		}
		return obj;
	}
	if (stype) return stype;

	for (const combiner of ["allOf", "oneOf", "anyOf"] as const) {
		const parts = s[combiner] as unknown[] | undefined;
		if (parts) {
			const summaries = parts
				.filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
				.map((p) => schemaToShape(p, depth + 1))
				.filter(Boolean);
			if (summaries.length === 1) return summaries[0];
			return { [`${combiner}`]: summaries };
		}
	}

	return null;
}

function fullSchemaToStr(schema: unknown, depth: number = 0): string {
	const shape = schemaToShape(schema, depth);
	if (shape == null) return "";
	if (typeof shape === "string") return shape;
	try {
		return JSON.stringify(shape, null, 2);
	} catch {
		return "";
	}
}

function schemaSummary(schema: unknown, depth: number = 0): string {
	if (!schema || typeof schema !== "object" || depth > 2) return "";

	const s = schema as Record<string, unknown>;
	const stype = (s.type as string) ?? "";

	if (stype === "array") {
		const items = s.items ?? {};
		return `array of ${schemaSummary(items, depth + 1)}`;
	}
	if (stype === "object" || s.properties) {
		const props = (s.properties ?? {}) as Record<string, unknown>;
		if (Object.keys(props).length === 0) return "object";
		const keys = Object.keys(props);
		const preview = keys.slice(0, 6).join(", ");
		const suffix = keys.length > 6 ? ", ..." : "";
		return `{ ${preview}${suffix} }`;
	}
	if (stype) return stype;

	for (const combiner of ["allOf", "oneOf", "anyOf"] as const) {
		const parts = s[combiner] as unknown[] | undefined;
		if (parts) {
			const summaries = parts
				.filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
				.map((p) => schemaSummary(p, depth + 1))
				.filter(Boolean);
			return `${combiner}(${summaries.join(", ")})`;
		}
	}

	return JSON.stringify(schema).slice(0, 80);
}
