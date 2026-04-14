"use client";

import { GitBranch } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ForkContextProps {
	parentName: string;
	excerpt: string;
}

const FORK_EXCERPT_MAX = 400;

// strip fenced code blocks (too bulky for a preview) but preserve newlines so
// lists, headings, etc. still render as markdown
const prepareExcerpt = (text: string, max: number): string => {
	const cleaned = text.replace(/```[\s\S]*?```/g, "[code]").trim();
	return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max).trimEnd()}…`;
};

/**
 * Read-only banner shown at the top of a branch conversation. Displays which
 * parent conversation (and which response) this branch was forked from.
 */
export const ForkContext = ({ parentName, excerpt }: ForkContextProps): JSX.Element => {
	const body = prepareExcerpt(excerpt, FORK_EXCERPT_MAX);
	return (
		<div
			className="mx-6 mt-6 mb-2 rounded-md border-l-2 bg-(--g-accent-dim) px-3 py-2.5"
			style={{ borderLeftColor: "var(--g-accent)" }}
		>
			<div className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-(--g-accent)">
				<GitBranch size={11} strokeWidth={2.2} />
				Forked from {parentName}
			</div>
			<div className="text-[0.8125rem] leading-[1.5] text-(--g-text-muted) [&_p]:my-1 [&_ol]:my-1 [&_ul]:my-1 [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-5 [&_ul]:pl-5 [&_li]:my-0.5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-(--g-surface-hover) [&_code]:text-[0.75rem] [&_code]:font-mono [&_strong]:font-semibold [&_strong]:text-(--g-text) [&_a]:underline">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
			</div>
		</div>
	);
};

export default ForkContext;
