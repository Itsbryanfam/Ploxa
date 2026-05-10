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

export function PixelX({ size = 16, color = "#f87171" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      <rect x="3" y="3" width="2" height="2" fill={color} />
      <rect x="5" y="5" width="2" height="2" fill={color} />
      <rect x="7" y="7" width="2" height="2" fill={color} />
      <rect x="9" y="9" width="2" height="2" fill={color} />
      <rect x="11" y="11" width="2" height="2" fill={color} />
      <rect x="11" y="3" width="2" height="2" fill={color} />
      <rect x="9" y="5" width="2" height="2" fill={color} />
      <rect x="5" y="9" width="2" height="2" fill={color} />
      <rect x="3" y="11" width="2" height="2" fill={color} />
    </svg>
  );
}

export function PixelInfo({ size = 16, color = "#7c5cff" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges">
      {/* Circle border */}
      <rect x="5" y="2" width="6" height="1" fill={color} />
      <rect x="3" y="3" width="2" height="1" fill={color} />
      <rect x="11" y="3" width="2" height="1" fill={color} />
      <rect x="2" y="4" width="1" height="2" fill={color} />
      <rect x="13" y="4" width="1" height="2" fill={color} />
      <rect x="2" y="10" width="1" height="2" fill={color} />
      <rect x="13" y="10" width="1" height="2" fill={color} />
      <rect x="3" y="12" width="2" height="1" fill={color} />
      <rect x="11" y="12" width="2" height="1" fill={color} />
      <rect x="5" y="13" width="6" height="1" fill={color} />
      {/* "i" shape */}
      <rect x="7" y="4" width="2" height="2" fill={color} />
      <rect x="7" y="7" width="2" height="4" fill={color} />
    </svg>
  );
}
