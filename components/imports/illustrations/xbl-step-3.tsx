import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the API key string with a "copy" affordance.
 * Step 3 of the Xbox connect modal.
 */
export const XblStep3 = memo(function XblStep3({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="API key string with copy button">
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      {/* Card */}
      <rect x="20" y="30" width="120" height="60" fill="#15151c" />
      <rect x="20" y="30" width="120" height="60" fill="none" stroke="#2a2a3a" strokeWidth="1" />
      {/* "Your API Key" label */}
      <rect x="28" y="38" width="40" height="3" fill="#888" />
      {/* Key string mockup */}
      <rect x="28" y="48" width="86" height="6" fill="#0a0a10" />
      <rect x="30" y="50" width="3" height="2" fill="#7c5cff" />
      <rect x="35" y="50" width="6" height="2" fill="#e0e0ea" />
      <rect x="43" y="50" width="2" height="2" fill="#e0e0ea" />
      <rect x="47" y="50" width="8" height="2" fill="#e0e0ea" />
      <rect x="57" y="50" width="4" height="2" fill="#e0e0ea" />
      <rect x="63" y="50" width="10" height="2" fill="#e0e0ea" />
      <rect x="75" y="50" width="3" height="2" fill="#e0e0ea" />
      <rect x="80" y="50" width="7" height="2" fill="#e0e0ea" />
      <rect x="89" y="50" width="5" height="2" fill="#e0e0ea" />
      <rect x="96" y="50" width="9" height="2" fill="#e0e0ea" />
      <rect x="107" y="50" width="3" height="2" fill="#e0e0ea" />
      {/* Copy button (right side) */}
      <rect x="120" y="46" width="14" height="10" fill="#7c5cff" />
      <rect x="123" y="49" width="8" height="4" fill="none" stroke="#e0e0ea" strokeWidth="1" />
      <rect x="124" y="50" width="6" height="2" fill="#e0e0ea" opacity="0.5" />
      {/* Helper caption */}
      <rect x="28" y="64" width="80" height="2" fill="#888" />
      <rect x="28" y="70" width="60" height="2" fill="#888" />
    </svg>
  );
});
