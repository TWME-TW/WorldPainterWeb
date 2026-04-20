import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Viewport } from './components/Viewport';
import { canExportPatchedWorldFile, exportPatchedWorldFile } from './export/worldFileExport';
import { canExportMinecraftWorld, exportMinecraftWorld } from './export/minecraftExport';
import { createImportedProject } from './import/createImportedProject';
import { probeWorldFile } from './import/worldFileProbe';
import { createDemoProject } from './model/createDemoProject';
import { applyBrushToProject, applyHeightBrushToProject, type BrushSettings } from './model/editing';
import {
  applyRedoEntry,
  applyUndoEntry,
  MAX_HISTORY_SIZE,
  type HistoryEntry,
} from './model/history';
import {
  TERRAIN_CODES,
  getActiveDimension,
  type DimensionState,
  type ProjectState,
  type TerrainCode,
  type WorldFileDimensionSummary,
  type WorldFileLayerSummary,
  type WorldFilePointSummary,
  type WorldFileProbeResult,
} from './model/types';
import { loadLastProject, saveProjectSnapshot } from './storage/projectStore';

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Not saved yet';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPointSummary(point: WorldFilePointSummary | null): string {
  if (!point) {
    return 'unknown';
  }

  return `${point.x}, ${point.y}`;
}

function formatHeightRange(minHeight: number | null, maxHeight: number | null): string {
  if (minHeight === null || maxHeight === null) {
    return 'unknown';
  }

  return `${minHeight}..${maxHeight}`;
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'unknown' : String(value);
}

function formatTileBounds(dimension: WorldFileDimensionSummary): string {
  if (
    dimension.minTileX === null
    || dimension.maxTileX === null
    || dimension.minTileY === null
    || dimension.maxTileY === null
  ) {
    return 'unknown';
  }

  return `${dimension.minTileX}..${dimension.maxTileX}, ${dimension.minTileY}..${dimension.maxTileY}`;
}

function formatDimensionLabel(dimension: WorldFileDimensionSummary): string {
  return dimension.name ?? dimension.anchor?.defaultName ?? 'Unnamed dimension';
}

function formatLayerLabel(layer: WorldFileLayerSummary): string {
  return layer.name ?? layer.id ?? layer.className.split('.').at(-1) ?? layer.className;
}

function formatBrushToolLabel(tool: BrushSettings['tool']): string {
  switch (tool) {
    case 'raise': return 'Raise terrain';
    case 'lower': return 'Lower terrain';
    case 'raise-water': return 'Raise water';
    case 'lower-water': return 'Lower water';
    case 'paint-terrain': return 'Paint terrain';
  }
}

function getLoadedTileCount(dimension: DimensionState): number {
  return Object.keys(dimension.tiles).length;
}

