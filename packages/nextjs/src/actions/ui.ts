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
	"How do I get a list of all devices and their risk scores from Armis?",
	"How do I retrieve AI Analyst incidents from Darktrace?",
	"How do I find similar devices by behavioural profile in Darktrace?",
	"How do I list all WLAN configurations for a UniFi site?",
	"How do I create a new SSID on a UniFi controller?",
	"How do I read active firewall connections from MikroTik?",
	"How do I manage firewall filter rules via the MikroTik API?",
	"How do I list all VMs on a Proxmox node?",
	"How do I check VM migration eligibility in Proxmox?",
	"How do I list members of a ZeroTier network?",
	"How do I get peer latency and path info from ZeroTier?",
	"How do I send a chat completion request to OpenAI?",
	"How do I create a message with streaming using the Anthropic API?",
	"How do I list a user's group memberships in Microsoft Graph?",
	"How do I query device compliance state via Microsoft Graph?",
	"How do I get connection traffic data for a device in Darktrace?",
	"How do I update a registered device's properties via Microsoft Graph?",
	"How do I list all network configurations for a UniFi site?",
	"How do I retrieve stored chat completions from OpenAI?",
	"How do I check transitive group membership for a user in Microsoft Graph?",

	// Proxmox
	"How do I create a snapshot of a VM in Proxmox?",
	"How do I list all LXC containers across Proxmox nodes?",
	"How do I get current CPU and memory usage for a Proxmox node?",
	"How do I add a firewall rule to a Proxmox cluster?",

	// MikroTik
	"How do I list all DHCP leases from MikroTik?",
	"How do I get interface traffic statistics from MikroTik?",
	"How do I manage static routes via the MikroTik API?",

	// Darktrace
	"How do I look up CVEs affecting a specific device in Darktrace?",
	"How do I get model breach events for a device in Darktrace?",
	"How do I check Darktrace system health and bandwidth usage?",

	// OpenAI / Anthropic
	"How do I create an OpenAI assistant with file search tools?",
	"How do I use tool use with the Anthropic API?",
	"How do I generate embeddings with the OpenAI API?",

	// Cross-API
	"How do I find a device flagged in Darktrace and check if it's enrolled in Microsoft Graph?",
	"How do I correlate an Armis device risk score with its Darktrace behavioural profile?",
	"How do I check which Proxmox VMs are reachable over a ZeroTier network?",
	"How do I use OpenAI to summarise a batch of Darktrace AI Analyst incidents?",
	"How do I look up a user flagged in Darktrace and pull their sign-in details from Microsoft Graph?",
	"How do I find a MikroTik firewall rule that might be blocking a ZeroTier peer connection?",

	// --- Single-API (20) ---

	// Armis
	"How do I search Armis assets by custom criteria and filter by risk level?",
	"How do I bulk update asset properties in Armis?",
	"How do I create and manage sites in Armis?",
	"How do I export device data from Armis for reporting?",

	// Darktrace
	"How do I filter Darktrace model breaches by minimum score threshold?",
	"How do I add and remove tags on a device in Darktrace?",
	"How do I retrieve PCAP data for a specific device from Darktrace?",
	"How do I get a device summary aggregation from Darktrace?",

	// ZeroTier
	"How do I authorise a new member on a ZeroTier network?",
	"How do I configure IP assignment pools for a ZeroTier network?",
	"How do I remove a member from a ZeroTier network via the controller API?",

	// UniFi
	"How do I list all adopted devices on a UniFi Integration site?",
	"How do I create a WiFi broadcast on a UniFi Integration site?",
	"How do I list connected clients on a UniFi device?",
	"How do I manage pending device adoptions via the UniFi Integration API?",

	// Microsoft Graph
	"How do I track incremental device changes using Microsoft Graph delta queries?",
	"How do I retrieve a user's manager relationship from Microsoft Graph?",
	"How do I list all to-do task lists for a user in Microsoft Graph?",

	// Anthropic
	"How do I submit an asynchronous message batch to the Anthropic API?",
	"How do I upload a file and reference it in an Anthropic message?",

	// --- Two-API (20) ---

	// Darktrace + Armis
	"How do I get a device's Darktrace breach history and cross-reference its Armis risk score?",
	"How do I find devices with active Darktrace model breaches and check their Armis asset properties?",

	// Darktrace + ZeroTier
	"How do I identify a device flagged in Darktrace and check if it has an active ZeroTier membership?",
	"How do I pull Darktrace AI Analyst incidents and check whether affected devices are on a ZeroTier network?",

	// Armis + Microsoft Graph
	"How do I find a high-risk Armis asset and look up its owner in Microsoft Graph Users?",
	"How do I list unmanaged Armis devices and check if any are registered in Microsoft Graph Devices?",

	// Proxmox + ZeroTier
	"How do I list Proxmox VMs and verify which ones have joined a specific ZeroTier network?",
	"How do I check a Proxmox node's running VMs and retrieve their ZeroTier peer latency stats?",

	// MikroTik + ZeroTier
	"How do I check MikroTik firewall address lists and confirm they're not blocking ZeroTier member IPs?",
	"How do I retrieve MikroTik interface stats and correlate them with ZeroTier peer connection paths?",

	// UniFi + Darktrace
	"How do I list UniFi devices on a site and check each one for Darktrace model breach events?",
	"How do I find a UniFi device by MAC address and pull its Darktrace connection traffic summary?",

	// OpenAI + Anthropic
	"How do I generate embeddings with OpenAI and then summarise the top results using Anthropic?",
	"How do I run a chat completion with OpenAI and compare the response to one from the Anthropic API?",

	// Microsoft Graph + Proxmox
	"How do I find a disabled Microsoft Graph user and check if they still have running Proxmox VMs?",
	"How do I list Proxmox nodes and verify admin access against Microsoft Graph group memberships?",

	// Armis + UniFi
	"How do I find a device flagged in Armis and locate it by MAC address on a UniFi site?",
	"How do I list UniFi connected clients and check each one's risk profile in Armis?",

	// MikroTik + Microsoft Graph
	"How do I pull MikroTik DHCP leases and look up each IP's owner in Microsoft Graph Users?",
	"How do I check MikroTik user accounts and verify they correspond to active Microsoft Graph identities?",

	// --- Three+ API (10) ---

	"How do I find a Darktrace-flagged device, check its Armis risk score, and look up its owner in Microsoft Graph?",
	"How do I list Proxmox VMs, check their ZeroTier membership, and verify the owners are active in Microsoft Graph?",
	"How do I detect a model breach in Darktrace, find the device in Armis, and block its IP in MikroTik?",
	"How do I get Darktrace AI Analyst incidents, enrich them with Armis asset data, and summarise with the Anthropic API?",
	"How do I find a UniFi device, check for Darktrace breaches, and look up the device owner in Microsoft Graph?",
	"How do I list ZeroTier network members, resolve their IPs against MikroTik DHCP leases, and check for Darktrace activity?",
	"How do I identify a high-risk Armis asset, check its Darktrace breach history, and disable its Microsoft Graph account?",
	"How do I audit Proxmox VM owners by cross-referencing Microsoft Graph users, then check each VM's ZeroTier reachability?",
	"How do I pull UniFi connected clients, look up each in Armis for risk, and flag suspicious ones in Darktrace?",
	"How do I find a MikroTik firewall rule blocking traffic, trace the source device in Darktrace, and check its Armis profile and Microsoft Graph identity?",
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
export const getPrompts = async (): Promise<{ greg: string; explanatory: string; curt: string; casual: string }> => {
	return { greg: GREG_PROMPT, explanatory: VERBOSE_PROMPT, curt: CURT_PROMPT, casual: CASUAL_PROMPT };
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
// Follow-up suggestions
// ---------------------------------------------------------------------------

/**
 * Strips markdown code fences and extracts the first JSON array found in a string.
 */
const extractJsonArray = (raw: string): string[] | null => {
	// Strip ```json ... ``` or ``` ... ``` wrappers
	const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	// Find first [...] block in case of surrounding prose
	const match = stripped.match(/\[[\s\S]*\]/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]) as unknown;
		if (Array.isArray(parsed) && parsed.length >= 4) return (parsed as string[]).slice(0, 4);
	} catch {
		// ignore
	}
	return null;
};

