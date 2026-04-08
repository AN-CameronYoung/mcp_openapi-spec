"use client";

import { useEffect, useRef } from "react";

import { useShallow } from "zustand/react/shallow";

import { listApis } from "./lib/api";
import { useStore, pageFromHash } from "./store/store";
import Header from "./components/Header";
import GregPage from "./pages/GregPage";
import SearchPage from "./pages/SearchPage";
import DocsPage from "./pages/DocsPage";
import SettingsPage from "./pages/SettingsPage";
import IngestFloat from "./components/IngestFloat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/ui/sheet";

/**
 * Root application shell. Manages page routing, theme application,
 * API listing, and the settings drawer.
 */
const App = (): JSX.Element => {
	const { page, setPage, setApis, setDocsApi, docsApi, theme, setTheme, hydrateFromStorage } = useStore(
		useShallow((s) => ({ page: s.page, setPage: s.setPage, setApis: s.setApis, setDocsApi: s.setDocsApi, docsApi: s.docsApi, theme: s.theme, setTheme: s.setTheme, hydrateFromStorage: s.hydrateFromStorage }))
	);

	// Track the last non-settings page so content stays visible behind the drawer
	const lastPageRef = useRef<"greg" | "search" | "docs">("greg");
	if (page !== "settings") lastPageRef.current = page;
	const contentPage = lastPageRef.current;

	useEffect(() => {
		hydrateFromStorage();
	}, []);

	useEffect(() => {
		listApis()
			.then((apis) => {
				setApis(apis);
				if (!docsApi && apis.length > 0) {
					setDocsApi(apis[0]!.name);
				}
			})
			.catch(() => {});
	}, []);

	// Sync browser back/forward with page state
	useEffect(() => {
		const handlePopState = () => {
			const p = pageFromHash();
			if (p) useStore.setState({ page: p });
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

			{/* Page content — always mounted so DocsPage iframe survives tab switches */}
			<div className={contentPage === "greg" ? "contents" : "hidden"}><GregPage /></div>
			<div className={contentPage === "search" ? "contents" : "hidden"}><SearchPage /></div>
			<div className={contentPage === "docs" ? "contents" : "hidden"}><DocsPage /></div>

			{/* Settings drawer */}
			<Sheet open={showSettings} onOpenChange={handleSheetOpenChange}>
				<SheetContent side="right" className="flex flex-col gap-0 w-[28rem] max-w-[90vw] p-0">
					<SheetHeader className="shrink-0 px-5 py-3 border-b border-border">
						<SheetTitle className="text-base font-semibold">Settings</SheetTitle>
					</SheetHeader>
					<div className="flex-1 overflow-auto">
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
