import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the xbl.io dashboard with the "API Key" tab
 * highlighted. Step 2 of the Xbox connect modal.
 */
export const XblStep2 = memo(function XblStep2({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="OpenXBL dashboard with API Key tab highlighted">
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      {/* Sidebar */}
      <rect x="0" y="0" width="40" height="120" fill="#15151c" />
      <rect x="4" y="8" width="32" height="4" fill="#e0e0ea" />
      <rect x="4" y="20" width="20" height="2" fill="#888" />
      <rect x="4" y="28" width="24" height="2" fill="#888" />
      {/* API Key tab — highlighted */}
      <rect x="4" y="36" width="32" height="8" fill="#7c5cff" />
      <rect x="6" y="39" width="28" height="2" fill="#e0e0ea" />
      <rect x="4" y="48" width="20" height="2" fill="#888" />
      <rect x="4" y="56" width="22" height="2" fill="#888" />
      {/* Content */}
      <rect x="46" y="8" width="80" height="4" fill="#e0e0ea" />
      <rect x="46" y="20" width="108" height="60" fill="#15151c" />
      <rect x="50" y="26" width="50" height="3" fill="#888" />
      <rect x="50" y="34" width="100" height="6" fill="#0a0a10" />
      <rect x="52" y="36" width="80" height="2" fill="#e0e0ea" />
      <rect x="50" y="48" width="40" height="8" fill="#7c5cff" />
      <rect x="54" y="51" width="32" height="2" fill="#e0e0ea" />
      {/* Pointer arrow at the tab */}
      <rect x="40" y="38" width="4" height="2" fill="#7c5cff" />
      <rect x="42" y="36" width="2" height="6" fill="#7c5cff" />
    </svg>
  );
});
