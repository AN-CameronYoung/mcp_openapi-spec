"use client";

import { useShallow } from "zustand/react/shallow";

import { cn } from "../lib/utils";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";
import type { ThemePref } from "../store/store";
import AutoIngestIndicator from "./AutoIngestBanner";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

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
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "claude", label: "Claude" },
  { value: "dark", label: "Dark" },
];

const TABS = [
  { key: "greg" as const, label: "greg", icon: Ic.chat },
  { key: "docs" as const, label: "Swagger", icon: Ic.doc },
];

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const SunIcon = () => (
  <svg width={15} height={15} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M11.9 3.4l-.7.7M4.1 11.9l-.7.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const MoonIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------

/**
 * Icon button that opens a dropdown to select system/light/paper/dark theme.
 */
const ThemeToggle = (): JSX.Element => {
  const { theme, setTheme } = useStore(useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme })));

  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Theme"
        >
          {isDark ? <MoonIcon /> : <SunIcon />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-32 gap-0 p-1">
        {THEME_OPTS.map((o) => (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            className={cn(
              "w-full rounded px-3 py-1.5 text-left text-sm transition-colors",
              theme === o.value
                ? "bg-accent text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
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
          title="Ingest"
        >
          {Ic.upload(16)}
        </Button>
      </div>
    </div>
  );
};

export default Header;
