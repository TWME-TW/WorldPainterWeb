interface StatusBarProps {
  message: string;
  worldX: number | null;
  worldY: number | null;
  zoom: number;
  saveStatus: string;
}

export function StatusBar({ message, worldX, worldY, zoom, saveStatus }: StatusBarProps) {
  const coordText = worldX !== null && worldY !== null
    ? `X: ${worldX},  Y: ${worldY}`
    : '';

  return (
    <div className="wp-statusbar">
      <span className="wp-status-msg">{message}</span>
      {coordText && <span className="wp-status-seg">{coordText}</span>}
      <span className="wp-status-seg">Zoom: {Math.round(zoom * 100)}%</span>
      <span className="wp-status-seg">{saveStatus}</span>
    </div>
  );
}
