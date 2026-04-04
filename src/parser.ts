import fs from "fs/promises";
import path from "path";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import YAML from "yaml";

import { SpecLoadError } from "./errors";
import type { Endpoint, Parameter, SchemaDefinition } from "../types/openapi";

// ---------------------------------------------------------------------------
// Spec Loading
// ---------------------------------------------------------------------------

export async function loadSpec(source: string): Promise<Record<string, unknown>> {
	let data: Record<string, unknown>;

	try {
		if (source.startsWith("http://") || source.startsWith("https://")) {
			const response = await fetch(source, {
				signal: AbortSignal.timeout(30000),
				redirect: "follow",
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}
			const raw = await response.text();
			const contentType = response.headers.get("content-type") ?? "";

			if (source.endsWith(".json") || contentType.startsWith("application/json")) {
				data = JSON.parse(raw);
			} else {
				data = YAML.parse(raw);
			}
		} else {
			const raw = await fs.readFile(path.resolve(source), "utf-8");
			if (source.endsWith(".json")) {
				data = JSON.parse(raw);
			} else {
				data = YAML.parse(raw);
			}
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SpecLoadError(source, message);
	}

	try {
		const resolved = await $RefParser.dereference(data);
		return resolved as Record<string, unknown>;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SpecLoadError(source, `$ref resolution failed: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// Endpoint Extraction
// ---------------------------------------------------------------------------

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

export function extractEndpoints(spec: Record<string, unknown>): Endpoint[] {
	const endpoints: Endpoint[] = [];
	const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;

	for (const [pathStr, pathItem] of Object.entries(paths)) {
		if (!pathItem || typeof pathItem !== "object") continue;

		const pathLevelParams = (pathItem.parameters ?? []) as Parameter[];

		for (const method of HTTP_METHODS) {
			const operation = pathItem[method];
			if (!operation || typeof operation !== "object") continue;

			const op = operation as Record<string, unknown>;
			const opParams = (op.parameters ?? []) as Parameter[];
			const mergedParams = mergeParameters(pathLevelParams, opParams);

			endpoints.push({
				method: method.toUpperCase(),
				path: pathStr,
				operationId: (op.operationId as string) ?? "",
				summary: (op.summary as string) ?? "",
				description: (op.description as string) ?? "",
				tags: (op.tags as string[]) ?? [],
				parameters: mergedParams,
				requestBody: op.requestBody as Endpoint["requestBody"],
				responses: (op.responses ?? {}) as Endpoint["responses"],
			});
		}
	}

	return endpoints;
}

// ---------------------------------------------------------------------------
// Schema Extraction
// ---------------------------------------------------------------------------

export function extractSchemas(spec: Record<string, unknown>): SchemaDefinition[] {
	const schemas: SchemaDefinition[] = [];

	let rawSchemas: Record<string, Record<string, unknown>> = {};
	const components = spec.components as Record<string, unknown> | undefined;
	const definitions = spec.definitions as Record<string, Record<string, unknown>> | undefined;

	if (components) {
		rawSchemas = (components.schemas ?? {}) as Record<string, Record<string, unknown>>;
	} else if (definitions) {
		rawSchemas = definitions;
	}

	for (const [name, schema] of Object.entries(rawSchemas)) {
		if (!schema || typeof schema !== "object") continue;

		schemas.push({
			name,
			description: (schema.description as string) ?? "",
			properties: (schema.properties ?? {}) as Record<string, Record<string, unknown>>,
			required: (schema.required ?? []) as string[],
			schemaType: (schema.type as string) ?? "object",
			enum: schema.enum as unknown[] | undefined,
		});
	}

	return schemas;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mergeParameters(pathParams: Parameter[], opParams: Parameter[]): Parameter[] {
	const merged = new Map<string, Parameter>();

	for (const p of pathParams) {
		if (p && typeof p === "object") {
			const key = `${p.in ?? ""}:${p.name ?? ""}`;
			merged.set(key, p);
		}
	}
	for (const p of opParams) {
		if (p && typeof p === "object") {
			const key = `${p.in ?? ""}:${p.name ?? ""}`;
			merged.set(key, p);
		}
	}

	return Array.from(merged.values());
}
