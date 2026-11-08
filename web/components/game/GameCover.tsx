"use client";

import { useEffect, useRef, useState } from "react";
import type { Image } from "@/lib/api/types";
import { TrailCover } from "./TrailCover";

/**
 * Cover stack used everywhere a game cover appears (DESIGN §4.6): the
 * generated TrailCover sits underneath; the authorized image (self-hosted or
 * hotlinked CrazyGames CDN art) fades in on top and is removed on error, so
 * the 16:9 box never shifts or collapses (PRD 5.1.2).
 */
export function GameCover({
  cover,
  slug,
  category,
  name,
  sizes,
  priority = false,
  className = "",
  alt,
}: {
  cover: Image | null;
  slug: string;
  category: string;
  name: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const showImage = cover != null && !failed;

  // The load event can fire before hydration attaches onLoad; pick up images
  // that are already complete so they are never stuck transparent.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true);
  }, [showImage]);

  return (
    <div className={`relative aspect-[16/9] overflow-hidden rounded-cover border border-hairline bg-surface-sunk ${className}`}>
      <TrailCover slug={slug} category={category} name={name} className="absolute inset-0" />
      {showImage ? (
        // Plain img on purpose: CrazyGames covers are hotlinked from their CDN
        // (PRD 22.12) and must not be proxied or rehosted through our server,
        // so next/image is not an option here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={cover.url}
          srcSet={cover.srcset.map((s) => `${s.url} ${s.width}w`).join(", ")}
          sizes={sizes}
          width={cover.width}
          height={cover.height}
          alt={alt ?? cover.alt}
          referrerPolicy={cover.source === "crazygames" ? "no-referrer" : undefined}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      {alt ? <span className="sr-only">{alt}</span> : null}
    </div>
  );
}
