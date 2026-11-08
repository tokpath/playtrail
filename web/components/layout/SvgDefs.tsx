/**
 * Site-wide shared SVG defs: the paper-grain noise filter referenced by every
 * TrailCover (DESIGN §5.6) and the contour texture strips on legal pages.
 * Rendered once in the locale layout.
 */
export function SvgDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <defs>
        <filter id="pt-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
    </svg>
  );
}
