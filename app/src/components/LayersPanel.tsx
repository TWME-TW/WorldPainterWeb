import type { DimensionState, ProjectState, WorldFileLayerSummary } from '../model/types';

interface LayersPanelProps {
  project: ProjectState;
  activeDimension: DimensionState;
  onActivateDimension?: (dimensionId: string) => void;
}

const BUILTIN_LAYERS: Array<{ id: string; label: string; color: string }> = [
  { id: 'deciduousForest', label: 'Deciduous Forest', color: '#3d7a3d' },
  { id: 'pineForest',     label: 'Pine Forest',      color: '#2a5a2a' },
  { id: 'jungle',         label: 'Jungle',           color: '#4a8a1a' },
  { id: 'swampland',      label: 'Swampland',        color: '#5a6a32' },
  { id: 'frost',          label: 'Frost',            color: '#aaccee' },
  { id: 'populate',       label: 'Populate',         color: '#8a6a3a' },
  { id: 'resources',      label: 'Resources',        color: '#7a7a7a' },
  { id: 'caverns',        label: 'Caverns',          color: '#4a3a2a' },
  { id: 'caves',          label: 'Caves',            color: '#6a5a4a' },
  { id: 'chasms',         label: 'Chasms',           color: '#5a4a3a' },
  { id: 'void',           label: 'Void',             color: '#1a1a1a' },
  { id: 'annotations',    label: 'Annotations',      color: '#dd8833' },
  { id: 'river',          label: 'River',            color: '#3366bb' },
];

function formatLayerLabel(layer: WorldFileLayerSummary): string {
  return layer.name ?? layer.id ?? layer.className.split('.').at(-1) ?? layer.className;
}

export function LayersPanel({ project, activeDimension, onActivateDimension }: LayersPanelProps) {
  const importedLayers = activeDimension.importMetadata?.availableLayers ?? [];

  return (
    <div className="wp-layerspanel">
      <div className="wp-panel-header">
        <span>Layers</span>
      </div>

      {/* World info */}
      <div className="wp-panel-section">
        <dl className="wp-world-info">
          <dt>World</dt>
          <dd title={project.name}>{project.name}</dd>
          <dt>Dimension</dt>
          <dd>{activeDimension.name}</dd>
          <dt>Height</dt>
          <dd>{activeDimension.minHeight ?? '?'}..{activeDimension.maxHeight ?? '?'}</dd>
          <dt>Tiles</dt>
          <dd>{Object.keys(activeDimension.tiles).length}</dd>
        </dl>
      </div>

      {/* Imported layers (from .world file) */}
      {importedLayers.length > 0 && (
        <div className="wp-panel-section">
          <div className="wp-panel-section-title">World Layers</div>
          <div className="wp-layer-list">
            {importedLayers.map((layer, idx) => (
              <div key={idx} className="wp-layer-item">
                <input type="checkbox" className="wp-layer-checkbox" defaultChecked readOnly />
                <div className="wp-layer-swatch" style={{ background: '#7a8a9a' }} />
                <span>{formatLayerLabel(layer)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Built-in layers */}
      <div className="wp-panel-section-title" style={{ padding: '4px 8px 2px', fontSize: 10, color: 'var(--wp-text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Built-in Layers</div>
      <div className="wp-layer-list">
        {BUILTIN_LAYERS.map((layer) => (
          <div key={layer.id} className="wp-layer-item">
            <input type="checkbox" className="wp-layer-checkbox" defaultChecked={false} readOnly />
            <div className="wp-layer-swatch" style={{ background: layer.color }} />
            <span>{layer.label}</span>
          </div>
        ))}
      </div>

      {/* Compatibility notes */}
      {project.compatibility.notes.length > 0 && (
        <div className="wp-panel-section" style={{ marginTop: 'auto', padding: '4px 8px' }}>
          <div className="wp-panel-section-title">Compatibility</div>
          {project.compatibility.notes.map((note) => (
            <div key={note} style={{ fontSize: 10, color: 'var(--wp-text-dim)', padding: '1px 0' }}>{note}</div>
          ))}
        </div>
      )}
    </div>
  );
}
