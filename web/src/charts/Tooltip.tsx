import type { ReactNode } from "react";

export type Tip = { x: number; y: number; content: ReactNode } | null;

/** Tooltip positioned inside a relatively-positioned chart wrapper; flips near the right edge. */
export function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 200;
  return (
    <div
      className="tooltip"
      role="status"
      style={{ left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined, top: tip.y + 14 }}
    >
      {tip.content}
    </div>
  );
}
