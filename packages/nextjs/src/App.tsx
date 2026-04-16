"use client";

import { useEffect, useRef } from "react";

import { useShallow } from "zustand/react/shallow";

import { listApis, listDocs } from "./lib/api";
import { useStore, pageFromHash, chatIdFromHash, branchIndexFromHash } from "./store/store";
import Header from "./components/Header";
import GregPage from "./pages/GregPage";
import SearchPage from "./pages/SearchPage";
import ApisPage from "./pages/ApisPage";
import DocsPage from "./pages/DocsPage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";
import IngestFloat from "./components/IngestFloat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/ui/sheet";

/**
 * Root application shell. Manages page routing, theme application,
 * API listing, and the settings drawer.
 */
const App = (): JSX.Element => {
	const { page, setPage, setApis, setDocs, setApisApi, apisApi, theme, setTheme, hydrateFromStorage } = useStore(
		useShallow((s) => ({ page: s.page, setPage: s.setPage, setApis: s.setApis, setDocs: s.setDocs, setApisApi: s.setApisApi, apisApi: s.apisApi, theme: s.theme, setTheme: s.setTheme, hydrateFromStorage: s.hydrateFromStorage }))
	);

	// Track the last non-settings page so content stays visible behind the drawer
	const lastPageRef = useRef<"greg" | "search" | "apis" | "docs">("greg");
	if (page !== "settings" && page !== "admin") lastPageRef.current = page as "greg" | "search" | "apis" | "docs";
	const contentPage = lastPageRef.current;

	useEffect(() => {
		hydrateFromStorage();
	}, []);

	useEffect(() => {
		listApis()
			.then((apis) => {
				setApis(apis);
				if (!apisApi && apis.length > 0) {
					setApisApi(apis[0]!.name);
				}
			})
			.catch(() => {});
		listDocs()
			.then((d) => setDocs(d))
			.catch(() => {});
	}, []);

	// Sync browser back/forward with page + chat state
	useEffect(() => {
		const handlePopState = () => {
			const p = pageFromHash();
			if (p) useStore.setState({ page: p });

			// Restore the chat (and branch) that the URL now points to (or clear if none)
			if (p === "greg" || p === null) {
				const chatId = chatIdFromHash();
				const { chatHistory } = useStore.getState();
				const chat = chatId ? chatHistory.find((c) => c.id === chatId) : null;
				if (chat) {
					const branchIdx = branchIndexFromHash();
					const activeId = branchIdx > 0 && branchIdx < chat.conversations.length
						? chat.conversations[branchIdx]!.id
						: chat.activeConversationId;
					useStore.setState({
						conversations: chat.conversations,
						activeConversationId: activeId,
						activeChatId: chat.id,
					});
				} else {
					useStore.getState().clearChat();
				}
			}
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	// Re-apply when system preference changes
	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => setTheme("system");
		mq.addEventListener("change", handleChange);
		return () => mq.removeEventListener("change", handleChange);
	}, [theme]);

	const showSettings = page === "settings";

	const handleSheetOpenChange = (open: boolean): void => {
		if (!open) setPage(contentPage);
	};

	return (
		<div className="flex flex-col h-screen">
			{/* Navigation */}
			<Header />

			{/* Page content — always mounted so pages survive tab switches */}
			<div className={contentPage === "greg" && page !== "admin" ? "contents" : "hidden"}><GregPage /></div>
			<div className={contentPage === "search" && page !== "admin" ? "contents" : "hidden"}><SearchPage /></div>
			<div className={contentPage === "apis" && page !== "admin" ? "contents" : "hidden"}><ApisPage /></div>
			<div className={contentPage === "docs" && page !== "admin" ? "contents" : "hidden"}><DocsPage /></div>
			<div className={page === "admin" ? "contents" : "hidden"}><AdminPage /></div>

			{/* Settings drawer */}
			<Sheet open={showSettings} onOpenChange={handleSheetOpenChange}>
				<SheetContent side="right" className="flex flex-col gap-0 w-[40rem] max-w-[90vw] p-0">
					<SheetHeader className="shrink-0 px-5 py-3 border-b border-border">
						<SheetTitle className="text-base font-semibold">Settings</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col flex-1 min-h-0">
						<SettingsPage />
					</div>
				</SheetContent>
			</Sheet>

			{/* Ingest overlay */}
			<IngestFloat />
		</div>
	);
};

export default App;
