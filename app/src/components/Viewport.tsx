import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrushSettings } from '../model/editing';
import { getSortedTiles, tileKey, type DimensionState } from '../model/types';
import { TileRenderClient } from '../workers/tileRenderClient';

interface ViewportProps {
  dimension: DimensionState;
  brushSettings: BrushSettings;
  editable: boolean;
  onApplyBrush: (worldX: number, worldY: number) => void;
  onZoomChange?: (zoom: number) => void;
  onCursorMove?: (worldX: number, worldY: number) => void;
  onCursorLeave?: () => void;
}

interface RenderedTile {
  key: string;
  bitmap: ImageBitmap;
  x: number;
  y: number;
}

interface WorldCell {
  x: number;
  y: number;
}

type DragState =
  | {
    kind: 'pan';
    pointerId: number;
    lastX: number;
    lastY: number;
  }
  | {
    kind: 'brush';
    pointerId: number;
    lastCell: WorldCell;
  };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getWorldCell(clientX: number, clientY: number, rect: DOMRect, pan: { x: number; y: number }, zoom: number): WorldCell {
  return {
    x: Math.floor((clientX - rect.left - pan.x) / zoom),
    y: Math.floor((clientY - rect.top - pan.y) / zoom),
  };
}

export function Viewport({ dimension, brushSettings, editable, onApplyBrush, onZoomChange, onCursorMove, onCursorLeave }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<TileRenderClient | null>(null);
  const dragState = useRef<DragState | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 640 });
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [renderedTiles, setRenderedTiles] = useState<RenderedTile[]>([]);
  const [renderStatus, setRenderStatus] = useState('Rendering tiles in Web Worker...');
  const [hoveredWorldCell, setHoveredWorldCell] = useState<WorldCell | null>(null);

  const sortedTiles = useMemo(() => getSortedTiles(dimension), [dimension]);
  const boundedTileCount = useMemo(
    () => (dimension.maxTileX - dimension.minTileX + 1) * (dimension.maxTileY - dimension.minTileY + 1),
    [dimension.maxTileX, dimension.maxTileY, dimension.minTileX, dimension.minTileY],
  );

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setCanvasSize({
        width: Math.max(480, Math.floor(entry.contentRect.width)),
        height: Math.max(360, Math.floor(entry.contentRect.height)),
      });
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const worldWidth = (dimension.maxTileX - dimension.minTileX + 1) * dimension.tileSize;
    const worldHeight = (dimension.maxTileY - dimension.minTileY + 1) * dimension.tileSize;

    setPan({
      x: canvasSize.width / 2 - (dimension.minTileX * dimension.tileSize + worldWidth / 2) * zoom,
      y: canvasSize.height / 2 - (dimension.minTileY * dimension.tileSize + worldHeight / 2) * zoom,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.height, canvasSize.width, dimension]);

  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new TileRenderClient();
    }

    let disposed = false;
    const currentClient = clientRef.current;

    if (sortedTiles.length === 0) {
      setRenderedTiles((previous) => {
        previous.forEach((tile) => tile.bitmap.close());
        return [];
      });
      setRenderStatus('No tile payload loaded yet; showing imported dimension bounds only.');
      return;
    }

    setRenderStatus('Rendering tiles in Web Worker...');

    Promise.all(
      sortedTiles.map(async (tile) => {
        const result = await currentClient.renderTile(tileKey(tile.x, tile.y), tile, dimension.tileSize);
        const imageData = new ImageData(new Uint8ClampedArray(result.rgbaBuffer), result.width, result.height);
        const bitmap = await createImageBitmap(imageData);

        return {
          key: result.tileKey,
          bitmap,
          x: tile.x,
          y: tile.y,
        } satisfies RenderedTile;
      }),
    )
      .then((tiles) => {
        if (disposed) {
          tiles.forEach((tile) => tile.bitmap.close());
          return;
        }

        setRenderedTiles((previous) => {
          previous.forEach((tile) => tile.bitmap.close());
          return tiles;
        });
        setRenderStatus(`Rendered ${tiles.length} tiles from the canonical browser model.`);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRenderStatus(error instanceof Error ? error.message : 'Tile rendering failed.');
        }
      });

    return () => {
      disposed = true;
    };
  }, [dimension, sortedTiles]);

  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  // ---- Tiles canvas: re-renders when terrain data or view changes, NOT on hover ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * devicePixelRatio);
    canvas.height = Math.floor(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const gradient = context.createLinearGradient(0, 0, canvasSize.width, canvasSize.height);
    gradient.addColorStop(0, '#f4e2c3');
    gradient.addColorStop(1, '#c8d4b4');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvasSize.width, canvasSize.height);

    if (renderedTiles.length === 0) {
      const worldX = pan.x + dimension.minTileX * dimension.tileSize * zoom;
      const worldY = pan.y + dimension.minTileY * dimension.tileSize * zoom;
      const worldWidth = (dimension.maxTileX - dimension.minTileX + 1) * dimension.tileSize * zoom;
      const worldHeight = (dimension.maxTileY - dimension.minTileY + 1) * dimension.tileSize * zoom;

      context.fillStyle = 'rgba(255, 250, 239, 0.38)';
      context.fillRect(worldX, worldY, worldWidth, worldHeight);

      context.setLineDash([10, 8]);
      context.strokeStyle = 'rgba(36, 44, 33, 0.36)';
      context.lineWidth = 2;
      context.strokeRect(worldX, worldY, worldWidth, worldHeight);
      context.setLineDash([]);

      if (boundedTileCount <= 256 && zoom >= 0.35) {
        context.strokeStyle = 'rgba(36, 44, 33, 0.14)';
        context.lineWidth = 1;

        for (let tileX = dimension.minTileX; tileX <= dimension.maxTileX; tileX += 1) {
          const x = pan.x + tileX * dimension.tileSize * zoom;
          context.beginPath();
          context.moveTo(x, worldY);
          context.lineTo(x, worldY + worldHeight);
          context.stroke();
        }

        for (let tileY = dimension.minTileY; tileY <= dimension.maxTileY; tileY += 1) {
          const y = pan.y + tileY * dimension.tileSize * zoom;
          context.beginPath();
          context.moveTo(worldX, y);
          context.lineTo(worldX + worldWidth, y);
          context.stroke();
        }
      }

      context.fillStyle = 'rgba(22, 27, 20, 0.72)';
      context.font = '600 16px "Aptos", "Segoe UI Variable", "Trebuchet MS", sans-serif';
      context.fillText('Imported bounds only', worldX + 16, worldY + 28);
    }

    renderedTiles.forEach((tile) => {
      const drawX = pan.x + tile.x * dimension.tileSize * zoom;
      const drawY = pan.y + tile.y * dimension.tileSize * zoom;
      const drawSize = dimension.tileSize * zoom;

      context.imageSmoothingEnabled = zoom > 1;
      context.drawImage(tile.bitmap, drawX, drawY, drawSize, drawSize);

      if (zoom >= 0.65) {
        context.strokeStyle = 'rgba(36, 44, 33, 0.25)';
        context.lineWidth = 1;
        context.strokeRect(drawX, drawY, drawSize, drawSize);
      }
    });

    context.fillStyle = 'rgba(22, 27, 20, 0.8)';
    context.font = '600 13px "Aptos", "Segoe UI Variable", "Trebuchet MS", sans-serif';
    context.fillText(renderStatus, 18, canvasSize.height - 22);
  }, [boundedTileCount, canvasSize.height, canvasSize.width, dimension, pan.x, pan.y, renderStatus, renderedTiles, zoom]);

  // ---- Overlay canvas: re-renders only on hover / brush settings / view changes ----
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasSize.width * devicePixelRatio);
    canvas.height = Math.floor(canvasSize.height * devicePixelRatio);
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (hoveredWorldCell) {
      const centerX = pan.x + (hoveredWorldCell.x + 0.5) * zoom;
      const centerY = pan.y + (hoveredWorldCell.y + 0.5) * zoom;
      const brushRadius = Math.max(6, brushSettings.radius * zoom);

      context.beginPath();
      context.arc(centerX, centerY, brushRadius, 0, Math.PI * 2);
      context.fillStyle = editable ? 'rgba(48, 64, 29, 0.08)' : 'rgba(36, 44, 33, 0.04)';
      context.fill();
      context.strokeStyle = editable ? 'rgba(48, 64, 29, 0.78)' : 'rgba(36, 44, 33, 0.28)';
      context.lineWidth = 2;
      context.stroke();
    }
  }, [brushSettings.radius, canvasSize.height, canvasSize.width, editable, hoveredWorldCell, pan.x, pan.y, zoom]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const worldCell = getWorldCell(event.clientX, event.clientY, rect, pan, zoom);
    setHoveredWorldCell(worldCell);
    onCursorMove?.(worldCell.x, worldCell.y);

    if (editable && event.button === 0 && sortedTiles.length > 0) {
      dragState.current = {
        kind: 'brush',
        pointerId: event.pointerId,
        lastCell: worldCell,
      };
      onApplyBrush(worldCell.x, worldCell.y);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    dragState.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const worldCell = getWorldCell(event.clientX, event.clientY, rect, pan, zoom);
    setHoveredWorldCell(worldCell);
    onCursorMove?.(worldCell.x, worldCell.y);

    if (!dragState.current || dragState.current.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.current.kind === 'brush') {
      if (worldCell.x === dragState.current.lastCell.x && worldCell.y === dragState.current.lastCell.y) {
        return;
      }

      dragState.current = {
        kind: 'brush',
        pointerId: event.pointerId,
        lastCell: worldCell,
      };
      onApplyBrush(worldCell.x, worldCell.y);
      return;
    }

    const deltaX = event.clientX - dragState.current.lastX;
    const deltaY = event.clientY - dragState.current.lastY;
    dragState.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };

    setPan((previous) => ({
      x: previous.x + deltaX,
      y: previous.y + deltaY,
    }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragState.current?.pointerId === event.pointerId) {
      dragState.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLCanvasElement>) {
    setHoveredWorldCell(null);
    onCursorLeave?.();
    handlePointerUp(event);
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const worldX = (cursorX - pan.x) / zoom;
    const worldY = (cursorY - pan.y) / zoom;
    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.3, 4);

    setZoom(nextZoom);
    onZoomChange?.(nextZoom);
    setPan({
      x: cursorX - worldX * nextZoom,
      y: cursorY - worldY * nextZoom,
    });
  }

  return (
    <div className="wp-viewport-stage" ref={containerRef}>
      <canvas
        className={`viewport-canvas${dragState.current?.kind === 'pan' ? ' panning' : ''}`}
        ref={canvasRef}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />
      <canvas className="viewport-overlay" ref={overlayCanvasRef} />
    </div>
  );
}
