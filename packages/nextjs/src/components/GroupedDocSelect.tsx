"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, ChevronsUpDown } from "lucide-react";

import type { DocInfo } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  segment: string;
  prefix: string;
  docs: DocInfo[];
  children: TreeNode[];
}

interface GroupedDocSelectProps {
  docs: DocInfo[];
  value: string;
  onChange: (value: string) => void;
  height?: number;
  fontSize?: number;
  minWidth?: number;
  color?: string;
}

// ---------------------------------------------------------------------------
// Build tree from "-" separated doc names
// ---------------------------------------------------------------------------

const buildTree = (docs: DocInfo[]): TreeNode => {
  // First, count how many docs share each possible "-" boundary prefix
  const prefixCounts = new Map<string, number>();
  for (const doc of docs) {
    const parts = doc.name.split("-");
    for (let depth = 1; depth < parts.length; depth++) {
      const prefix = parts.slice(0, depth).join("-");
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  const root: TreeNode = { segment: "", prefix: "", docs: [], children: [] };

  for (const doc of docs) {
    const parts = doc.name.split("-");
    let node = root;

    // Walk down segments, only branching where 2+ docs share the prefix
    let depth = 0;
    for (depth = 0; depth < parts.length - 1; depth++) {
      const prefix = parts.slice(0, depth + 1).join("-");
      if ((prefixCounts.get(prefix) ?? 0) < 2) break;

      const segment = parts[depth]!;
      let child = node.children.find((c) => c.segment === segment);
      if (!child) {
        child = { segment, prefix, docs: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }

    // Everything from `depth` onward is the leaf name
    node.docs.push(doc);
  }

  return root;
};

/**
 * Collapse single-child chains: if a node has no docs and exactly one child,
 * merge them (e.g. "loom" > "collector" becomes "loom / collector").
 */
const collapseTree = (node: TreeNode): TreeNode => {
  node.children = node.children.map(collapseTree);

  while (node.children.length === 1 && node.docs.length === 0 && node.segment) {
    const only = node.children[0]!;
    node.segment = `${node.segment} / ${only.segment}`;
    node.prefix = only.prefix;
    node.docs = only.docs;
    node.children = only.children;
  }

  return node;
};

const countDocs = (node: TreeNode): number =>
  node.docs.length + node.children.reduce((sum, c) => sum + countDocs(c), 0);

const containsValue = (node: TreeNode, value: string): boolean =>
  node.docs.some((d) => d.name === value) || node.children.some((c) => containsValue(c, value));

/** True if a single-doc leaf that should render flat, not as a folder */
const shouldInline = (node: TreeNode): boolean =>
  node.children.length === 0 && node.docs.length === 1;

// ---------------------------------------------------------------------------
// MenuItem
// ---------------------------------------------------------------------------

interface MenuItemProps {
  label: string;
  detail?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

const MenuItem = ({ label, detail, selected, onClick }: MenuItemProps): JSX.Element => (
  <div
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
      "hover:bg-(--g-surface-hover)",
      selected && "bg-(--g-accent-dim)",
    )}
  >
    <span className="flex-1 truncate">{label}</span>
    {detail}
    <span className="size-3.5 shrink-0 flex items-center justify-center">
      {selected && <Check className="size-3 text-(--g-accent)" />}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// Recursive flyout group
// ---------------------------------------------------------------------------

const FLYOUT_GAP = 6;
const VIEWPORT_MARGIN = 8;

interface FlyoutNodeProps {
  node: TreeNode;
  value: string;
  onSelect: (name: string) => void;
  fontSize?: number;
}

const CLOSE_DELAY = 200;

const FlyoutNode = ({ node, value, onSelect, fontSize }: FlyoutNodeProps): JSX.Element => {
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 0, flipped: false });
  const hasSelected = containsValue(node, value);
  const total = countDocs(node);

  // Pull out any "-overview" doc — clicking the parent row selects it instead
  const overviewDoc = node.docs.find((d) => {
    const suffix = d.name.slice(node.prefix.length + 1);
    return suffix === "overview";
  });
  const leafDocs = node.docs.filter((d) => d !== overviewDoc);
  const hasChildren = node.children.length > 0 || leafDocs.length > 0;

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };

  const handleMouseEnter = () => {
    cancelClose();
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setFlyoutPos({ top: rect.top, left: rect.right + FLYOUT_GAP, flipped: false });
    }
    setHovered(true);
  };

  const handleMouseLeave = () => { closeTimer.current = setTimeout(() => setHovered(false), CLOSE_DELAY); };

  useEffect(() => () => cancelClose(), []);

  const handleRowClick = () => {
    if (overviewDoc) onSelect(overviewDoc.name);
  };

  useEffect(() => {
    if (!hovered || !rowRef.current || !flyoutRef.current) return;
    const rowRect = rowRef.current.getBoundingClientRect();
    const flyoutRect = flyoutRef.current.getBoundingClientRect();
    const wouldOverflow = rowRect.right + FLYOUT_GAP + flyoutRect.width > window.innerWidth - VIEWPORT_MARGIN;
    if (wouldOverflow) {
      const leftFlipped = Math.max(VIEWPORT_MARGIN, rowRect.left - flyoutRect.width - FLYOUT_GAP);
      setFlyoutPos({ top: rowRect.top, left: leftFlipped, flipped: true });
    }
  }, [hovered]);

  return (
    <div ref={rowRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div
        onClick={handleRowClick}
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
          "hover:bg-(--g-surface-hover)",
          (hovered || hasSelected) && "bg-(--g-surface-hover)",
          overviewDoc && value === overviewDoc.name && "bg-(--g-accent-dim)",
        )}
      >
        <span className={cn(
          "flex-1 truncate",
          overviewDoc && "underline decoration-dotted underline-offset-2 decoration-muted-foreground/50",
        )}>{node.segment}</span>
        <span className="text-xs text-muted-foreground shrink-0">{total}</span>
        {hasChildren && <ChevronRight className="size-3.5 opacity-50 shrink-0" />}
        {!hasChildren && overviewDoc && (
          <span className="size-3.5 shrink-0 flex items-center justify-center">
            {value === overviewDoc.name && <Check className="size-3 text-(--g-accent)" />}
          </span>
        )}
      </div>

      {hovered && hasChildren && createPortal(
        <div
          ref={flyoutRef}
          onMouseEnter={cancelClose}
          onMouseLeave={handleMouseLeave}
          style={{ position: "fixed", top: flyoutPos.top, left: flyoutPos.left, zIndex: 200, fontSize }}
          className="min-w-44 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          <div
            className={cn(
              "absolute top-2.5 size-2.5 rotate-45 bg-popover",
              flyoutPos.flipped
                ? "-right-[5px] border-r border-t border-border"
                : "-left-[5px] border-l border-b border-border",
            )}
          />
          {/* Sub-groups — recurse */}
          {node.children.map((child) =>
            shouldInline(child) ? (
              <MenuItem
                key={child.docs[0]!.name}
                label={child.segment}
                selected={value === child.docs[0]!.name}
                onClick={() => onSelect(child.docs[0]!.name)}
              />
            ) : (
              <FlyoutNode
                key={child.prefix}
                node={child}
                value={value}
                onSelect={onSelect}
                fontSize={fontSize}
              />
            ),
          )}
          {/* Leaf docs at this level (overview already removed) */}
          {leafDocs.map((doc) => {
            const suffix = doc.name.slice(node.prefix.length + 1) || doc.name;
            return (
              <MenuItem
                key={doc.name}
                label={suffix}
                selected={value === doc.name}
                onClick={() => onSelect(doc.name)}
              />
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const GroupedDocSelect = ({
  docs,
  value,
  onChange,
  height = 44,
  fontSize = 15,
  minWidth = 140,
  color,
}: GroupedDocSelectProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => collapseTree(buildTree(docs)), [docs]);

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  useEffect(() => {
    if (open) {
      setFilter("");
      requestAnimationFrame(() => filterRef.current?.focus());
    }
  }, [open]);

  // Flatten tree for filtering
  const q = filter.toLowerCase();
  const allDocs = useMemo(() => {
    const result: DocInfo[] = [];
    const walk = (n: TreeNode) => { result.push(...n.docs); n.children.forEach(walk); };
    walk(tree);
    return result;
  }, [tree]);

  const filteredDocs = q ? allDocs.filter((d) => d.name.toLowerCase().includes(q)) : null;

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
          <span className="truncate">{value || "Select a doc..."}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1 w-auto" style={{ minWidth: Math.max(minWidth, 220), fontSize }} align="start">
        <div className="px-1 pb-1">
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search docs..."
            className="w-full px-2 py-1.5 bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {docs.length === 0 && (
            <div className="px-2 py-3 text-muted-foreground text-center">No docs found.</div>
          )}

          {/* When filtering, show flat list */}
          {filteredDocs ? (
            filteredDocs.length === 0 ? (
              <div className="px-2 py-3 text-muted-foreground text-center">No matches.</div>
            ) : (
              filteredDocs.map((doc) => (
                <MenuItem
                  key={doc.name}
                  label={doc.name}
                  selected={value === doc.name}
                  onClick={() => handleSelect(doc.name)}
                />
              ))
            )
          ) : (
            <>
              {/* Tree view: sub-groups as recursive flyouts */}
              {tree.children.map((child) =>
                shouldInline(child) ? (
                  <MenuItem
                    key={child.docs[0]!.name}
                    label={child.docs[0]!.name}
                    selected={value === child.docs[0]!.name}
                    onClick={() => handleSelect(child.docs[0]!.name)}
                  />
                ) : (
                  <FlyoutNode
                    key={child.prefix}
                    node={child}
                    value={value}
                    onSelect={handleSelect}
                    fontSize={fontSize}
                  />
                ),
              )}
              {/* Root-level leaf docs (single-segment names) */}
              {tree.docs.map((doc) => (
                <MenuItem
                  key={doc.name}
                  label={doc.name}
                  selected={value === doc.name}
                  onClick={() => handleSelect(doc.name)}
                />
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default GroupedDocSelect;
