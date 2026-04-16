/**
 * Split a markdown string into pages at H1/H2 heading boundaries.
 * Never cuts mid-section — a heading always starts a new page.
 * If a single section exceeds the limit it becomes one oversized page.
 * Returns a single-element array when content fits on one page (caller
 * hides pagination UI when pages.length === 1).
 */
export function splitIntoPages(content: string, limit: number): string[] {
	const lines = content.split("\n");
	const pages: string[] = [];
	let start = 0;
	let charCount = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (/^#{1,2} /.test(line) && charCount >= limit && i > start) {
			pages.push(lines.slice(start, i).join("\n"));
			start = i;
			charCount = 0;
		}
		charCount += line.length + 1;
	}
	if (start < lines.length) pages.push(lines.slice(start).join("\n"));
	return pages.length > 0 ? pages : [""];
}

// 40 000 chars ≈ 550–650 lines of prose — renders in <100ms.
// Gives ~30 pages for Proxmox (1.2 MB) and ~18 for Darktrace (740 KB).
export const PAGE_LIMIT = 40_000;
