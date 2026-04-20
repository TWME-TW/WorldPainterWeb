import type {
  DimensionState,
  ImportedDimensionMetadata,
  ProjectState,
  TileState,
  WorldFileDimensionSummary,
  WorldFileProbeResult,
} from '../model/types';

const PROJECT_SCHEMA_VERSION = 1;
const IMPORTED_TILE_SIZE = 128;

function createImportedId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getImportedProjectName(probe: WorldFileProbeResult): string {
  const summaryName = probe.worldSummary?.name?.trim();
  if (summaryName) {
    return summaryName;
  }

  const metadataName = probe.metadata?.name?.trim();
  if (metadataName) {
    return metadataName;
  }

  return probe.fileName.replace(/\.[^.]+$/, '') || 'Imported WorldPainter World';
}

function getImportedDimensionName(dimension: WorldFileDimensionSummary, index: number): string {
  return dimension.name ?? dimension.anchor?.defaultName ?? `Imported Dimension ${index + 1}`;
}

function normalizeBounds(dimension: WorldFileDimensionSummary): Pick<DimensionState, 'minTileX' | 'maxTileX' | 'minTileY' | 'maxTileY'> {
  const minTileX = dimension.minTileX ?? 0;
  const maxTileX = dimension.maxTileX ?? minTileX;
  const minTileY = dimension.minTileY ?? 0;
  const maxTileY = dimension.maxTileY ?? minTileY;

  return {
    minTileX: Math.min(minTileX, maxTileX),
    maxTileX: Math.max(minTileX, maxTileX),
    minTileY: Math.min(minTileY, maxTileY),
    maxTileY: Math.max(minTileY, maxTileY),
  };
}

function createImportedDimensionMetadata(dimension: WorldFileDimensionSummary): ImportedDimensionMetadata {
  return {
    source: 'worldpainter-world',
    dimensionSeed: dimension.dimensionSeed,
    minecraftSeed: dimension.minecraftSeed,
    layerSettings: dimension.layerSettings,
    availableLayers: dimension.availableLayers,
    tileLayerBufferCount: dimension.tileLayerBufferCount,
    tileBitLayerBufferCount: dimension.tileBitLayerBufferCount,
    seedCount: dimension.seedCount,
  };
}

function createImportedDimension(dimension: WorldFileDimensionSummary, index: number): DimensionState {
  const bounds = normalizeBounds(dimension);
  const tiles = Object.fromEntries(
    dimension.tiles.map((tile) => {
      const tileState: TileState = {
        x: tile.x,
        y: tile.y,
        heights: tile.heights,
        waterLevels: tile.waterLevels,
        terrain: tile.terrain,
        layerSummaries: tile.layerSummaries,
        seedSummaries: tile.seedSummaries,
        sourcePatch: tile.sourcePatch,
      };

      return [`${tile.x},${tile.y}`, tileState];
    }),
  );

  return {
    id: createImportedId('dimension'),
    name: getImportedDimensionName(dimension, index),
    tileSize: IMPORTED_TILE_SIZE,
    minHeight: dimension.minHeight,
    maxHeight: dimension.maxHeight,
    minTileX: bounds.minTileX,
    maxTileX: bounds.maxTileX,
    minTileY: bounds.minTileY,
    maxTileY: bounds.maxTileY,
    tiles,
    importMetadata: createImportedDimensionMetadata(dimension),
  };
}

function createFallbackDimension(): DimensionState {
  return {
    id: createImportedId('dimension'),
    name: 'Imported Dimension',
    tileSize: IMPORTED_TILE_SIZE,
    minHeight: null,
    maxHeight: null,
    minTileX: 0,
    maxTileX: 0,
    minTileY: 0,
    maxTileY: 0,
    tiles: {},
  };
}

function buildCompatibilityNotes(probe: WorldFileProbeResult): string[] {
  const importedTileCount = probe.worldSummary?.dimensions.reduce((count, dimension) => count + dimension.tiles.length, 0) ?? 0;
  const patchableTileCount = probe.worldSummary?.dimensions.reduce(
    (count, dimension) => count + dimension.tiles.filter((tile) => tile.sourcePatch !== null).length,
    0,
  ) ?? 0;
  const importedLayerBufferCount = probe.worldSummary?.dimensions.reduce(
    (count, dimension) => count + dimension.tileLayerBufferCount + dimension.tileBitLayerBufferCount,
    0,
  ) ?? 0;
  const importedSeedCount = probe.worldSummary?.dimensions.reduce((count, dimension) => count + dimension.seedCount, 0) ?? 0;
  const importedLayerSettingCount = probe.worldSummary?.dimensions.reduce((count, dimension) => count + dimension.layerSettings.length, 0) ?? 0;
  const notes = [
    'Imported from an original WorldPainter .world container into the browser-native canonical project shell.',
    importedTileCount > 0
      ? `The current import step decoded ${importedTileCount} tiles of core height, water, and preview terrain data.`
      : 'The current import step only maps shallow World2 and Dimension metadata.',
    (importedLayerBufferCount > 0) || (importedSeedCount > 0) || (importedLayerSettingCount > 0)
      ? `Layer settings, tile layer buffers, and garden seeds are now preserved as compatibility metadata (${importedLayerSettingCount} settings, ${importedLayerBufferCount} buffers, ${importedSeedCount} seeds).`
      : importedTileCount > 0
        ? 'No additional layer or seed semantics were detected in the imported payload.'
        : 'Terrain tile payload has not been decoded yet, so the viewport currently shows dimension bounds only.',
    patchableTileCount > 0
      ? `Imported elevation data can now be written back into the original .world container for ${patchableTileCount} decoded tiles. Layer-aware save and Minecraft export are still pending.`
      : 'Original .world save and Minecraft export adapters are still pending.',
  ];

  if (probe.worldSummary?.platformName) {
    notes.splice(1, 0, `Desktop target platform: ${probe.worldSummary.platformName}.`);
  }

  if (probe.metadata?.plugins.length) {
    notes.splice(2, 0, `This world references ${probe.metadata.plugins.length} plugin entries that are not interpreted in the browser yet.`);
  }

  return notes;
}

export function createImportedProject(probe: WorldFileProbeResult): ProjectState | null {
  if (!probe.worldSummary) {
    return null;
  }

  const now = new Date().toISOString();
  const importedDimensions = probe.worldSummary.dimensions.length > 0
    ? probe.worldSummary.dimensions.map(createImportedDimension)
    : [createFallbackDimension()];

  const dimensions = Object.fromEntries(importedDimensions.map((dimension) => [dimension.id, dimension]));
  const activeDimensionId = importedDimensions[0].id;

  return {
    id: createImportedId('project'),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: getImportedProjectName(probe),
    createdAt: now,
    updatedAt: now,
    source: 'worldpainter-world',
    activeDimensionId,
    dimensions,
    importSource: probe.importSource ?? undefined,
    compatibility: {
      readSupport: 'partial',
      writeSupport: probe.importSource && importedDimensions.some((dimension) => Object.values(dimension.tiles).some((tile) => tile.sourcePatch)) ? 'partial' : 'planned',
      exportSupport: 'partial',
      notes: buildCompatibilityNotes(probe),
    },
  };
}