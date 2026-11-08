"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Horizontal scroll row with edge fades that reflect actual scroll position
 * (UI review U1): no left fade at the start, no right fade when the end is
 * reached. Children keep their normal document flow — pass a plain div's
 * classes here.
 */
export function ScrollRow({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  const masks: string[] = [];
  if (!atStart) masks.push("linear-gradient(to right, transparent, black 32px)");
  if (!atEnd) masks.push("linear-gradient(to left, transparent, black 32px)");
  const style =
    masks.length > 0
      ? {
          maskImage: masks.join(", "),
          maskComposite: "intersect",
          WebkitMaskImage: masks.join(", "),
          WebkitMaskComposite: "sourceIn",
        }
      : undefined;

  return (
    <div ref={ref} onScroll={update} className={`overflow-x-auto ${className}`} style={style}>
      {children}
    </div>
  );
}
