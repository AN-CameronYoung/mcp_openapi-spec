"use client";

interface ScoreBarProps {
  score: number;
}

/**
 * Displays a numeric score as a small horizontal progress bar with a percentage label.
 */
const ScoreBar = ({ score }: ScoreBarProps): JSX.Element => {
  const p = Math.round(score * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[34px] h-1 overflow-hidden rounded-[2px] bg-(--g-border)">
        <div style={{ width: `${p}%` }} className="h-full rounded-[2px] bg-(--g-accent)" />
      </div>
      <span className="text-[0.8125rem] font-mono text-(--g-text-dim)">{p}%</span>
    </div>
  );
};

export default ScoreBar;
