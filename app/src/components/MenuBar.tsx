import { useEffect, useRef, useState } from 'react';

interface MenuAction {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: false;
  onClick: () => void;
}
interface MenuSeparator {
  separator: true;
}
type MenuItem = MenuAction | MenuSeparator;

interface MenuDefinition {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  onNewWorld: () => void;
  onOpenWorld: () => void;
  onSaveWorld: () => void;
  onExportMinecraft: () => void;
  onDownloadWorldFile: () => void;
  canSaveWorld: boolean;
  canExportMinecraft: boolean;
  canDownloadWorldFile: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onWorldProperties: () => void;
  onAbout: () => void;
}

export function MenuBar({
  onNewWorld,
  onOpenWorld,
  onSaveWorld,
  onExportMinecraft,
  onDownloadWorldFile,
  canSaveWorld,
  canExportMinecraft,
  canDownloadWorldFile,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onWorldProperties,
  onAbout,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openMenu]);

  const menus: MenuDefinition[] = [
    {
      label: 'File',
      items: [
        { label: 'New World...', shortcut: 'Ctrl+N', onClick: onNewWorld },
        { separator: true },
        { label: 'Open World...', shortcut: 'Ctrl+O', onClick: onOpenWorld },
        { separator: true },
        { label: 'Save World', shortcut: 'Ctrl+S', disabled: !canSaveWorld, onClick: onSaveWorld },
        { label: 'Download .world File', disabled: !canDownloadWorldFile, onClick: onDownloadWorldFile },
        { separator: true },
        { label: 'Export to Minecraft...', disabled: !canExportMinecraft, onClick: onExportMinecraft },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: onUndo },
        { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: onRedo },
      ],
    },
    {
      label: 'World',
      items: [
        { label: 'World Properties...', onClick: onWorldProperties },
        { separator: true },
        { label: 'Dimension Properties...', disabled: true, onClick: () => {} },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: '+', disabled: true, onClick: () => {} },
        { label: 'Zoom Out', shortcut: '-', disabled: true, onClick: () => {} },
        { label: 'Fit to Window', shortcut: 'Ctrl+Shift+F', disabled: true, onClick: () => {} },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'About WorldPainterWeb', onClick: onAbout },
      ],
    },
  ];

  function handleMenuClick(label: string) {
    setOpenMenu((current) => (current === label ? null : label));
  }

  function handleItemClick(item: MenuAction) {
    setOpenMenu(null);
    if (!item.disabled) {
      item.onClick();
    }
  }

  return (
    <div className="wp-menubar" ref={barRef}>
      {menus.map((menu) => (
        <div
          key={menu.label}
          className={`wp-menu-item${openMenu === menu.label ? ' open' : ''}`}
          onMouseDown={() => handleMenuClick(menu.label)}
          onMouseEnter={() => {
            if (openMenu !== null) setOpenMenu(menu.label);
          }}
        >
          {menu.label}
          <div className="wp-dropdown">
            {menu.items.map((item, idx) =>
              'separator' in item && item.separator ? (
                <div key={idx} className="wp-dropdown-sep" />
              ) : (
                <div
                  key={idx}
                  className={`wp-dropdown-item${(item as MenuAction).disabled ? ' disabled' : ''}`}
                  onMouseDown={(e) => { e.stopPropagation(); handleItemClick(item as MenuAction); }}
                >
                  {(item as MenuAction).label}
                  {(item as MenuAction).shortcut && (
                    <span className="wp-dropdown-shortcut">{(item as MenuAction).shortcut}</span>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
