"use server";

import fs from "node:fs";
import path from "node:path";

import config from "@greg/shared/core/config";
import { GREG_PROMPT, VERBOSE_PROMPT, CURT_PROMPT, CASUAL_PROMPT } from "@greg/shared/chat";

import { getRetriever } from "@/lib/retriever";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelInfo {
	id: string;
	name: string;
	provider: "anthropic" | "ollama";
}

const ANTHROPIC_MODELS: ModelInfo[] = [
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
];

/**
 * Returns available LLM models from Anthropic (if key configured) and
 * Ollama (if URL configured).
 */
export const listModels = async (): Promise<ModelInfo[]> => {
	const models: ModelInfo[] = [];

	if (config.ANTHROPIC_API_KEY) {
		models.push(...ANTHROPIC_MODELS);
	}

	if (config.OLLAMA_URL) {
		try {
			const res = await fetch(`${config.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
			if (res.ok) {
				const data = await res.json() as { models: Array<{ name: string }> };
				for (const m of data.models ?? []) {
					models.push({ id: m.name, name: m.name, provider: "ollama" });
				}
			}
		} catch {
			// Ollama not available
		}
	}

	return models;
};

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const SUGGESTION_POOL = [
	"list all devices detected by Armis",
	"get Darktrace model breach alerts",
	"list UniFi access points and their status",
	"get MikroTik firewall rules via API",
	"list Microsoft Graph users in a tenant",
	"get Intune managed device compliance status",
	"list all Proxmox VMs and their state",
	"list ZeroTier network members",
	"create a ZeroTier network",
	"send a chat completion with OpenAI",
	"create a message with the Anthropic API",
	"get UniFi controller site statistics",
	"search Armis devices by type or risk score",
	"get a user's details from Microsoft Graph",
	"list Proxmox storage pools",
	"get Darktrace device summary",
	"how do I authenticate with the API?",
	"how do I paginate through results?",
	"how can I filter devices by risk score?",
	"how can I create a new resource via the API?",
];

/**
 * Returns 4 randomly shuffled suggestions from the suggestion pool.
 */
export const fetchSuggestions = async (): Promise<string[]> => {
	const shuffled = [...SUGGESTION_POOL].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, 4);
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * Returns all built-in system prompt strings for the available personalities.
 */
export const getPrompts = async (): Promise<{ greg: string; verbose: string; curt: string; casual: string }> => {
	return { greg: GREG_PROMPT, verbose: VERBOSE_PROMPT, curt: CURT_PROMPT, casual: CASUAL_PROMPT };
};

// ---------------------------------------------------------------------------
// Greeting GIF
// ---------------------------------------------------------------------------

/**
 * Fetches a random greeting GIF from Giphy. Returns `{ url: null }` if the
 * API key is not configured or the request fails.
 */
export const getGreetingGif = async (): Promise<{ url: string | null }> => {
	if (!config.GIPHY_API_KEY) return { url: null };
	try {
		const queries = ["cat hello", "cat wave", "cat greeting", "anime hello", "cat hi"];
		const q = encodeURIComponent(queries[Math.floor(Math.random() * queries.length)]!);
		const res = await fetch(
			`https://api.giphy.com/v1/stickers/search?api_key=${config.GIPHY_API_KEY}&q=${q}&limit=10&rating=g&lang=en`,
			{ signal: AbortSignal.timeout(5000) },
		);
		if (!res.ok) return { url: null };
		const data = await res.json() as { data: Array<{ images: { original: { url: string } } }> };
		const match = data.data?.[Math.floor(Math.random() * (data.data?.length ?? 1))];
		return { url: match?.images?.original?.url ?? null };
	} catch {
		return { url: null };
	}
};

// ---------------------------------------------------------------------------
// Chat title
// ---------------------------------------------------------------------------

/**
 * Generates a short 4–6 word title for a chat from the opening prompt.
 * Tries Ollama first, then Anthropic. Falls back to a truncated version of
 * the prompt if both are unavailable or fail.
 *
 * @param prompt - The user's first message in the chat
 */
export const generateTitle = async (prompt: string): Promise<{ title: string }> => {
	const fallback = { title: prompt.slice(0, 50) };
	const instruction = `Summarize this in 4-6 words as a chat title. Reply with ONLY the title, no punctuation:\n\n${prompt}`;

	// Try Ollama first
	if (config.OLLAMA_URL) {
		try {
			const model = config.OLLAMA_CHAT_SUMMARY_MODEL || config.LLM_MODEL;
			const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: instruction }],
					stream: false,
				}),
				signal: AbortSignal.timeout(10_000),
			});
			if (res.ok) {
				const data = await res.json() as { message: { content: string } };
				const title = data.message?.content?.trim().slice(0, 60);
				if (title) return { title };
			}
		} catch {
			// fallthrough to Anthropic
		}
	}

	// Try Anthropic
	if (config.ANTHROPIC_API_KEY) {
		try {
			const { default: Anthropic } = await import("@anthropic-ai/sdk");
			const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
			const msg = await client.messages.create({
				model: "claude-haiku-4-5-20251001",
				max_tokens: 32,
				messages: [{ role: "user", content: instruction }],
			});
			const text = msg.content.find((b: { type: string }) => b.type === "text");
			const title = (text as { text?: string } | undefined)?.text?.trim().slice(0, 60);
			if (title) return { title };
		} catch {
			// fallthrough
		}
	}

	return fallback;
};

// ---------------------------------------------------------------------------
// Spec file listing (for SettingsPage ingest suggestions)
// ---------------------------------------------------------------------------

const SPECS_DIR = process.env.SPECS_DIR ?? path.resolve(process.cwd(), "../../specs");

/**
 * Lists all YAML/JSON spec files in the specs directory, annotating each
 * entry with a human-readable file-size label.
 */
export const listSpecFiles = async (): Promise<Array<{ url: string; name: string }>> => {
	if (!fs.existsSync(SPECS_DIR)) return [];
	const SIZE_WARN_BYTES = 10 * 1024 * 1024;
	const entries = fs.readdirSync(SPECS_DIR).sort();
	const specs: Array<{ url: string; name: string }> = [];

	for (const filename of entries) {
		const ext = path.extname(filename);
		if (![".yaml", ".yml", ".json"].includes(ext)) continue;
		const name = path.basename(filename, ext);
		const filePath = path.join(SPECS_DIR, filename);
		const size = fs.statSync(filePath).size;
		let label: string;
		if (size > SIZE_WARN_BYTES) {
			label = `${name} (${Math.floor(size / (1024 * 1024))} MB - large)`;
		} else if (size > 1024 * 1024) {
			label = `${name} (${(size / (1024 * 1024)).toFixed(1)} MB)`;
		} else {
			label = `${name} (${Math.round(size / 1024)} KB)`;
		}
		specs.push({ url: `/openapi/specs/${filename}`, name: label });
	}
	return specs;
};