export default function App() {
  const worldFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<ProjectState | null>(null);
  const [project, setProject] = useState<ProjectState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Loading local project state...');
  const [importStatusMessage, setImportStatusMessage] = useState('No desktop .world file inspected yet.');
  const [worldFileProbe, setWorldFileProbe] = useState<WorldFileProbeResult | null>(null);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    tool: 'raise',
    radius: 10,
    strength: 4,
    paintTerrain: TERRAIN_CODES.grass,
  });
  const [brushStatusMessage, setBrushStatusMessage] = useState('Left drag sculpts terrain. Right drag pans. Mouse wheel zooms.');
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    let cancelled = false;

    loadLastProject()
      .then((savedProject) => {
        if (cancelled) {
          return;
        }

        if (savedProject) {
          projectRef.current = savedProject;
          setProject(savedProject);
          setSaveStatus('saved');
          setLastSavedAt(savedProject.updatedAt);
          setStatusMessage('Restored your last browser-local project snapshot.');
          return;
        }

        const demoProject = createDemoProject();
  projectRef.current = demoProject;
        setProject(demoProject);
        setSaveStatus('idle');
        setStatusMessage('Created a generated draft project to exercise the canonical model and worker renderer.');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const recoveryProject = createDemoProject('Recovery Draft');
        projectRef.current = recoveryProject;
        setProject(recoveryProject);
        setSaveStatus('error');
        setStatusMessage(error instanceof Error ? error.message : 'Failed to restore local project state.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!project) {
      return;
    }

    setSaveStatus((current) => (current === 'loading' ? current : 'saving'));
    const timer = window.setTimeout(() => {
      saveProjectSnapshot(project)
        .then((savedAt) => {
          setLastSavedAt(savedAt);
          setSaveStatus('saved');
        })
        .catch((error: unknown) => {
          setSaveStatus('error');
          setStatusMessage(error instanceof Error ? error.message : 'Autosave failed.');
        });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [project]);

  const activeDimension = useMemo(() => {
    if (!project) {
      return null;
    }

    return getActiveDimension(project);
  }, [project]);

  const compatibilitySummary = project?.compatibility.notes ?? [];
  const dimensionList = useMemo(() => Object.values(project?.dimensions ?? {}), [project]);
  const activeDimensionTileCount = activeDimension ? getLoadedTileCount(activeDimension) : 0;
  const hasEditableTiles = activeDimensionTileCount > 0;
  const activeImportedMetadata = activeDimension?.importMetadata;

  useEffect(() => {
    if (!activeDimension) {
      return;
    }

    setBrushStatusMessage(
      getLoadedTileCount(activeDimension) > 0
        ? 'Left drag sculpts terrain. Right drag pans. Mouse wheel zooms.'
        : 'This dimension has no decoded tile payload yet, so terrain editing is disabled.',
    );
  }, [activeDimension?.id, hasEditableTiles]);

  async function handleManualSave() {
    if (!project) {
      return;
    }

    setSaveStatus('saving');

    try {
      const savedAt = await saveProjectSnapshot(project);
      setLastSavedAt(savedAt);
      setSaveStatus('saved');
      setStatusMessage('Snapshot saved to IndexedDB.');
    } catch (error) {
      setSaveStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Snapshot save failed.');
    }
  }

  function handleNewDraft() {
    const draftProject = createDemoProject(`Draft ${new Date().toLocaleTimeString()}`);
    projectRef.current = draftProject;
    setProject(draftProject);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    setStatusMessage('Started a fresh generated draft project.');
  }

  function handleDownloadWorldFile() {
    if (!project) {
      return;
    }

    try {
      const exportedFile = exportPatchedWorldFile(project);
      const blobBuffer = new ArrayBuffer(exportedFile.bytes.byteLength);
      new Uint8Array(blobBuffer).set(exportedFile.bytes);
      const objectUrl = URL.createObjectURL(new Blob([blobBuffer], { type: 'application/gzip' }));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = exportedFile.fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setStatusMessage(`Downloaded ${exportedFile.fileName} with patched height data across ${exportedFile.patchedTileCount} imported tiles.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Patched .world export failed.');
    }
  }

  function handleExportToMinecraft() {
    if (!project) {
      return;
    }

    try {
      const exported = exportMinecraftWorld(project);
      const blobBuffer = new ArrayBuffer(exported.bytes.byteLength);
      new Uint8Array(blobBuffer).set(exported.bytes);
      const objectUrl = URL.createObjectURL(new Blob([blobBuffer], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = exported.fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setStatusMessage(`Downloaded ${exported.fileName}: ${exported.chunkCount} chunks across ${exported.regionCount} region file${exported.regionCount === 1 ? '' : 's'}. Extract and open in Minecraft 1.17.1.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Minecraft export failed.');
    }
  }

  function handleActivateDimension(dimensionId: string) {
    const currentProject = projectRef.current;
    if (!currentProject || currentProject.activeDimensionId === dimensionId) {
      return;
    }

    const nextDimension = currentProject.dimensions[dimensionId];
    if (!nextDimension) {
      return;
    }

    const nextProject: ProjectState = {
      ...currentProject,
      activeDimensionId: dimensionId,
      updatedAt: new Date().toISOString(),
    };

    projectRef.current = nextProject;
    setProject(nextProject);
    setStatusMessage(`Switched to ${nextDimension.name}.`);
  }

  const handleUndo = useCallback(() => {
    const currentProject = projectRef.current;
    setHistoryPast((past) => {
      if (past.length === 0 || !currentProject) {
        return past;
      }

      const entry = past[past.length - 1];
      const nextProject = applyUndoEntry(currentProject, entry);
      projectRef.current = nextProject;
      setProject(nextProject);
      setHistoryFuture((future) => [entry, ...future]);
      setBrushStatusMessage('Undo applied.');
      return past.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    const currentProject = projectRef.current;
    setHistoryFuture((future) => {
      if (future.length === 0 || !currentProject) {
        return future;
      }

      const entry = future[0];
      const nextProject = applyRedoEntry(currentProject, entry);
      projectRef.current = nextProject;
      setProject(nextProject);
      setHistoryPast((past) => {
        const next = [...past, entry];
        return next.length > MAX_HISTORY_SIZE ? next.slice(next.length - MAX_HISTORY_SIZE) : next;
      });
      setBrushStatusMessage('Redo applied.');
      return future.slice(1);
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      } else if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  function handleApplyBrush(worldX: number, worldY: number) {
    const currentProject = projectRef.current;
    if (!currentProject) {
      return;
    }

    const result = applyBrushToProject(currentProject, currentProject.activeDimensionId, {
      worldX,
      worldY,
    }, brushSettings);

    if (result.project === currentProject) {
      return;
    }

    // Capture before/after tile states for undo.
    const dimensionId = currentProject.activeDimensionId;
    const oldDimension = currentProject.dimensions[dimensionId];
    if (oldDimension && result.changedTileKeys.length > 0) {
      const tilesBefore: HistoryEntry['tilesBefore'] = {};
      const tilesAfter: HistoryEntry['tilesAfter'] = {};
      for (const key of result.changedTileKeys) {
        if (oldDimension.tiles[key]) {
          tilesBefore[key] = oldDimension.tiles[key];
        }
        const nextTile = result.project.dimensions[dimensionId]?.tiles[key];
        if (nextTile) {
          tilesAfter[key] = nextTile;
        }
      }
      const entry: HistoryEntry = { dimensionId, tilesBefore, tilesAfter };
      setHistoryPast((past) => {
        const next = [...past, entry];
        return next.length > MAX_HISTORY_SIZE ? next.slice(next.length - MAX_HISTORY_SIZE) : next;
      });
      setHistoryFuture([]);
    }

    projectRef.current = result.project;
    setProject(result.project);
    setBrushStatusMessage(
      `${formatBrushToolLabel(brushSettings.tool)} updated ${result.changedSampleCount} samples across ${result.changedTileCount} tile${result.changedTileCount === 1 ? '' : 's'}.`,
    );
  }

  function handleOpenWorldFilePicker() {
    worldFileInputRef.current?.click();
  }

  async function handleWorldFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setImportStatusMessage(`Inspecting ${file.name}...`);
    setWorldFileProbe(null);

    try {
      const probe = await probeWorldFile(file);
      setWorldFileProbe(probe);

      if (probe.status === 'recognized') {
        const importedName = probe.worldSummary?.name ?? probe.metadata?.name;
        const importedLabel = importedName ? ` ${importedName}` : '';
        const importedProject = createImportedProject(probe);

        if (importedProject) {
          const importedTileCount = probe.worldSummary?.dimensions.reduce((count, dimension) => count + dimension.tiles.length, 0) ?? 0;
          projectRef.current = importedProject;
          setProject(importedProject);
          setHistoryPast([]);
          setHistoryFuture([]);
          setLastSavedAt(importedProject.updatedAt);
          setSaveStatus('idle');
          setStatusMessage(
            importedTileCount > 0
              ? `Loaded a browser-local imported project with ${importedTileCount} decoded tiles from the desktop .world file.`
              : 'Loaded a browser-local imported project shell from the desktop .world summary.',
          );
        }

        setImportStatusMessage(`Recognized desktop WorldPainter container for${importedLabel}.`);
      } else if (probe.status === 'partial') {
        setImportStatusMessage('Recognized the container format, but parsing only reached a partial compatibility report.');
      } else {
        setImportStatusMessage('The selected file does not currently look like a supported WorldPainter .world container.');
      }
    } catch (error) {
      setImportStatusMessage(error instanceof Error ? error.message : 'World file inspection failed.');
    }
  }

  if (!project || !activeDimension) {
    return <div className="app-loading">Preparing WorldPainterWeb...</div>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">WorldPainterWeb</p>
          <h1>Browser-native terrain shell</h1>
          <p className="subdued">
            Canonical model, Web Worker rendering, local persistence, editable terrain with undo/redo, semantic .world import, height+water patch save, and first-pass Minecraft 1.17.1 export are in place. Layer-aware save and broader Minecraft biome/material fidelity remain the next workstreams.
          </p>
        </div>
        <div className="header-actions">
          <input
            ref={worldFileInputRef}
            className="visually-hidden-input"
            type="file"
            accept=".world,.gz,application/gzip"
            onChange={handleWorldFileSelected}
          />
          <button className="ghost-button" type="button" onClick={handleOpenWorldFilePicker}>
            Inspect .world File
          </button>
          <button className="ghost-button" type="button" onClick={handleNewDraft}>
            New Draft
          </button>
          {canExportPatchedWorldFile(project) ? (
            <button className="ghost-button" type="button" onClick={handleDownloadWorldFile}>
              Download .world
            </button>
          ) : null}
          {canExportMinecraftWorld(project) ? (
            <button className="ghost-button" type="button" onClick={handleExportToMinecraft}>
              Export to Minecraft
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={handleManualSave}>
            Save Snapshot
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="app-sidebar">
          <div className="sidebar-card accent-card">
            <p className="card-label">Project</p>
            <h2>{project.name}</h2>
            <p>{statusMessage}</p>
            <dl className="meta-list">
              <div>
                <dt>Source</dt>
                <dd>{project.source}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>v{project.schemaVersion}</dd>
              </div>
              <div>
                <dt>Last saved</dt>
                <dd>{formatTimestamp(lastSavedAt)}</dd>
              </div>
              <div>
                <dt>Save state</dt>
                <dd>{saveStatus}</dd>
              </div>
            </dl>
          </div>

          <div className="sidebar-card">
            <p className="card-label">Compatibility workstream</p>
            <h2>Adapter status</h2>
            <div className="status-grid">
              <span>Read .world</span>
              <strong>{project.compatibility.readSupport}</strong>
              <span>Write .world</span>
              <strong>{project.compatibility.writeSupport}</strong>
              <span>Export world</span>
              <strong>{project.compatibility.exportSupport}</strong>
            </div>
            <ul className="note-list">
              {compatibilitySummary.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          <div className="sidebar-card">
            <p className="card-label">Terrain brush</p>
            <h2>{formatBrushToolLabel(brushSettings.tool)}</h2>
            <p>{brushStatusMessage}</p>
            <div className="segmented-control" role="tablist" aria-label="Terrain brush tool">
              <button
                className={`segmented-button ${brushSettings.tool === 'raise' ? 'active' : ''}`}
                type="button"
                onClick={() => setBrushSettings((current) => ({ ...current, tool: 'raise' }))}
              >
                Raise
              </button>
              <button
                className={`segmented-button ${brushSettings.tool === 'lower' ? 'active' : ''}`}
                type="button"
                onClick={() => setBrushSettings((current) => ({ ...current, tool: 'lower' }))}
              >
                Lower
              </button>
              <button
                className={`segmented-button ${brushSettings.tool === 'raise-water' ? 'active' : ''}`}
                type="button"
                onClick={() => setBrushSettings((current) => ({ ...current, tool: 'raise-water' }))}
              >
                Water +
              </button>
              <button
                className={`segmented-button ${brushSettings.tool === 'lower-water' ? 'active' : ''}`}
                type="button"
                onClick={() => setBrushSettings((current) => ({ ...current, tool: 'lower-water' }))}
              >
                Water −
              </button>
              <button
                className={`segmented-button segmented-button-wide ${brushSettings.tool === 'paint-terrain' ? 'active' : ''}`}
                type="button"
                onClick={() => setBrushSettings((current) => ({ ...current, tool: 'paint-terrain' }))}
              >
                Paint terrain
              </button>
            </div>
            {brushSettings.tool === 'paint-terrain' ? (
              <div className="terrain-palette" role="radiogroup" aria-label="Terrain to paint">
                {([
                  [TERRAIN_CODES.grass, 'Grass', '#58824e'],
                  [TERRAIN_CODES.sand, 'Sand', '#c9b274'],
                  [TERRAIN_CODES.stone, 'Stone', '#7a7670'],
                  [TERRAIN_CODES.snow, 'Snow', '#ebf0f2'],
                  [TERRAIN_CODES.water, 'Water', '#3670aa'],
                ] as Array<[TerrainCode, string, string]>).map(([code, label, color]) => (
                  <button
                    key={code}
                    className={`terrain-swatch ${brushSettings.paintTerrain === code ? 'active' : ''}`}
                    type="button"
                    title={label}
                    aria-label={label}
                    style={{ '--swatch-color': color } as React.CSSProperties}
                    onClick={() => setBrushSettings((current) => ({ ...current, paintTerrain: code }))}
                  />
                ))}
              </div>
            ) : null}
            <div className="undo-redo-row">
              <button
                className="ghost-button"
                type="button"
                disabled={historyPast.length === 0}
                onClick={handleUndo}
                title="Undo last brush stroke (Ctrl+Z)"
              >
                Undo
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={historyFuture.length === 0}
                onClick={handleRedo}
                title="Redo brush stroke (Ctrl+Y / Ctrl+Shift+Z)"
              >
                Redo
              </button>
              <span className="undo-count">
                {historyPast.length > 0 ? `${historyPast.length} step${historyPast.length === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            <label className="range-field" htmlFor="brush-radius">
              <span>Brush radius</span>
              <strong>{brushSettings.radius}</strong>
            </label>
            <input
              id="brush-radius"
              type="range"
              min="2"
              max="48"
              step="1"
              value={brushSettings.radius}
              onChange={(event) => setBrushSettings((current) => ({ ...current, radius: Number(event.target.value) }))}
            />
            <label className="range-field" htmlFor="brush-strength">
              <span>Brush strength</span>
              <strong>{brushSettings.strength}</strong>
            </label>
            <input
              id="brush-strength"
              type="range"
              min="1"
              max="16"
              step="1"
              value={brushSettings.strength}
              onChange={(event) => setBrushSettings((current) => ({ ...current, strength: Number(event.target.value) }))}
            />
            <p className="helper-text">
              {hasEditableTiles
                ? 'Brush edits update the canonical model. Undo/redo (Ctrl+Z / Ctrl+Y) preserves up to 50 steps. Imported worlds export patched heights and water levels back into the original .world container.'
                : 'Inspect mode only. This dimension does not currently contain editable tile payload.'}
            </p>
          </div>

          <div className="sidebar-card">
            <p className="card-label">Import inspection</p>
            <h2>{worldFileProbe?.worldSummary?.name ?? worldFileProbe?.metadata?.name ?? worldFileProbe?.fileName ?? 'Desktop .world probe'}</h2>
            <p>{importStatusMessage}</p>
            {worldFileProbe ? (
              <>
                <dl className="meta-list compact-meta-list">
                  <div>
                    <dt>Compression</dt>
                    <dd>{worldFileProbe.compression}</dd>
                  </div>
                  <div>
                    <dt>Serialization</dt>
                    <dd>{worldFileProbe.serialization}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{worldFileProbe.status}</dd>
                  </div>
                  <div>
                    <dt>Root class</dt>
                    <dd>{worldFileProbe.worldRootClass ?? 'unknown'}</dd>
                  </div>
                  <div>
                    <dt>File size</dt>
                    <dd>{(worldFileProbe.fileSize / 1024).toFixed(1)} KB</dd>
                  </div>
                  <div>
                    <dt>Platform</dt>
                    <dd>{worldFileProbe.worldSummary?.platformName ?? worldFileProbe.worldSummary?.platformId ?? 'unknown'}</dd>
                  </div>
                  <div>
                    <dt>Height range</dt>
                    <dd>{formatHeightRange(worldFileProbe.worldSummary?.minHeight ?? null, worldFileProbe.worldSummary?.maxHeight ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Spawn point</dt>
                    <dd>{formatPointSummary(worldFileProbe.worldSummary?.spawnPoint ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>{worldFileProbe.worldSummary?.dimensions.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Saved with</dt>
                    <dd>
                      {worldFileProbe.metadata?.wpVersion
                        ? worldFileProbe.metadata.wpBuild
                          ? `${worldFileProbe.metadata.wpVersion} (${worldFileProbe.metadata.wpBuild})`
                          : worldFileProbe.metadata.wpVersion
                        : 'unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt>Timestamp</dt>
                    <dd>{formatTimestamp(worldFileProbe.metadata?.timestamp ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Plugins</dt>
                    <dd>{worldFileProbe.metadata?.plugins.length ?? 0}</dd>
                  </div>
                </dl>

                {worldFileProbe.worldSummary?.dimensions.length ? (
                  <>
                    <p className="card-label">Dimension summary</p>
                    <ul className="note-list plugin-list">
                      {worldFileProbe.worldSummary.dimensions.map((dimension) => (
                        <li key={`${dimension.anchor?.dim ?? 'x'}-${dimension.anchor?.role ?? 'unknown'}-${dimension.anchor?.invert ?? false}-${dimension.anchor?.id ?? 0}`}>
                          {formatDimensionLabel(dimension)}
                          {' · '}
                          {dimension.tileCount ?? 0} tiles
                          {' · bounds '}
                          {formatTileBounds(dimension)}
                          {' · height '}
                          {formatHeightRange(dimension.minHeight, dimension.maxHeight)}
                          {' · settings '}
                          {dimension.layerSettings.length}
                          {' · layer buffers '}
                          {dimension.tileLayerBufferCount + dimension.tileBitLayerBufferCount}
                          {' · seeds '}
                          {dimension.seedCount}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {worldFileProbe.metadata?.plugins.length ? (
                  <ul className="note-list plugin-list">
                    {worldFileProbe.metadata.plugins.map((plugin) => (
                      <li key={`${plugin.name}-${plugin.version}`}>
                        {plugin.name} ({plugin.version})
                      </li>
                    ))}
                  </ul>
                ) : null}

                <ul className="note-list">
                  {worldFileProbe.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <div className="sidebar-card">
            <p className="card-label">Dimension</p>
            <h2>{activeDimension.name}</h2>
            <div className="dimension-list" role="tablist" aria-label="Project dimensions">
              {dimensionList.map((dimension) => {
                const loadedTileCount = getLoadedTileCount(dimension);

                return (
                  <button
                    key={dimension.id}
                    className={`dimension-button ${dimension.id === activeDimension.id ? 'active' : ''}`}
                    type="button"
                    onClick={() => handleActivateDimension(dimension.id)}
                  >
                    <strong>{dimension.name}</strong>
                    <span>{loadedTileCount} loaded tiles</span>
                  </button>
                );
              })}
            </div>
            <dl className="meta-list">
              <div>
                <dt>Tile size</dt>
                <dd>{activeDimension.tileSize}</dd>
              </div>
              <div>
                <dt>Height range</dt>
                <dd>{formatHeightRange(activeDimension.minHeight, activeDimension.maxHeight)}</dd>
              </div>
              <div>
                <dt>Tile bounds</dt>
                <dd>
                  {activeDimension.minTileX},{activeDimension.minTileY} to {activeDimension.maxTileX},{activeDimension.maxTileY}
                </dd>
              </div>
              <div>
                <dt>Tile count</dt>
                <dd>{activeDimensionTileCount}</dd>
              </div>
              {activeImportedMetadata ? (
                <>
                  <div>
                    <dt>Dimension seed</dt>
                    <dd>{formatNullableNumber(activeImportedMetadata.dimensionSeed)}</dd>
                  </div>
                  <div>
                    <dt>Minecraft seed</dt>
                    <dd>{formatNullableNumber(activeImportedMetadata.minecraftSeed)}</dd>
                  </div>
                  <div>
                    <dt>Layer settings</dt>
                    <dd>{activeImportedMetadata.layerSettings.length}</dd>
                  </div>
                  <div>
                    <dt>Value layers</dt>
                    <dd>{activeImportedMetadata.tileLayerBufferCount}</dd>
                  </div>
                  <div>
                    <dt>Bit layers</dt>
                    <dd>{activeImportedMetadata.tileBitLayerBufferCount}</dd>
                  </div>
                  <div>
                    <dt>Garden seeds</dt>
                    <dd>{activeImportedMetadata.seedCount}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {activeImportedMetadata?.availableLayers.length ? (
              <>
                <p className="card-label">Preserved layers</p>
                <ul className="note-list">
                  {activeImportedMetadata.availableLayers.slice(0, 8).map((layer) => (
                    <li key={`${layer.className}-${layer.id ?? layer.name ?? 'layer'}`}>
                      {formatLayerLabel(layer)}
                      {' · '}
                      {layer.dataSize}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </section>

        <section className="app-content">
          <Viewport
            dimension={activeDimension}
            brushSettings={brushSettings}
            editable={hasEditableTiles}
            onApplyBrush={handleApplyBrush}
          />
        </section>
      </main>
    </div>
  );
}