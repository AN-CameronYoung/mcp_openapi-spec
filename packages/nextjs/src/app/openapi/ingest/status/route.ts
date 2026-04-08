import { autoIngestEvents, autoIngestState, getRetriever } from "@/lib/retriever";
import type { AutoIngestEvent } from "@/lib/retriever";

export const dynamic = "force-dynamic";

/**
 * SSE endpoint that streams auto-ingest progress events to the client.
 *
 * Late-connecting clients receive a replay of the current state snapshot
 * before subscribing to future events.
 */
export const GET = async (): Promise<Response> => {
	// Ensure the retriever singleton (and auto-ingest) is initialized
	getRetriever();
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const enc = new TextEncoder();

	const send = (data: AutoIngestEvent): Promise<void> =>
		writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});

	const handler = (event: AutoIngestEvent): void => {
		send(event);
		if (event.type === "complete") {
			cleanup();
		}
	};

	const cleanup = (): void => {
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
				send({ type: "spec-done", name: spec.name, endpoints: spec.endpoints ?? 0, schemas: spec.schemas ?? 0 });
			} else if (spec.status === "error") {
				send({ type: "spec-error", name: spec.name, message: spec.message });
			} else if (spec.status === "running") {
				send({ type: "spec-start", name: spec.name });
				send({ type: "spec-progress", name: spec.name, message: spec.message, done: spec.done ?? 0, total: spec.total ?? 0 });
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
				send({ type: "spec-done", name: spec.name, endpoints: spec.endpoints ?? 0, schemas: spec.schemas ?? 0 });
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
};
