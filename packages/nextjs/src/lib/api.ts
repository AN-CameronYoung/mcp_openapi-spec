// ---------------------------------------------------------------------------
// Re-export server actions (called from client components)
// ---------------------------------------------------------------------------

export { searchEndpoints, searchSchemas, getEndpoint, listEndpoints } from "@/actions/search";
export { listApis, deleteApi } from "@/actions/apis";
export { listDocs, deleteDoc, searchDocs, listProjects, searchAll, getDocContent } from "@/actions/docs";
export { listModels, fetchSuggestions, generateTitle, getGreetingGif, getPrompts, listSpecFiles, generateFollowUpSuggestions } from "@/actions/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { SearchResult, ProjectInfo } from "@/lib/formatters";
export type { ApiInfo } from "#types/store";
export type { DocInfo } from "#types/doc";
import type { Personality } from "@greg/shared/chat";
export type { Personality };

export interface EndpointCard {
	method: string;
	path: string;
	api: string;
	description: string;
	score: number;
	full_text: string;
	response_schema: string;
	warnings?: string;
}

export interface DocCard {
	doc_name: string;
	heading: string;
	heading_path: string;
	project: string;
	snippet: string;
	score: number;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
}

export interface ChatSSEEvent {
	type: "text" | "endpoints" | "docs" | "followups" | "done" | "error" | "verification_text" | "verification_done" | "debug";
	text?: string;
	data?: EndpointCard[];
	docCards?: DocCard[];
	followups?: string[];
	error?: string;
	model?: string;
	provider?: string;
	event?: string;
	usage?: { input: number; output: number };
	verificationUsage?: { input: number; output: number };
}

// ---------------------------------------------------------------------------
// SSE streaming chat (still uses fetch — server actions can't stream)
// ---------------------------------------------------------------------------

export async function* streamChat(
	messages: ChatMessage[],
	personality: Personality,
	opts?: { systemPrompt?: string; model?: string; provider?: string; doubleCheck?: boolean },
	signal?: AbortSignal,
): AsyncGenerator<ChatSSEEvent> {
	const body: Record<string, unknown> = { messages, personality };
	if (opts?.systemPrompt) body.system_prompt = opts.systemPrompt;
	if (opts?.model) body.model = opts.model;
	if (opts?.provider) body.provider = opts.provider;
	if (opts?.doubleCheck) body.double_check = true;

	const res = await fetch("/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});

	if (!res.ok || !res.body) {
		yield { type: "error", error: `Chat failed: ${res.status}` };
		return;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.startsWith("data: ")) continue;
			try {
				const event: ChatSSEEvent = JSON.parse(line.slice(6));
				yield event;
			} catch {
				// skip malformed
			}
		}
	}
}
