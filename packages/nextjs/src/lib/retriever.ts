import Retriever from "@greg/shared/core/retriever";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Use globalThis to ensure singletons survive module re-evaluation (Turbopack)
// ---------------------------------------------------------------------------

interface AutoIngestGlobals {
	__retriever?: Retriever;
	__autoIngestDone?: boolean;
	__autoIngestEvents?: EventEmitter;
	__autoIngestState?: AutoIngestState;
}

const g = globalThis as unknown as AutoIngestGlobals;

// ---------------------------------------------------------------------------
// Auto-ingest types & shared state
// ---------------------------------------------------------------------------

export interface AutoIngestEvent {
	type: "start" | "spec-start" | "spec-progress" | "spec-done" | "spec-error" | "complete";
	specs?: string[];
	name?: string;
	message?: string;
	done?: number;
	total?: number;
	endpoints?: number;
	schemas?: number;
}

export interface AutoIngestState {
	active: boolean;
	specs: Array<{ name: string; status: "pending" | "running" | "done" | "error"; message: string; done?: number; total?: number; endpoints?: number; schemas?: number }>;
}

if (!g.__autoIngestEvents) {
	g.__autoIngestEvents = new EventEmitter();
	g.__autoIngestEvents.setMaxListeners(50);
}
if (!g.__autoIngestState) {
	g.__autoIngestState = { active: false, specs: [] };
}

export const autoIngestEvents: EventEmitter = g.__autoIngestEvents;
export const autoIngestState: AutoIngestState = g.__autoIngestState;

// ---------------------------------------------------------------------------
// Retriever singleton
// ---------------------------------------------------------------------------

export function getRetriever(): Retriever {
	if (!g.__retriever) {
		g.__retriever = new Retriever();
		if (!g.__autoIngestDone) {
			g.__autoIngestDone = true;
			void autoIngestSpecs(g.__retriever);
		}
	}
	return g.__retriever;
}

// ---------------------------------------------------------------------------
// Auto-ingest
// ---------------------------------------------------------------------------

async function autoIngestSpecs(retriever: Retriever): Promise<void> {
	const SPECS_DIR = process.env.SPECS_DIR ?? path.resolve(process.cwd(), "../../specs");
	if (!fs.existsSync(SPECS_DIR)) return;

	try {
		const indexed = new Set((await retriever.listApis()).map((a) => a.name));
		const entries = fs.readdirSync(SPECS_DIR).sort();

		const toIngest: string[] = [];
		for (const filename of entries) {
			const ext = path.extname(filename);
			if (![".yaml", ".yml", ".json"].includes(ext)) continue;
			const apiName = path.basename(filename, ext);
			if (!indexed.has(apiName)) toIngest.push(filename);
		}

		if (toIngest.length === 0) return;

		const specNames = toIngest.map((f) => path.basename(f, path.extname(f)));

		// Initialize server-side state snapshot
		autoIngestState.active = true;
		autoIngestState.specs = specNames.map((n) => ({ name: n, status: "pending", message: "" }));

		autoIngestEvents.emit("event", { type: "start", specs: specNames } as AutoIngestEvent);

		for (const filename of toIngest) {
			const ext = path.extname(filename);
			const apiName = path.basename(filename, ext);
			const filePath = path.join(SPECS_DIR, filename);

			const specState = autoIngestState.specs.find((s) => s.name === apiName);
			if (specState) { specState.status = "running"; specState.message = "Starting..."; }

			autoIngestEvents.emit("event", { type: "spec-start", name: apiName } as AutoIngestEvent);
			console.log(`[auto-ingest] ingesting ${filename} as '${apiName}' ...`);

			try {
				const summary = await retriever.ingest(filePath, apiName, (e) => {
					if (specState) { specState.message = e.message ?? ""; specState.done = e.done; specState.total = e.total; }
					autoIngestEvents.emit("event", {
						type: "spec-progress",
						name: apiName,
						message: e.message,
						done: e.done,
						total: e.total,
					} as AutoIngestEvent);
					if (e.phase === "embedding" || e.phase === "storing") {
						if (e.done === e.total || (e.done ?? 0) % 500 === 0) {
							console.log(`[auto-ingest] ${apiName}: ${e.phase} ${e.done}/${e.total}`);
						}
					} else {
						console.log(`[auto-ingest] ${apiName}: ${e.message}`);
					}
				}, { skipDelete: true });

				if (specState) { specState.status = "done"; specState.message = `${summary.endpointsIngested} endpoints, ${summary.schemasIngested} schemas`; specState.endpoints = summary.endpointsIngested; specState.schemas = summary.schemasIngested; }
				autoIngestEvents.emit("event", {
					type: "spec-done",
					name: apiName,
					endpoints: summary.endpointsIngested,
					schemas: summary.schemasIngested,
				} as AutoIngestEvent);
				console.log(`[auto-ingest] ${apiName}: done — ${summary.endpointsIngested} endpoints, ${summary.schemasIngested} schemas`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (specState) { specState.status = "error"; specState.message = msg; }
				autoIngestEvents.emit("event", { type: "spec-error", name: apiName, message: msg } as AutoIngestEvent);
				console.error(`[auto-ingest] ${filename}:`, msg);
			}
		}

		autoIngestState.active = false;
		autoIngestEvents.emit("event", { type: "complete" } as AutoIngestEvent);
	} catch {
		autoIngestState.active = false;
		autoIngestEvents.emit("event", { type: "complete" } as AutoIngestEvent);
	}
}
