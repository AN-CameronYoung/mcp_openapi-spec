"use client";

import { cn } from "../lib/utils";
import { METHOD_COLORS } from "../lib/constants";
import { Badge } from "./ui/badge";

interface EpCardProps {
  method: string;
  path: string;
  api: string;
  description: string;
  warnings?: string;
  compact?: boolean;
  onClick?: () => void;
}

/**
 * Card displaying a single API endpoint with method badge, path, API tag, and optional warnings.
 */
const EpCard = ({ method, path, api, description, warnings, compact, onClick }: EpCardProps): JSX.Element => {
  const warningList = warnings ? warnings.split("|").filter(Boolean) : [];
  const m = (METHOD_COLORS[method] ?? METHOD_COLORS["GET"])!;
  return (
    <div
      onClick={onClick}
      className={cn(
        "border border-border rounded-md bg-muted transition-all duration-100",
        compact ? "px-1.5 py-[0.1875rem]" : "px-2 py-1",
        onClick ? "cursor-pointer hover:border-(--g-border-hover)" : "cursor-default",
      )}
    >
      {/* Method + path + API */}
      <div className="flex items-center gap-[0.3125rem]">
        <Badge
          variant="method"
          className="text-center"
          style={{
            background: m.bg,
            color: m.text,
            border: `1px solid ${m.border}`,
            minWidth: compact ? 30 : 34,
          }}
        >
          {method}
        </Badge>
        <code
          className={cn("flex-1 font-mono font-[inherit] truncate text-foreground", compact ? "text-[0.6875rem]" : "text-xs")}
        >
          {path}
        </code>
        <Badge variant="api">
          {api}
        </Badge>
      </div>

      {/* Description */}
      <p
        className={cn(
          "mt-0.5 leading-[1.3] truncate text-(--g-text-dim)",
          compact ? "text-[0.625rem] pl-[2.1875rem]" : "text-[0.6875rem] pl-10",
        )}
      >
        {description}
      </p>

      {/* Warnings */}
      {!compact && warningList.length > 0 && (
        <div className="flex flex-wrap gap-[0.1875rem] mt-1 pl-10">
          {warningList.map((w, i) => (
            <span
              key={i}
              className="px-2 py-[0.1875rem] rounded border border-(--g-method-put-border) bg-(--g-method-put-bg) text-xs text-(--g-method-put-text) leading-[1.5]"
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default EpCard;
