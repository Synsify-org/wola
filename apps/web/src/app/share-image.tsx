import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// The picture shown when a Wola link is shared (WhatsApp, LinkedIn, Slack, X).
// Rendered on demand from the same brand colours as the app; no external fonts
// or images, so it can never fail because a third party is down.
export function shareImage(size: { width: number; height: number }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #14532d 0%, #166534 55%, #16a34a 100%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 108,
              height: 108,
              borderRadius: 26,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" x2="21" y1="22" y2="22" />
              <line x1="6" x2="6" y1="18" y2="11" />
              <line x1="10" x2="10" y1="18" y2="11" />
              <line x1="14" x2="14" y1="18" y2="11" />
              <line x1="18" x2="18" y1="18" y2="11" />
              <polygon points="12 2 20 7 4 7" />
            </svg>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{SITE_TAGLINE}</div>
          <div style={{ fontSize: 34, lineHeight: 1.3, opacity: 0.85, maxWidth: 940 }}>
            Apply, approve, disburse and collect salary-deducted loans — with clear rules and a full audit trail.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
