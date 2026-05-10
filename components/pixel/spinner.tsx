"use client";

export function PixelSpinner({ size = 16, color = "#7c5cff" }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ animation: "pixel-spin 0.8s steps(8) infinite", transformOrigin: "center" }}
    >
      <rect x="7" y="2" width="2" height="2" fill={color} />
      <rect x="11" y="3" width="2" height="2" fill={color} opacity="0.85" />
      <rect x="12" y="7" width="2" height="2" fill={color} opacity="0.7" />
      <rect x="11" y="11" width="2" height="2" fill={color} opacity="0.55" />
      <rect x="7" y="12" width="2" height="2" fill={color} opacity="0.4" />
      <rect x="3" y="11" width="2" height="2" fill={color} opacity="0.3" />
      <rect x="2" y="7" width="2" height="2" fill={color} opacity="0.2" />
      <rect x="3" y="3" width="2" height="2" fill={color} opacity="0.15" />
      <style>{`@keyframes pixel-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
