import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "PlayTrail — a field guide to browser games";

/** Site default share image (DESIGN §5): trail, logo mark, tagline. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F5F1E8",
          padding: "64px 72px",
          color: "#1B1A17",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="44" height="44" viewBox="0 0 18 18">
            <path d="M3 14 C 6 8, 10 12, 15 4" fill="none" stroke="#FF5B1F" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" />
            <circle cx="3" cy="14" r="2.6" fill="#1B1A17" />
            <circle cx="15" cy="4" r="2.6" fill="#FF5B1F" />
          </svg>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>PlayTrail</span>
        </div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1.15, letterSpacing: -2, maxWidth: 900 }}>
          A field guide to browser games
        </div>
        <svg width="1056" height="16" viewBox="0 0 1056 16">
          <path d="M 4 8 H 1052" fill="none" stroke="#FF5B1F" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 16" />
          <circle cx="80" cy="8" r="8" fill="#1B1A17" />
          <circle cx="520" cy="8" r="8" fill="#FF5B1F" />
          <circle cx="980" cy="8" r="8" fill="#1B1A17" />
        </svg>
      </div>
    ),
    size,
  );
}
