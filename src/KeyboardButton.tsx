import clsx from "clsx";

interface KeyboardButtonProps {
  label: string;
  /** Percentage of container width from left edge */
  leftPct: number;
  /** Percentage of container height from top edge */
  topPct: number;
  widthPct: number;
  heightPct: number;
  active: boolean;
}

export default function KeyboardButton({
  label,
  leftPct,
  topPct,
  widthPct,
  heightPct,
  active,
}: KeyboardButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        "absolute box-border rounded-md border border-gray-300 transition-colors duration-500",
        active ? "bg-blue-500" : "bg-white",
      )}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
      }}
    >
      {label}
    </button>
  );
}
