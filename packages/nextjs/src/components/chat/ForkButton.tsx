"use client";

import { GitBranch } from "lucide-react";

import { cn } from "../../lib/utils";

interface ForkButtonProps {
	msgIdx: number;
	onFork: (msgIdx: number) => void;
}

/**
 * Small button shown on every Greg response in the Main conversation.
 * Clicking it forks the conversation at this message into a new branch tab.
 */
export const ForkButton = ({ msgIdx, onFork }: ForkButtonProps): JSX.Element => {
	return (
		<button
			onClick={() => onFork(msgIdx)}
			title="Fork conversation from here"
			className={cn(
				"flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
				"border-(--g-border) text-(--g-text-muted) bg-(--g-surface)",
				"hover:text-(--g-accent) hover:border-(--g-border-accent) hover:bg-(--g-accent-dim)",
			)}
		>
			<GitBranch size={11} strokeWidth={2} />
			fork
		</button>
	);
};

export default ForkButton;
