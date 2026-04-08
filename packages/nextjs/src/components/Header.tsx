"use client";

import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";
import type { ThemePref } from "../store/store";
import AutoIngestIndicator from "./AutoIngestBanner";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeOption {
  value: ThemePref;
  label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEME_OPTS: ThemeOption[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const TABS = [
  { key: "greg" as const, label: "greg", icon: Ic.chat },
  { key: "search" as const, label: "Semantic search", icon: Ic.search },
  { key: "docs" as const, label: "API docs", icon: Ic.doc },
];

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------

/**
 * Three-way toggle for system/light/dark theme preference.
 */
const ThemeToggle = (): JSX.Element => {
  const { theme, setTheme } = useStore(useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme })));

  return (
    <div className="flex overflow-hidden rounded-md border border-border bg-muted">
      {THEME_OPTS.map((o) => (
        <Button
          key={o.value}
          variant="ghost"
          size="xs"
          onClick={() => setTheme(o.value)}
          className={cn(
            "px-2 rounded-none",
            theme === o.value
              ? "bg-accent text-primary font-semibold"
              : "text-muted-foreground font-normal",
          )}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/**
 * Top navigation bar with logo, page tabs, API stats, ingest indicator, theme toggle, and settings.
 */
const Header = (): JSX.Element => {
  const { page, setPage, apis } = useStore(useShallow((s) => ({ page: s.page, setPage: s.setPage, apis: s.apis })));

  const totalEndpoints = apis.reduce((s, a) => s + a.endpoints, 0);

  return (
    <div className="flex items-stretch h-14 px-5 border-b border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-[1.375rem]">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-(--g-green)">
          <svg width={18} height={18} viewBox="0 0 20 20" fill="none">
            <circle cx="7" cy="8" r="1.4" fill="white"/>
            <circle cx="13" cy="8" r="1.4" fill="white"/>
            <path d="M6.5 13.5h7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>
        <span className="text-lg font-semibold tracking-[-0.01em]">greg</span>
      </div>

      {/* Tabs */}
      {TABS.map((t) => (
        <Button
          key={t.key}
          variant="ghost"
          onClick={() => setPage(t.key)}
          className={cn(
            "h-full gap-1.5 px-3.5 -mb-px rounded-none border-b-2 text-base font-medium",
            page === t.key
              ? "text-primary border-b-primary"
              : "text-muted-foreground border-b-transparent",
          )}
        >
          {t.icon()}
          {t.label}
        </Button>
      ))}

      {/* Stats + theme toggle */}
      <div className="flex items-center gap-[0.6875rem] ml-auto">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {Ic.server()} {apis.length} APIs
        </span>
        <span className="text-sm text-muted-foreground">{totalEndpoints} endpoints</span>
        <AutoIngestIndicator />
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setPage("settings")}
          className={cn(
            page === "settings"
              ? "bg-accent text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Settings"
        >
          {Ic.gear(16)}
        </Button>
      </div>
    </div>
  );
};

export default Header;
