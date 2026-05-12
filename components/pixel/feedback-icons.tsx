export function PixelCheckmark({ size = 16, color = "#4ade80" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      <rect x="2" y="8" width="2" height="2" fill={color} />
      <rect x="4" y="10" width="2" height="2" fill={color} />
      <rect x="6" y="12" width="2" height="2" fill={color} />
      <rect x="8" y="10" width="2" height="2" fill={color} />
      <rect x="10" y="8" width="2" height="2" fill={color} />
      <rect x="12" y="6" width="2" height="2" fill={color} />
      <rect x="14" y="4" width="1" height="2" fill={color} />
    </svg>
  );
}
