import type { BrushSettings, BrushTool } from '../model/editing';
import { TERRAIN_METADATA } from '../model/terrainMetadata';
import type { TerrainCode } from '../model/types';

interface BrushOptionsPanelProps {
  brushSettings: BrushSettings;
  onChangeBrush: (settings: BrushSettings) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOL_LABELS: Record<BrushTool, string> = {
  raise:         'Raise',
  lower:         'Lower',
  flatten:       'Flatten',
  smooth:        'Smooth',
  erode:         'Erode',
  'raise-water': 'Raise Water',
  'lower-water': 'Lower Water',
  'paint-terrain': 'Paint Terrain',
  spray:         'Spray Paint',
  'flood-water': 'Flood Water',
  'flood-lava':  'Flood Lava',
  mountain:      'Mountain',
  sponge:        'Sponge',
  'set-spawn':   'Set Spawn Point',
};

export function BrushOptionsPanel({
  brushSettings,
  onChangeBrush,
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  onUndo,
  onRedo,
}: BrushOptionsPanelProps) {
  const showTerrainPalette = brushSettings.tool === 'paint-terrain' || brushSettings.tool === 'spray';
  const showFlattenLevel = brushSettings.tool === 'flatten';
  const isClickTool = brushSettings.tool === 'flood-water' || brushSettings.tool === 'flood-lava' || brushSettings.tool === 'set-spawn';

  return (
    <div className="wp-brushpanel">
      {/* Tool name */}
      <div className="wp-brushpanel-section" style={{ minWidth: 90 }}>
        <span className="wp-brush-label" style={{ color: 'var(--wp-text-bright)', fontSize: 11 }}>
          {TOOL_LABELS[brushSettings.tool]}
        </span>
      </div>

      {/* Click-tool hint: flood + set-spawn don't use radius/strength sliders */}
      {isClickTool && (
        <div className="wp-brushpanel-section" style={{ color: 'var(--wp-text-dim)', fontSize: 10 }}>
          {brushSettings.tool === 'set-spawn' ? 'Click to set spawn point' : 'Click to flood-fill from cursor'}
        </div>
      )}

      {/* Radius — hidden for click-only tools */}
      {!isClickTool && <div className="wp-brushpanel-section">
        <span className="wp-brush-label">Radius</span>
        <input
          type="range"
          className="wp-range"
          style={{ width: 80 }}
          min={1}
          max={50}
          value={brushSettings.radius}
          onChange={(e) => onChangeBrush({ ...brushSettings, radius: Number(e.target.value) })}
        />
        <span className="wp-value-display">{brushSettings.radius}</span>
      </div>}

      {/* Strength — hidden for click-only tools */}
      {!isClickTool && <div className="wp-brushpanel-section">
        <span className="wp-brush-label">Strength</span>
        <input
          type="range"
          className="wp-range"
          style={{ width: 80 }}
          min={1}
          max={20}
          value={brushSettings.strength}
          onChange={(e) => onChangeBrush({ ...brushSettings, strength: Number(e.target.value) })}
        />
        <span className="wp-value-display">{brushSettings.strength}</span>
      </div>}

      {/* Flatten level (only when flatten tool is active) */}
      {showFlattenLevel && (
        <div className="wp-brushpanel-section">
          <span className="wp-brush-label">Level</span>
          <input
            type="range"
            className="wp-range"
            style={{ width: 100 }}
            min={0}
            max={320}
            value={brushSettings.flattenLevel ?? 64}
            onChange={(e) => onChangeBrush({ ...brushSettings, flattenLevel: Number(e.target.value) })}
          />
          <span className="wp-value-display">{brushSettings.flattenLevel ?? 64}</span>
        </div>
      )}

      {/* Terrain palette (only when paint-terrain tool) */}
      {showTerrainPalette && (
        <div className="wp-brushpanel-section" style={{ flex: '1 1 auto', maxWidth: 400 }}>
          <span className="wp-brush-label">Terrain</span>
          <div className="wp-terrain-palette">
            {TERRAIN_METADATA.map(({ code, label, color }) => (
              <button
                key={code}
                type="button"
                className={`wp-terrain-swatch${brushSettings.paintTerrain === code ? ' active' : ''}`}
                title={label}
                style={{ '--swatch-color': color } as React.CSSProperties}
                onClick={() => onChangeBrush({ ...brushSettings, paintTerrain: code as TerrainCode })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Undo/redo */}
      <div className="wp-brushpanel-section" style={{ marginLeft: 'auto' }}>
        <div className="wp-undo-group">
          <button
            type="button"
            className="wp-btn-small"
            disabled={!canUndo}
            onClick={onUndo}
            title={`Undo (${undoCount})`}
          >
            ↩ Undo{undoCount > 0 ? ` (${undoCount})` : ''}
          </button>
          <button
            type="button"
            className="wp-btn-small"
            disabled={!canRedo}
            onClick={onRedo}
            title={`Redo (${redoCount})`}
          >
            ↪ Redo{redoCount > 0 ? ` (${redoCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
