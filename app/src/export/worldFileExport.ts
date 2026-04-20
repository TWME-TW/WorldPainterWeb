import { gzipSync } from 'fflate';
import type {
  ProjectState,
  TileState,
  WorldFileTileSourcePatch,
} from '../model/types';

export interface ExportedWorldFile {
  fileName: string;
  bytes: Uint8Array;
  patchedTileCount: number;
}

interface PatchableTile {
  tile: TileState;
  sourcePatch: WorldFileTileSourcePatch;
}

function getPatchableTiles(project: ProjectState): PatchableTile[] {
  return Object.values(project.dimensions).flatMap((dimension) => (
    Object.values(dimension.tiles)
      .filter((tile): tile is TileState & { sourcePatch: WorldFileTileSourcePatch } => tile.sourcePatch?.format === 'worldpainter-world')
      .map((tile) => ({
        tile,
        sourcePatch: tile.sourcePatch,
      }))
  ));
}

function encodeHeightValue(height: number, sourcePatch: WorldFileTileSourcePatch): number {
  return Math.round((height - sourcePatch.minHeight) * 256);
}

function patchTileHeightBuffer(view: DataView, tile: TileState, sourcePatch: WorldFileTileSourcePatch): void {
  if (tile.heights.length !== sourcePatch.heightDataLength) {
    throw new Error(`Tile ${tile.x},${tile.y} no longer matches the imported height buffer length.`);
  }

  if (sourcePatch.heightDataType === 'int16-height') {
    for (let index = 0; index < tile.heights.length; index += 1) {
      const encodedHeight = encodeHeightValue(tile.heights[index], sourcePatch);
      view.setUint16(sourcePatch.heightDataOffset + index * 2, encodedHeight & 0xffff, false);
    }
    return;
  }

  for (let index = 0; index < tile.heights.length; index += 1) {
    const encodedHeight = encodeHeightValue(tile.heights[index], sourcePatch);
    view.setInt32(sourcePatch.heightDataOffset + index * 4, encodedHeight, false);
  }
}

function patchTileWaterLevelBuffer(view: DataView, tile: TileState, sourcePatch: WorldFileTileSourcePatch): void {
  if (
    sourcePatch.waterLevelDataOffset === undefined
    || sourcePatch.waterLevelDataLength === undefined
    || sourcePatch.waterLevelDataType === undefined
  ) {
    return;
  }

  if (tile.waterLevels.length !== sourcePatch.waterLevelDataLength) {
    // Length mismatch — skip silently to avoid corrupting the container.
    return;
  }

  if (sourcePatch.waterLevelDataType === 'uint8-water') {
    for (let index = 0; index < tile.waterLevels.length; index += 1) {
      const encoded = Math.max(0, Math.min(255, tile.waterLevels[index] - sourcePatch.minHeight));
      view.setUint8(sourcePatch.waterLevelDataOffset + index, encoded);
    }
    return;
  }

  // int16-water (tall tiles: tallWaterLevel, big-endian signed short)
  for (let index = 0; index < tile.waterLevels.length; index += 1) {
    const encoded = tile.waterLevels[index] - sourcePatch.minHeight;
    view.setInt16(sourcePatch.waterLevelDataOffset + index * 2, encoded, false);
  }
}

function createExportFileName(project: ProjectState): string {
  const sourceFileName = project.importSource?.fileName?.trim();
  if (sourceFileName) {
    if (/\.world$/i.test(sourceFileName)) {
      return sourceFileName.replace(/\.world$/i, '-patched.world');
    }

    return `${sourceFileName}-patched.world`;
  }

  return `${project.name.replace(/\s+/g, '-').toLowerCase()}-patched.world`;
}

export function canExportPatchedWorldFile(project: ProjectState): boolean {
  return Boolean(
    project.source === 'worldpainter-world'
    && project.importSource?.format === 'worldpainter-world'
    && getPatchableTiles(project).length > 0,
  );
}

export function exportPatchedWorldFile(project: ProjectState): ExportedWorldFile {
  if (!project.importSource || project.importSource.format !== 'worldpainter-world') {
    throw new Error('This project does not retain an original .world source container to patch.');
  }

  const patchableTiles = getPatchableTiles(project);
  if (patchableTiles.length === 0) {
    throw new Error('This imported project does not contain any patchable height buffers yet.');
  }

  const serializedBytes = project.importSource.serializedBytes.slice();
  const view = new DataView(serializedBytes.buffer, serializedBytes.byteOffset, serializedBytes.byteLength);

  patchableTiles.forEach(({ tile, sourcePatch }) => {
    patchTileHeightBuffer(view, tile, sourcePatch);
    patchTileWaterLevelBuffer(view, tile, sourcePatch);
  });

  return {
    fileName: createExportFileName(project),
    bytes: gzipSync(serializedBytes),
    patchedTileCount: patchableTiles.length,
  };
}