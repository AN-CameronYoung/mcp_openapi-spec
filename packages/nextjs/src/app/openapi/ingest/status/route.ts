import { autoIngestEvents, autoIngestState, getRetriever } from "@/lib/retriever";
import type { AutoIngestEvent } from "@/lib/retriever";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	// Ensure the retriever singleton (and auto-ingest) is initialized
	getRetriever();
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const enc = new TextEncoder();

	const send = (data: AutoIngestEvent) =>
		writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});

	const handler = (event: AutoIngestEvent) => {
		send(event);
		if (event.type === "complete") {
			cleanup();
		}
	};

	const cleanup = () => {
		autoIngestEvents.removeListener("event", handler);
		writer.close().catch(() => {});
	};

	// Send current state snapshot so late-connecting clients catch up
	if (autoIngestState.active && autoIngestState.specs.length > 0) {
		// Replay: send start event with all spec names
		send({ type: "start", specs: autoIngestState.specs.map((s) => s.name) });
		// Send current status for each spec
		for (const spec of autoIngestState.specs) {
			if (spec.status === "done") {
				send({ type: "spec-done", name: spec.name, endpoints: spec.endpoints, schemas: spec.schemas });
			} else if (spec.status === "error") {
				send({ type: "spec-error", name: spec.name, message: spec.message });
			} else if (spec.status === "running") {
				send({ type: "spec-start", name: spec.name });
				send({ type: "spec-progress", name: spec.name, message: spec.message, done: spec.done, total: spec.total });
			}
			// "pending" specs don't need an event — they're already pending from the start event
		}
		// Subscribe for future events
		autoIngestEvents.on("event", handler);
	} else if (!autoIngestState.active && autoIngestState.specs.length > 0) {
		// Already finished — send the final state
		send({ type: "start", specs: autoIngestState.specs.map((s) => s.name) });
		for (const spec of autoIngestState.specs) {
			if (spec.status === "done") {
				send({ type: "spec-done", name: spec.name, endpoints: spec.endpoints, schemas: spec.schemas });
			} else if (spec.status === "error") {
				send({ type: "spec-error", name: spec.name, message: spec.message });
			}
		}
		send({ type: "complete" });
		writer.close().catch(() => {});
	} else {
		// No auto-ingest has happened or nothing to ingest — subscribe for future events
		autoIngestEvents.on("event", handler);
	}

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
