import type { DocMeta, DocCategory, DocStatus, DocAudience } from "#types/doc";
import type { Document, SourceType } from "#types/store";

// ---------------------------------------------------------------------------
// Meta parsing
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<DocCategory>(["guide", "reference", "tutorial", "changelog", "runbook"]);
const VALID_STATUSES = new Set<DocStatus>(["draft", "published", "deprecated"]);
const VALID_AUDIENCES = new Set<DocAudience>(["developer", "ops", "end-user"]);

/**
 * Parses the `# Meta` header from a raw markdown document.
 * Returns the parsed metadata and the remaining body text.
 */
export const parseMeta = (raw: string): { meta: DocMeta; body: string } => {
	const lines = raw.split("\n");

	// First line must be "# Meta"
	if (!lines[0]?.match(/^#\s*Meta\s*$/)) {
		throw new Error("Document must start with a '# Meta' section");
	}

	// Collect meta lines until the next heading (any level) or end of file
	const metaLines: string[] = [];
	let bodyStartIdx = lines.length;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]!.match(/^#+\s/)) {
			bodyStartIdx = i;
			break;
		}
		metaLines.push(lines[i]!);
	}

	const metaBlock = metaLines.join("\n");
	const body = lines.slice(bodyStartIdx).join("\n").trim();

	const fields = new Map<string, string>();
	for (const line of metaBlock.split("\n")) {
		const match = line.match(/^(\w[\w_]*):\s*(.+)$/);
		if (match) fields.set(match[1]!.toLowerCase(), match[2]!.trim());
	}

	const required = (name: string): string => {
		const val = fields.get(name);
		if (!val) throw new Error(`Missing required meta field: ${name}`);
		return val;
	};

	const title = required("title");
	const author = required("author");
	const category = required("category") as DocCategory;
	if (!VALID_CATEGORIES.has(category)) {
		throw new Error(`Invalid category '${category}'. Must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
	}
	const tagsRaw = required("tags");
	const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
	const project = required("project");

	const statusRaw = (fields.get("status") ?? "published") as DocStatus;
	if (!VALID_STATUSES.has(statusRaw)) {
		throw new Error(`Invalid status '${statusRaw}'. Must be one of: ${[...VALID_STATUSES].join(", ")}`);
	}

	const audienceRaw = (fields.get("audience") ?? "developer") as DocAudience;
	if (!VALID_AUDIENCES.has(audienceRaw)) {
		throw new Error(`Invalid audience '${audienceRaw}'. Must be one of: ${[...VALID_AUDIENCES].join(", ")}`);
	}

	const meta: DocMeta = {
		title,
		author,
		category,
		tags,
		project,
		status: statusRaw,
		audience: audienceRaw,
	};

	const version = fields.get("version");
	if (version) meta.version = version;

	const apiRefs = fields.get("api_refs");
	if (apiRefs) {
		meta.apiRefs = apiRefs.split(",").map((r) => r.trim()).filter(Boolean);
	}

	return { meta, body };
};

// ---------------------------------------------------------------------------
// Doc → Documents
// ---------------------------------------------------------------------------

// Maximum characters sent to the embedding model per chunk.
// docStore.ts overrides num_ctx to 8 192 for Ollama, so models that support long
// contexts (e.g. snowflake-arctic-embed2) will use the larger window automatically.
// 4 096 chars at ~1-2 chars/token fits comfortably within the 8 192-token override.
const MAX_EMBED_CHARS = 4096;

const slugify = (text: string): string =>
	text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Splits a markdown document body into Document tuples by H1/H2/H3 headings.
 * Each chunk gets its own ID, embed text (heading path + content), and metadata.
 */
export const docToDocuments = (raw: string, docName: string, sourceType?: SourceType): Document[] => {
	const { meta, body } = parseMeta(raw);
	if (!body) return [];

	const sections = splitByHeadings(cleanPdfArtifacts(body));
	const documents: Document[] = [];
	const headingPath: string[] = [];

	for (let i = 0; i < sections.length; i++) {
		const section = sections[i]!;
		const { heading, level, content } = section;

		// Maintain heading path for breadcrumb
		if (heading) {
			// Pop headings at same or deeper level
			while (headingPath.length >= level) headingPath.pop();
			headingPath.push(heading);
		}

		const trimmed = content.trim();
		if (!trimmed && !heading) continue;

		const pathSlug = headingPath.map(slugify).join("--");
		const docId = `doc:${docName}:${i}:${pathSlug || `section-${i}`}`;

		// Embed text: breadcrumb + content, capped so large sections don't exceed
		// the embedding model's context window (most models cap around 512–8192 tokens).
		const breadcrumb = headingPath.join(" > ");
		const rawEmbed = breadcrumb ? `${breadcrumb}\n${trimmed}` : trimmed;
		const embedText = rawEmbed.length > MAX_EMBED_CHARS ? rawEmbed.slice(0, MAX_EMBED_CHARS) : rawEmbed;

		const metadata: Record<string, string> = {
			type: "doc",
			doc_name: docName,
			chunk_index: String(i),
			full_text: trimmed,
			project: meta.project,
			title: meta.title,
			author: meta.author,
			category: meta.category,
			tags: meta.tags.join(","),
			status: meta.status,
			audience: meta.audience,
		};

		if (heading) {
			metadata.heading = heading;
			metadata.heading_level = String(level);
			metadata.heading_path = breadcrumb;
		}
		if (meta.version) metadata.version = meta.version;
		if (meta.apiRefs) metadata.api_refs = meta.apiRefs.join(",");
		if (sourceType) metadata.source_type = sourceType;

		documents.push([docId, embedText, metadata]);
	}

	return documents;
};

// ---------------------------------------------------------------------------
// PDF artifact cleanup
// ---------------------------------------------------------------------------

/**
 * Removes repeated page-header/footer lines that appear in PDF-converted markdown.
 * Strategy: any non-empty line that appears ≥ 3 times as an isolated line (i.e. has a
 * blank line on at least one side) is treated as a page header/footer and removed,
 * along with any immediately following page-number line (digits or roman numerals only).
 * Also strips image-placeholder lines from PDF converters.
 */
const cleanPdfArtifacts = (body: string): string => {
	const lines = body.split("\n");

	// Count how many times each non-empty trimmed line appears as an isolated line.
	const counts = new Map<string, number>();
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i]!.trim();
		if (!t) continue;
		const prevBlank = i === 0 || lines[i - 1]!.trim() === "";
		const nextBlank = i === lines.length - 1 || lines[i + 1]!.trim() === "";
		if (prevBlank || nextBlank) {
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
	}

	// Lines that repeat 3+ times are repeating headers/footers (page artifacts).
	const artifacts = new Set(
		[...counts.entries()].filter(([, n]) => n >= 3).map(([l]) => l),
	);

	if (artifacts.size === 0) return body;

	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const t = raw.trim();

		// Strip PDF image placeholder lines regardless of repetition.
		if (/^==>.*intentionally omitted.*<==$/i.test(t) ||
			/^\*\*==>.*intentionally omitted.*<==\*\*$/.test(t)) {
			while (out.length && out[out.length - 1]!.trim() === "") out.pop();
			continue;
		}

		if (artifacts.has(t)) {
			// Also skip the very next line if it looks like a page number
			// (pure digits or roman numerals, possibly with trailing spaces).
			const next = lines[i + 1]?.trim();
			if (next && /^[ivxlcdmIVXLCDM\d]+$/.test(next)) i++;
			// Drop any trailing blank lines we already emitted for this artifact.
			while (out.length && out[out.length - 1]!.trim() === "") out.pop();
			continue;
		}

		out.push(raw);
	}

	// Collapse runs of more than 2 consecutive blank lines down to 2.
	const collapsed: string[] = [];
	let blanks = 0;
	for (const line of out) {
		if (line.trim() === "") {
			blanks++;
			if (blanks <= 2) collapsed.push(line);
		} else {
			blanks = 0;
			collapsed.push(line);
		}
	}

	return collapsed.join("\n");
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Section {
	heading: string | null;
	level: number;
	content: string;
}

/**
 * Splits markdown body text into sections based on H1/H2/H3 headings.
 */
const splitByHeadings = (body: string): Section[] => {
	const lines = body.split("\n");
	const sections: Section[] = [];
	let currentHeading: string | null = null;
	let currentLevel = 0;
	let currentLines: string[] = [];

	const flush = () => {
		const content = currentLines.join("\n");
		if (currentHeading || content.trim()) {
			sections.push({ heading: currentHeading, level: currentLevel, content });
		}
		currentLines = [];
	};

	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			flush();
			currentLevel = headingMatch[1]!.length;
			currentHeading = headingMatch[2]!.trim();
		} else {
			currentLines.push(line);
		}
	}
	flush();

	return sections;
};
