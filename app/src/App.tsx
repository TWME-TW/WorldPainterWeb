import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { BrushOptionsPanel } from './components/BrushOptionsPanel';
import { LayersPanel } from './components/LayersPanel';
import { MenuBar } from './components/MenuBar';
import { StatusBar } from './components/StatusBar';
import { ToolPanel } from './components/ToolPanel';
import { Viewport } from './components/Viewport';
import { WorldPropertiesDialog } from './components/WorldPropertiesDialog';
import { canExportPatchedWorldFile, exportPatchedWorldFile } from './export/worldFileExport';
import { canExportMinecraftWorld, exportMinecraftWorld, type McTargetVersion } from './export/minecraftExport';
import { createImportedProject } from './import/createImportedProject';
import { probeWorldFile } from './import/worldFileProbe';
import { createDemoProject } from './model/createDemoProject';
import { applyBrushToProject, type BrushSettings } from './model/editing';
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
} from './model/types';
import { loadLastProject, saveProjectSnapshot } from './storage/projectStore';

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not saved yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function getLoadedTileCount(dimension: DimensionState): number {
  return Object.keys(dimension.tiles).length;
}

function saveStatusLabel(status: SaveStatus, lastSavedAt: string | null): string {
  switch (status) {
    case 'loading':  return 'Loading...';
    case 'saving':   return 'Saving...';
    case 'saved':    return `Saved ${formatTimestamp(lastSavedAt)}`;
    case 'error':    return 'Save error';
    default:         return 'Unsaved';
  }
}

// ─── New World dialog state ───────────────────────────────────────────────────
interface NewWorldDialogState {
  open: boolean;
  name: string;
}

// ─── About dialog ─────────────────────────────────────────────────────────────
interface AboutDialogState { open: boolean; }

