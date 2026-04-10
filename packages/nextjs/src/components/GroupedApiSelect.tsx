"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, ChevronsUpDown } from "lucide-react";

import type { ApiInfo } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiGroup {
  type: "group";
  name: string;
  children: ApiInfo[];
}

interface ApiSingle {
  type: "single";
  api: ApiInfo;
}

type GroupedEntry = ApiGroup | ApiSingle;

interface MenuItemProps {
  label: string;
  detail?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

interface FlyoutGroupProps {
  entry: ApiGroup;
  value: string;
  onSelect: (v: string) => void;
  fontSize?: number;
}

interface GroupedApiSelectProps {
  apis: ApiInfo[];
  value: string;
  onChange: (value: string) => void;
  allLabel?: string;
  height?: number;
  fontSize?: number;
  minWidth?: number;
  color?: string;
  withIcon?: boolean;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Groups APIs by shared prefix (the part before the first "-").
 * Only creates a group when 2+ APIs share the same prefix.
 */
const groupApis = (apis: ApiInfo[]): GroupedEntry[] => {
  const prefixToApis = new Map<string, ApiInfo[]>();

  for (const api of apis) {
    const idx = api.name.indexOf("-");
    if (idx > 0) {
      const prefix = api.name.slice(0, idx);
      if (!prefixToApis.has(prefix)) prefixToApis.set(prefix, []);
      prefixToApis.get(prefix)!.push(api);
    }
  }

  const result: GroupedEntry[] = [];
  const seenPrefixes = new Set<string>();

  for (const api of apis) {
    const idx = api.name.indexOf("-");
    const prefix = idx > 0 ? api.name.slice(0, idx) : null;

    if (prefix && (prefixToApis.get(prefix)?.length ?? 0) >= 2) {
      if (!seenPrefixes.has(prefix)) {
        seenPrefixes.add(prefix);
        result.push({ type: "group", name: prefix, children: prefixToApis.get(prefix)! });
      }
    } else {
      result.push({ type: "single", api });
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Menu item (shared)
// ---------------------------------------------------------------------------

/**
 * A single row inside the dropdown popover, with optional detail node and selection indicator.
 */
const MenuItem = ({ label, detail, selected, onClick, className }: MenuItemProps): JSX.Element => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
        "hover:bg-(--g-surface-hover)",
        selected && "bg-(--g-accent-dim)",
        className,
      )}
    >
      <span className="flex-1 truncate">{label}</span>
      {detail}
      {/* spacer aligns with the chevron on group rows */}
      <span className="size-3.5 shrink-0 flex items-center justify-center">
        {selected && <Check className="size-3 text-(--g-accent)" />}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Flyout group — sub-menu rendered via fixed positioning to escape scroll clip
// ---------------------------------------------------------------------------

/**
 * A grouped row that reveals a flyout sub-menu of child APIs on hover.
 * The sub-menu is portalled to document.body to escape any overflow/clip containers.
 */
const FlyoutGroup = ({ entry, value, onSelect, fontSize }: FlyoutGroupProps): JSX.Element => {
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 0 });
  const hasSelected = entry.children.some((c) => c.name === value);

  const handleMouseEnter = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setFlyoutPos({ top: rect.top, left: rect.right + 6 });
    }
    setHovered(true);
  };

  const handleMouseLeave = () => setHovered(false);

  return (
    <div
      ref={rowRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
          "hover:bg-(--g-surface-hover)",
          (hovered || hasSelected) && "bg-(--g-surface-hover)",
        )}
      >
        <span className="flex-1 truncate">{entry.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">{entry.children.reduce((sum, c) => sum + c.endpoints, 0)}</span>
        <ChevronRight className="size-3.5 opacity-50 shrink-0" />
      </div>

      {hovered && createPortal(
        <div
          style={{ position: "fixed", top: flyoutPos.top, left: flyoutPos.left, zIndex: 200, fontSize }}
          className="min-w-44 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          <div className="absolute -left-[5px] top-2.5 size-2.5 rotate-45 border-l border-b border-border bg-popover" />
          {entry.children.map((child) => (
            <MenuItem
              key={child.name}
              label={child.name}
              detail={<span className="text-xs text-muted-foreground shrink-0">{child.endpoints}</span>}
              selected={value === child.name}
              onClick={() => onSelect(child.name)}
            />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A searchable API selector that groups APIs by prefix and shows flyout sub-menus for groups.
 */
const GroupedApiSelect = ({
  apis,
  value,
  onChange,
  allLabel,
  height = 44,
  fontSize = 15,
  minWidth = 140,
  color,
  withIcon = false,
}: GroupedApiSelectProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => groupApis(apis), [apis]);

  const displayLabel = value === "all"
    ? (allLabel ?? "All APIs")
    : value;

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  // Reset filter and focus input when popover opens
  useEffect(() => {
    if (open) {
      setFilter("");
      requestAnimationFrame(() => filterRef.current?.focus());
    }
  }, [open]);

  // Filter entries
  const q = filter.toLowerCase();
  const filtered = q
    ? entries.reduce<GroupedEntry[]>((acc, entry) => {
        if (entry.type === "single") {
          if (entry.api.name.toLowerCase().includes(q)) acc.push(entry);
        } else {
          const kids = entry.children.filter((c) => c.name.toLowerCase().includes(q));
          if (entry.name.toLowerCase().includes(q)) acc.push(entry);
          else if (kids.length > 0) acc.push({ ...entry, children: kids });
        }
        return acc;
      }, [])
    : entries;

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between gap-1.5 font-normal"
          style={{ height, fontSize, minWidth, color: color ?? undefined }}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1 w-auto" style={{ minWidth: Math.max(minWidth, 180), fontSize }} align="start">
        {/* Search filter */}
        <div className="px-1 pb-1">
          <input
            ref={filterRef}
            value={filter}
            onChange={handleFilterChange}
            placeholder="Search APIs..."
            className="w-full px-2 py-1.5 bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Options list */}
        <div className="max-h-64 overflow-y-auto">
          {allLabel && (
            <>
              <MenuItem
                label={allLabel}
                selected={value === "all"}
                onClick={() => handleSelect("all")}
              />
              <div className="my-1 h-px bg-border" />
            </>
          )}
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-muted-foreground text-center">No APIs found.</div>
          )}
          {filtered.map((entry) => {
            if (entry.type === "single") {
              return (
                <MenuItem
                  key={entry.api.name}
                  label={entry.api.name}
                  detail={<span className="text-xs text-muted-foreground">{entry.api.endpoints}</span>}
                  selected={value === entry.api.name}
                  onClick={() => handleSelect(entry.api.name)}
                />
              );
            }
            return (
              <FlyoutGroup
                key={entry.name}
                entry={entry}
                value={value}
                onSelect={handleSelect}
                fontSize={fontSize}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default GroupedApiSelect;
