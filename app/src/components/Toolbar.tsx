interface ToolbarProps {
  onNewWorld: () => void;
  onOpenWorld: () => void;
  onSaveWorld: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpenWorldFilePicker: () => void;
  onExportMinecraft: () => void;
  canExportMinecraft: boolean;
  onDownloadWorldFile: () => void;
  canDownloadWorldFile: boolean;
  worldFileInputRef: React.RefObject<HTMLInputElement>;
  onWorldFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function Toolbar({
  onNewWorld,
  onOpenWorld,
  onSaveWorld,
  onUndo,
  onRedo,
  canSave,
  canUndo,
  canRedo,
  onOpenWorldFilePicker,
  onExportMinecraft,
  canExportMinecraft,
  onDownloadWorldFile,
  canDownloadWorldFile,
  worldFileInputRef,
  onWorldFileChange,
}: ToolbarProps) {
  return (
    <div className="wp-toolbar">
      <input
        ref={worldFileInputRef}
        className="visually-hidden-input"
        type="file"
        accept=".world,.gz,application/gzip"
        onChange={onWorldFileChange}
      />
      <button className="wp-tb-btn" title="New World (Ctrl+N)" type="button" onClick={onNewWorld}>
        📄
      </button>
      <button className="wp-tb-btn" title="Open .world File" type="button" onClick={onOpenWorldFilePicker}>
        📂
      </button>
      <button className="wp-tb-btn" title="Save Snapshot (Ctrl+S)" type="button" onClick={onSaveWorld} disabled={!canSave}>
        💾
      </button>
      <div className="wp-toolbar-sep" />
      <button className="wp-tb-btn" title="Undo (Ctrl+Z)" type="button" onClick={onUndo} disabled={!canUndo}>
        ↩
      </button>
      <button className="wp-tb-btn" title="Redo (Ctrl+Y)" type="button" onClick={onRedo} disabled={!canRedo}>
        ↪
      </button>
      <div className="wp-toolbar-sep" />
      <button className="wp-tb-btn" title="Download .world File" type="button" onClick={onDownloadWorldFile} disabled={!canDownloadWorldFile}>
        ⬇
      </button>
      <button className="wp-tb-btn" title="Export to Minecraft" type="button" onClick={onExportMinecraft} disabled={!canExportMinecraft}>
        ⚡
      </button>
    </div>
  );
}
