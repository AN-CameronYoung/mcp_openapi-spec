"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { Conversation } from "../../store/store";
import { cn } from "../../lib/utils";

import { CloseBranchConfirm } from "./CloseBranchConfirm";

interface TabBarProps {
	conversations: Conversation[];
	activeConversationId: string;
	onSwitch: (id: string) => void;
	onClose: (id: string) => void;
	onRename: (id: string, name: string) => void;
}

/**
 * Horizontal tab bar for switching between Main and branch conversations.
 * Main is pinned and non-closable. Branch tabs get a close button that
 * confirms via dialog when the branch has any messages.
 */
export const TabBar = ({ conversations, activeConversationId, onSwitch, onClose, onRename }: TabBarProps): JSX.Element | null => {
	const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftName, setDraftName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editingId && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingId]);

	if (conversations.length === 0) return null;

	const pending = pendingCloseId ? conversations.find((c) => c.id === pendingCloseId) : null;

	const handleCloseClick = (conv: Conversation): void => {
		// Empty branches close immediately; non-empty branches confirm first
		if (conv.messages.length === 0) {
			onClose(conv.id);
			return;
		}
		setPendingCloseId(conv.id);
	};

	const startEditing = (conv: Conversation): void => {
		setEditingId(conv.id);
		setDraftName(conv.name);
	};

	const commitEdit = (): void => {
		if (!editingId) return;
		const next = draftName.trim();
		const current = conversations.find((c) => c.id === editingId);
		if (next && current && next !== current.name) onRename(editingId, next);
		setEditingId(null);
	};

	const cancelEdit = (): void => {
		setEditingId(null);
	};

	return (
		<>
			<div
				role="tablist"
				aria-label="Conversation tabs"
				className="flex items-center gap-1 overflow-x-auto shrink-0 border-b border-(--g-border) bg-(--g-bg)"
			>
				{conversations.map((conv, idx) => {
					const isActive = conv.id === activeConversationId;
					const isMain = idx === 0;
					return (
						<div
							key={conv.id}
							role="tab"
							aria-selected={isActive}
							onClick={() => onSwitch(conv.id)}
							className={cn(
								"group/tab relative flex items-center gap-1.5 h-8 pl-3 pr-2 text-xs font-medium cursor-pointer select-none transition-colors",
								"border-b-2",
								isActive
									? "border-(--g-accent) text-(--g-accent) bg-(--g-accent-dim)"
									: "border-transparent text-(--g-text-muted) hover:text-(--g-text) hover:bg-(--g-surface-hover)",
							)}
						>
							{editingId === conv.id && !isMain ? (
								<input
									ref={inputRef}
									value={draftName}
									onChange={(e) => setDraftName(e.target.value)}
									onBlur={commitEdit}
									onClick={(e) => e.stopPropagation()}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											commitEdit();
										} else if (e.key === "Escape") {
											e.preventDefault();
											cancelEdit();
										}
									}}
									className="truncate max-w-[10rem] bg-transparent outline-none border-b border-(--g-accent) text-xs"
								/>
							) : (
								<span
									className="truncate max-w-[10rem]"
									onDoubleClick={(e) => {
										if (isMain) return;
										e.stopPropagation();
										startEditing(conv);
									}}
								>
									{conv.name}
								</span>
							)}
							{!isMain && (
								<button
									type="button"
									aria-label={`Close ${conv.name}`}
									onClick={(e) => {
										e.stopPropagation();
										handleCloseClick(conv);
									}}
									className={cn(
										"flex items-center justify-center w-4 h-4 rounded-sm transition-opacity",
										isActive ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-70 hover:opacity-100",
										"hover:bg-(--g-surface-hover) hover:text-(--g-danger)",
									)}
								>
									<X size={11} strokeWidth={2.2} />
								</button>
							)}
						</div>
					);
				})}
			</div>
			<CloseBranchConfirm
				open={pendingCloseId !== null}
				branchName={pending?.name ?? ""}
				onConfirm={() => {
					if (pendingCloseId) onClose(pendingCloseId);
					setPendingCloseId(null);
				}}
				onCancel={() => setPendingCloseId(null)}
			/>
		</>
	);
};

export default TabBar;
