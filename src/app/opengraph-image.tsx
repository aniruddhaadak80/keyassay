import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/config";

export const alt = `${siteConfig.name}: a struck assay mark on a parchment certificate`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Open Graph card.
 *
 * Rendered with the same palette as the product so the social card looks like
 * the thing it links to. No external font is fetched, which keeps the image
 * generation deterministic.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f5f1e6",
          backgroundImage:
            "radial-gradient(circle at 12% 10%, rgba(52,80,159,0.10), transparent 45%), radial-gradient(circle at 88% 84%, rgba(78,156,141,0.10), transparent 42%)",
          padding: 64,
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 6,
              color: "#6a7186",
              fontFamily: "monospace",
              textTransform: "uppercase",
            }}
          >
            Post-quantum migration triage
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 72,
              lineHeight: 1.05,
              color: "#14161d",
              fontWeight: 600,
              maxWidth: 860,
            }}
          >
            Know the year your TLS stops being secret.
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 30, color: "#263d86", maxWidth: 820 }}>
            A real TLS handshake, Certificate Transparency history, and a SHA-384 sealed grade.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderTop: "3px solid #14161d",
            paddingTop: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <div style={{ display: "flex", fontSize: 40, color: "#1c2f6b", fontWeight: 700 }}>
                {siteConfig.name}
              </div>
              <div style={{ display: "flex", fontSize: 20, color: "#6a7186", fontFamily: "monospace" }}>
                assay office
              </div>
            </div>
            <div
              style={{
                display: "flex",
                border: "3px solid #3a7a6e",
                color: "#2c5a52",
                padding: "10px 22px",
                fontSize: 30,
                letterSpacing: 5,
                fontFamily: "monospace",
                textTransform: "uppercase",
                transform: "rotate(-3deg)",
              }}
            >
              Fine
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}