/**
 * Generates 4 contextual follow-up questions based on the last exchange.
 * Uses the provided model/provider when specified; otherwise falls back to
 * Ollama then Anthropic with the default summary model.
 */
export const generateFollowUpSuggestions = async (
	userMsg: string,
	assistantMsg: string,
	opts?: { model?: string; provider?: "anthropic" | "ollama" },
): Promise<string[]> => {
	const instruction = `Based on this exchange, suggest exactly 4 short follow-up questions the user might want to ask next. Return ONLY a JSON array of 4 strings, nothing else.\n\nUser: ${userMsg.slice(0, 400)}\n\nAssistant: ${assistantMsg.slice(0, 600)}`;

	const preferOllama = opts?.provider === "ollama" || (!opts?.provider && !!config.OLLAMA_URL);

	// Try Ollama
	if (preferOllama && config.OLLAMA_URL) {
		try {
			const model = opts?.model ?? config.OLLAMA_CHAT_SUMMARY_MODEL ?? config.LLM_MODEL;
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
				const raw = data.message?.content?.trim();
				if (raw) {
					const result = extractJsonArray(raw);
					if (result) return result;
				}
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
				model: opts?.provider !== "ollama" && opts?.model ? opts.model : "claude-haiku-4-5-20251001",
				max_tokens: 256,
				messages: [{ role: "user", content: instruction }],
			});
			const block = msg.content.find((b: { type: string }) => b.type === "text");
			const raw = (block as { text?: string } | undefined)?.text?.trim();
			if (raw) {
				const result = extractJsonArray(raw);
				if (result) return result;
			}
		} catch {
			// fallthrough
		}
	}

	return [];
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
