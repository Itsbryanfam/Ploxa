import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Ploxa — AI-first game tracker";

export default function OpenGraphImage() {
  const logoBuffer = readFileSync(join(process.cwd(), "public/logo/logo.png"));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 40%, rgba(124, 92, 255, 0.25) 0%, transparent 55%), #0b0b0f",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt="Ploxa"
          width={520}
          height={520}
          style={{ imageRendering: "pixelated" }}
        />
        <div
          style={{
            marginTop: -40,
            fontSize: 28,
            color: "rgba(255, 255, 255, 0.65)",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          AI-first game tracker
        </div>
      </div>
    ),
    size,
  );
}
