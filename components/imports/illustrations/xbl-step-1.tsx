import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the xbl.io homepage with the "Sign In" CTA
 * highlighted. The illustration is for the Xbox connect modal's step 1.
 */
export const XblStep1 = memo(function XblStep1({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="OpenXBL homepage with Sign In with Microsoft button">
      {/* Browser frame */}
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      <rect x="2" y="2" width="156" height="14" fill="#15151c" />
      <rect x="2" y="16" width="156" height="2" fill="#2a2a3a" />
      {/* Window controls */}
      <rect x="6" y="6" width="4" height="4" fill="#ff5c5c" />
      <rect x="14" y="6" width="4" height="4" fill="#fdca40" />
      <rect x="22" y="6" width="4" height="4" fill="#2dd16d" />
      {/* URL bar */}
      <rect x="34" y="5" width="120" height="6" fill="#0a0a10" />
      <rect x="36" y="7" width="40" height="2" fill="#7c5cff" />
      {/* Page content */}
      <rect x="8" y="22" width="60" height="4" fill="#e0e0ea" />
      <rect x="8" y="30" width="100" height="2" fill="#888" />
      <rect x="8" y="34" width="80" height="2" fill="#888" />
      {/* Hero "Sign in with Microsoft" button — accent */}
      <rect x="40" y="60" width="80" height="20" fill="#7c5cff" />
      <rect x="44" y="66" width="72" height="2" fill="#e0e0ea" />
      <rect x="44" y="72" width="42" height="2" fill="#e0e0ea" />
      {/* Hover pulse hint */}
      <rect x="38" y="58" width="84" height="24" fill="none" stroke="#7c5cff" strokeOpacity="0.4" strokeWidth="1" />
    </svg>
  );
});
