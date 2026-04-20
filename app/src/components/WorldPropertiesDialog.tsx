import { useState, useEffect } from 'react';
import type { GameMode, ProjectState, SpawnPoint } from '../model/types';
import type { McTargetVersion } from '../export/minecraftExport';

interface WorldPropertiesDialogProps {
  project: ProjectState;
  mcExportVersion: McTargetVersion;
  onMcExportVersionChange: (v: McTargetVersion) => void;
  onClose: () => void;
  onApply: (patch: Partial<Pick<ProjectState, 'name' | 'spawnPoint' | 'gameMode' | 'worldSeed'>>) => void;
}

const GAME_MODES: { value: GameMode; label: string }[] = [
  { value: 'survival',  label: 'Survival' },
  { value: 'creative',  label: 'Creative' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'spectator', label: 'Spectator' },
];

const MC_VERSIONS: { value: McTargetVersion; label: string }[] = [
  { value: '1.16.5', label: 'Java 1.16.5 (Nether Update)' },
  { value: '1.17.1', label: 'Java 1.17.1 (Caves & Cliffs Part 1)' },
  { value: '1.18.2', label: 'Java 1.18.2 (Caves & Cliffs Part 2, Y −64…319)' },
  { value: '1.19.4', label: 'Java 1.19.4 (The Wild Update, Y −64…319)' },
  { value: '1.20.4', label: 'Java 1.20.4 (Trails & Tales, Y −64…319)' },
];

export function WorldPropertiesDialog({ project, mcExportVersion, onMcExportVersionChange, onClose, onApply }: WorldPropertiesDialogProps) {
  const [name, setName] = useState(project.name);
  const [gameMode, setGameMode] = useState<GameMode>(project.gameMode ?? 'survival');
  const [seed, setSeed] = useState(String(project.worldSeed ?? 0));
  const [spawnX, setSpawnX] = useState(String(project.spawnPoint?.x ?? 0));
  const [spawnY, setSpawnY] = useState(String(project.spawnPoint?.y ?? 64));
  const [spawnZ, setSpawnZ] = useState(String(project.spawnPoint?.z ?? 0));

  // Read-only import metadata
  const dim = Object.values(project.dimensions)[0];
  const importMeta = dim?.importMetadata;
  const mcSeed = importMeta?.minecraftSeed ?? project.worldSeed ?? null;
  const dimSeed = importMeta?.dimensionSeed ?? null;

  useEffect(() => {
    setName(project.name);
    setGameMode(project.gameMode ?? 'survival');
    setSeed(String(project.worldSeed ?? 0));
    setSpawnX(String(project.spawnPoint?.x ?? 0));
    setSpawnY(String(project.spawnPoint?.y ?? 64));
    setSpawnZ(String(project.spawnPoint?.z ?? 0));
  }, [project]);

  function handleApply() {
    const spawnPoint: SpawnPoint = {
      x: parseInt(spawnX, 10) || 0,
      y: parseInt(spawnY, 10) || 64,
      z: parseInt(spawnZ, 10) || 0,
    };
    onApply({
      name: name.trim() || project.name,
      gameMode,
      spawnPoint,
      worldSeed: parseInt(seed, 10) || 0,
    });
    onClose();
  }

  return (
    <div className="wp-dialog-overlay" onClick={onClose}>
      <div className="wp-dialog" style={{ minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="wp-dialog-title">
          <span>World Properties</span>
          <button type="button" className="wp-btn-small" onClick={onClose}>✕</button>
        </div>

        <div className="wp-dialog-body">
          {/* World name */}
          <div className="wp-dialog-row">
            <label htmlFor="wp-name">World name</label>
            <input
              id="wp-name"
              className="wp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Game mode */}
          <div className="wp-dialog-row">
            <label htmlFor="wp-gamemode">Game mode</label>
            <select
              id="wp-gamemode"
              className="wp-select"
              value={gameMode}
              onChange={(e) => setGameMode(e.target.value as GameMode)}
            >
              {GAME_MODES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Seed */}
          <div className="wp-dialog-row">
            <label htmlFor="wp-seed">World seed</label>
            <input
              id="wp-seed"
              className="wp-input"
              style={{ width: 120 }}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
            {mcSeed !== null && (
              <span style={{ fontSize: 10, color: 'var(--wp-text-dim)', marginLeft: 8 }}>
                (MC: {mcSeed}{dimSeed !== null ? `, dim: ${dimSeed}` : ''})
              </span>
            )}
          </div>

          {/* Spawn point */}
          <div style={{ marginTop: 8, marginBottom: 4, fontSize: 11, color: 'var(--wp-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Spawn point
          </div>
          <div className="wp-dialog-row">
            <label htmlFor="wp-sx">X</label>
            <input id="wp-sx" className="wp-input" style={{ width: 80 }} value={spawnX} onChange={(e) => setSpawnX(e.target.value)} />
            <label htmlFor="wp-sy" style={{ marginLeft: 8 }}>Y</label>
            <input id="wp-sy" className="wp-input" style={{ width: 80 }} value={spawnY} onChange={(e) => setSpawnY(e.target.value)} />
            <label htmlFor="wp-sz" style={{ marginLeft: 8 }}>Z</label>
            <input id="wp-sz" className="wp-input" style={{ width: 80 }} value={spawnZ} onChange={(e) => setSpawnZ(e.target.value)} />
          </div>

          {/* Dimensions table (read-only) */}
          {Object.values(project.dimensions).length > 0 && (
            <>
              <div style={{ marginTop: 10, marginBottom: 4, fontSize: 11, color: 'var(--wp-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Dimensions
              </div>
              <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--wp-text-dim)' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 2 }}>Name</th>
                    <th style={{ textAlign: 'right' }}>Tiles</th>
                    <th style={{ textAlign: 'right' }}>Y range</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(project.dimensions).map((d) => (
                    <tr key={d.id}>
                      <td style={{ paddingBottom: 2 }}>{d.name}</td>
                      <td style={{ textAlign: 'right' }}>{Object.keys(d.tiles).length}</td>
                      <td style={{ textAlign: 'right' }}>{d.minHeight ?? '?'}..{d.maxHeight ?? '?'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Compatibility */}
          {project.compatibility.notes.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--wp-text-dim)' }}>
              {project.compatibility.notes.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}

          {/* Minecraft export version */}
          <div style={{ marginTop: 10, marginBottom: 4, fontSize: 11, color: 'var(--wp-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Minecraft Export
          </div>
          <div className="wp-dialog-row">
            <label htmlFor="wp-mc-ver">Target version</label>
            <select
              id="wp-mc-ver"
              className="wp-select"
              value={mcExportVersion}
              onChange={(e) => onMcExportVersionChange(e.target.value as McTargetVersion)}
            >
              {MC_VERSIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="wp-dialog-footer">
          <button type="button" className="wp-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="wp-btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}