export default function App() {
  const worldFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<ProjectState | null>(null);

  const [project, setProject] = useState<ProjectState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Loading...');
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    tool: 'raise',
    radius: 10,
    strength: 4,
    paintTerrain: TERRAIN_CODES.grass,
    flattenLevel: 64,
  });
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);
  const [cursorWorldX, setCursorWorldX] = useState<number | null>(null);
  const [cursorWorldY, setCursorWorldY] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [newWorldDialog, setNewWorldDialog] = useState<NewWorldDialogState>({ open: false, name: '' });
  const [aboutDialog, setAboutDialog] = useState<AboutDialogState>({ open: false });
  const [worldPropertiesOpen, setWorldPropertiesOpen] = useState(false);
  const [mcExportVersion, setMcExportVersion] = useState<McTargetVersion>('1.17.1');

  useEffect(() => { projectRef.current = project; }, [project]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadLastProject()
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          projectRef.current = saved;
          setProject(saved);
          setSaveStatus('saved');
          setLastSavedAt(saved.updatedAt);
          setStatusMessage('Restored last project snapshot.');
          return;
        }
        const demo = createDemoProject();
        projectRef.current = demo;
        setProject(demo);
        setSaveStatus('idle');
        setStatusMessage('New demo project created.');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const recovery = createDemoProject('Recovery Draft');
        projectRef.current = recovery;
        setProject(recovery);
        setSaveStatus('error');
        setStatusMessage(err instanceof Error ? err.message : 'Failed to restore project.');
      });
    return () => { cancelled = true; };
  }, []);

  // ── Autosave ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!project) return;
    setSaveStatus((s) => (s === 'loading' ? s : 'saving'));
    const timer = window.setTimeout(() => {
      saveProjectSnapshot(project)
        .then((savedAt) => { setLastSavedAt(savedAt); setSaveStatus('saved'); })
        .catch((err: unknown) => {
          setSaveStatus('error');
          setStatusMessage(err instanceof Error ? err.message : 'Autosave failed.');
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project]);

  const activeDimension = useMemo(
    () => (project ? getActiveDimension(project) : null),
    [project],
  );

  const dimensionList = useMemo(
    () => Object.values(project?.dimensions ?? {}),
    [project],
  );

  const hasEditableTiles = activeDimension ? getLoadedTileCount(activeDimension) > 0 : false;

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    const cur = projectRef.current;
    setHistoryPast((past) => {
      if (past.length === 0 || !cur) return past;
      const entry = past[past.length - 1];
      const next = applyUndoEntry(cur, entry);
      projectRef.current = next;
      setProject(next);
      setHistoryFuture((f) => [entry, ...f]);
      setStatusMessage('Undo applied.');
      return past.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    const cur = projectRef.current;
    setHistoryFuture((future) => {
      if (future.length === 0 || !cur) return future;
      const entry = future[0];
      const next = applyRedoEntry(cur, entry);
      projectRef.current = next;
      setProject(next);
      setHistoryPast((p) => {
        const n = [...p, entry];
        return n.length > MAX_HISTORY_SIZE ? n.slice(n.length - MAX_HISTORY_SIZE) : n;
      });
      setStatusMessage('Redo applied.');
      return future.slice(1);
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  // ── Brush application ─────────────────────────────────────────────────────
  function handleApplyBrush(worldX: number, worldY: number) {
    const cur = projectRef.current;
    if (!cur) return;

    // set-spawn is a click tool — directly update spawn point
    if (brushSettings.tool === 'set-spawn') {
      const h = getActiveDimension(cur).tiles[`${Math.floor(worldX / 128)},${Math.floor(worldY / 128)}`];
      const spawnY = h ? (h.heights[
        (worldX - Math.floor(worldX / 128) * 128) +
        (worldY - Math.floor(worldY / 128) * 128) * 128
      ] ?? 64) + 1 : 64;
      const next: ProjectState = { ...cur, spawnPoint: { x: worldX, y: spawnY, z: worldY }, updatedAt: new Date().toISOString() };
      projectRef.current = next;
      setProject(next);
      setStatusMessage(`Spawn point set to (${worldX}, ${spawnY}, ${worldY}).`);
      return;
    }

    const result = applyBrushToProject(cur, cur.activeDimensionId, { worldX, worldY }, brushSettings);
    if (result.project === cur) return;

    const dimId = cur.activeDimensionId;
    const oldDim = cur.dimensions[dimId];
    if (oldDim && result.changedTileKeys.length > 0) {
      const tilesBefore: HistoryEntry['tilesBefore'] = {};
      const tilesAfter: HistoryEntry['tilesAfter'] = {};
      for (const key of result.changedTileKeys) {
        if (oldDim.tiles[key]) tilesBefore[key] = oldDim.tiles[key];
        const t = result.project.dimensions[dimId]?.tiles[key];
        if (t) tilesAfter[key] = t;
      }
      setHistoryPast((p) => {
        const n = [...p, { dimensionId: dimId, tilesBefore, tilesAfter }];
        return n.length > MAX_HISTORY_SIZE ? n.slice(n.length - MAX_HISTORY_SIZE) : n;
      });
      setHistoryFuture([]);
    }

    projectRef.current = result.project;
    setProject(result.project);
    setStatusMessage(`${brushSettings.tool}: ${result.changedSampleCount} samples in ${result.changedTileCount} tile(s).`);
  }

  // ── File actions ──────────────────────────────────────────────────────────
  function handleNewWorld() {
    setNewWorldDialog({ open: true, name: `My World ${new Date().toLocaleDateString()}` });
  }

  function handleConfirmNewWorld() {
    const name = newWorldDialog.name.trim() || 'New World';
    const p = createDemoProject(name);
    projectRef.current = p;
    setProject(p);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSaveStatus('idle');
    setStatusMessage(`Created "${name}".`);
    setNewWorldDialog({ open: false, name: '' });
  }

  function handleOpenWorld() { worldFileInputRef.current?.click(); }

  async function handleSaveWorld() {
    if (!project) return;
    setSaveStatus('saving');
    try {
      const savedAt = await saveProjectSnapshot(project);
      setLastSavedAt(savedAt);
      setSaveStatus('saved');
      setStatusMessage('Saved to browser storage.');
    } catch (e) {
      setSaveStatus('error');
      setStatusMessage(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  function handleDownloadWorldFile() {
    if (!project) return;
    try {
      const exported = exportPatchedWorldFile(project);
      const url = URL.createObjectURL(new Blob([exported.bytes.buffer as ArrayBuffer], { type: 'application/gzip' }));
      const a = document.createElement('a');
      a.href = url; a.download = exported.fileName; a.click();
      URL.revokeObjectURL(url);
      setStatusMessage(`Downloaded ${exported.fileName} (${exported.patchedTileCount} tiles patched).`);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : '.world export failed.');
    }
  }

  function handleExportMinecraft() {
    if (!project) return;
    try {
      const exported = exportMinecraftWorld(project, mcExportVersion);
      const url = URL.createObjectURL(new Blob([exported.bytes.buffer as ArrayBuffer], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = exported.fileName; a.click();
      URL.revokeObjectURL(url);
      setStatusMessage(`Exported ${exported.fileName}: ${exported.chunkCount} chunks in ${exported.regionCount} region(s).`);
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Minecraft export failed.');
    }
  }

  async function handleWorldFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatusMessage(`Opening ${file.name}...`);
    try {
      const probe = await probeWorldFile(file);
      if (probe.status === 'recognized') {
        const imported = createImportedProject(probe);
        if (imported) {
          const tileCount = probe.worldSummary?.dimensions.reduce((c, d) => c + d.tiles.length, 0) ?? 0;
          projectRef.current = imported;
          setProject(imported);
          setHistoryPast([]);
          setHistoryFuture([]);
          setLastSavedAt(imported.updatedAt);
          setSaveStatus('idle');
          setStatusMessage(`Opened ${probe.worldSummary?.name ?? file.name} (${tileCount} tiles).`);
        } else {
          setStatusMessage(`Opened ${file.name} but no editable tile data found.`);
        }
      } else {
        setStatusMessage(`Could not recognise ${file.name} as a WorldPainter .world file.`);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to open file.');
    }
  }

  function handleActivateDimension(dimId: string) {
    const cur = projectRef.current;
    if (!cur || cur.activeDimensionId === dimId) return;
    const dim = cur.dimensions[dimId];
    if (!dim) return;
    const next: ProjectState = { ...cur, activeDimensionId: dimId, updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
    setStatusMessage(`Switched to ${dim.name}.`);
  }

  function handleWorldProperties() { setWorldPropertiesOpen(true); }

  function handleApplyWorldProperties(patch: Partial<ProjectState>) {
    const cur = projectRef.current;
    if (!cur) return;
    const next: ProjectState = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
    setWorldPropertiesOpen(false);
    setStatusMessage('World properties updated.');
  }

  // ── Cursor tracking from Viewport ─────────────────────────────────────────
  function handleViewportCursorMove(worldX: number, worldY: number) {
    setCursorWorldX(worldX);
    setCursorWorldY(worldY);
  }

  function handleViewportCursorLeave() {
    setCursorWorldX(null);
    setCursorWorldY(null);
  }

  if (!project || !activeDimension) {
    return <div className="app-loading">Preparing WorldPainterWeb...</div>;
  }

  const canSave = saveStatus !== 'loading';
  const canDownload = project ? canExportPatchedWorldFile(project) : false;
  const canExport  = project ? canExportMinecraftWorld(project) : false;

  return (
    <div className="wp-root">

      {/* ── Menu bar ── */}
      <MenuBar
        onNewWorld={handleNewWorld}
        onOpenWorld={handleOpenWorld}
        onSaveWorld={handleSaveWorld}
        onDownloadWorldFile={handleDownloadWorldFile}
        onExportMinecraft={handleExportMinecraft}
        canSaveWorld={canSave}
        canDownloadWorldFile={canDownload}
        canExportMinecraft={canExport}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onAbout={() => setAboutDialog({ open: true })}
        onWorldProperties={handleWorldProperties}
      />

      {/* Hidden file input */}
      <input
        ref={worldFileInputRef}
        className="visually-hidden-input"
        type="file"
        accept=".world,.gz,application/gzip"
        onChange={handleWorldFileSelected}
      />

      {/* ── Toolbar ── */}
      <div className="wp-toolbar">
        <button type="button" className="wp-tb-btn" title="New World" onClick={handleNewWorld}>📄</button>
        <button type="button" className="wp-tb-btn" title="Open .world" onClick={handleOpenWorld}>📂</button>
        <button type="button" className="wp-tb-btn" title="Save" disabled={!canSave} onClick={handleSaveWorld}>💾</button>
        <div className="wp-toolbar-sep" />
        <button type="button" className="wp-tb-btn" title="Undo (Ctrl+Z)" disabled={historyPast.length === 0} onClick={handleUndo}>↩</button>
        <button type="button" className="wp-tb-btn" title="Redo (Ctrl+Y)" disabled={historyFuture.length === 0} onClick={handleRedo}>↪</button>
        <div className="wp-toolbar-sep" />
        {canDownload && <button type="button" className="wp-tb-btn" title="Download .world" onClick={handleDownloadWorldFile}>⬇</button>}
        {canExport  && <button type="button" className="wp-tb-btn" title="Export to Minecraft" onClick={handleExportMinecraft}>⚡</button>}
      </div>

      {/* ── Workspace ── */}
      <div className="wp-workspace">

        {/* Left: tool panel */}
        <ToolPanel
          activeTool={brushSettings.tool}
          onSelectTool={(tool) => setBrushSettings((s) => ({ ...s, tool }))}
        />

        {/* Centre: viewport */}
        <div className="wp-viewport-area">
          {/* Dimension tabs */}
          <div className="wp-viewport-topbar">
            {dimensionList.map((dim) => (
              <button
                key={dim.id}
                type="button"
                className={`wp-dim-tab${dim.id === activeDimension.id ? ' active' : ''}`}
                onClick={() => handleActivateDimension(dim.id)}
              >
                {dim.name}
              </button>
            ))}
          </div>
          <div className="wp-viewport-stage">
            <Viewport
              dimension={activeDimension}
              brushSettings={brushSettings}
              editable={hasEditableTiles}
              onApplyBrush={handleApplyBrush}
              onZoomChange={setZoom}
              onCursorMove={handleViewportCursorMove}
              onCursorLeave={handleViewportCursorLeave}
            />
          </div>
        </div>

        {/* Right: layers panel */}
        <LayersPanel
          project={project}
          activeDimension={activeDimension}
          onActivateDimension={handleActivateDimension}
        />
      </div>

      {/* ── Brush options panel ── */}
      <BrushOptionsPanel
        brushSettings={brushSettings}
        onChangeBrush={setBrushSettings}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        undoCount={historyPast.length}
        redoCount={historyFuture.length}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* ── Status bar ── */}
      <StatusBar
        message={statusMessage}
        worldX={cursorWorldX}
        worldY={cursorWorldY}
        zoom={zoom}
        saveStatus={saveStatusLabel(saveStatus, lastSavedAt)}
      />

      {/* ── New World dialog ── */}
      {newWorldDialog.open && (
        <div className="wp-dialog-overlay" onClick={() => setNewWorldDialog((s) => ({ ...s, open: false }))}>
          <div className="wp-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="wp-dialog-title">
              <span>New World</span>
              <button type="button" className="wp-btn-small" onClick={() => setNewWorldDialog((s) => ({ ...s, open: false }))}>✕</button>
            </div>
            <div className="wp-dialog-body">
              <div className="wp-dialog-row">
                <label htmlFor="nw-name">World name</label>
                <input
                  id="nw-name"
                  className="wp-input"
                  value={newWorldDialog.name}
                  onChange={(e) => setNewWorldDialog((s) => ({ ...s, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmNewWorld(); }}
                  autoFocus
                />
              </div>
            </div>
            <div className="wp-dialog-footer">
              <button type="button" className="wp-btn-secondary" onClick={() => setNewWorldDialog((s) => ({ ...s, open: false }))}>Cancel</button>
              <button type="button" className="wp-btn-primary" onClick={handleConfirmNewWorld}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── About dialog ── */}
      {aboutDialog.open && (
        <div className="wp-dialog-overlay" onClick={() => setAboutDialog({ open: false })}>
          <div className="wp-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="wp-dialog-title">
              <span>About WorldPainterWeb</span>
              <button type="button" className="wp-btn-small" onClick={() => setAboutDialog({ open: false })}>✕</button>
            </div>
            <div className="wp-dialog-body" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <p><strong>WorldPainterWeb</strong> — a browser-native re-implementation of WorldPainter's terrain sculpting.</p>
              <p>Features: Raise/Lower/Flatten/Smooth/Erode/Mountain/Flood brushes, Spray Paint, Sponge, Set Spawn, World Properties, Undo/Redo (50 steps), .world import, patched .world export, Minecraft 1.16.5–1.20.4 export, IndexedDB autosave.</p>
              <p style={{ color: 'var(--wp-text-dim)' }}>This is an independent open-source project and is not affiliated with the original WorldPainter desktop application.</p>
            </div>
            <div className="wp-dialog-footer">
              <button type="button" className="wp-btn-secondary" onClick={() => setAboutDialog({ open: false })}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── World Properties dialog ── */}
      {worldPropertiesOpen && project && (
        <WorldPropertiesDialog
          project={project}
          mcExportVersion={mcExportVersion}
          onMcExportVersionChange={setMcExportVersion}
          onClose={() => setWorldPropertiesOpen(false)}
          onApply={handleApplyWorldProperties}
        />
      )}
    </div>
  );
}
