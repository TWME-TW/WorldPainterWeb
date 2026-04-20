export const PROJECT_SCHEMA_VERSION = 1;
export const TILE_SIZE = 128;

/**
 * Terrain code constants matching WorldPainter's Terrain enum ordinals.
 * Used by classifyTerrain() and the paint-terrain brush.
 * Note: legacy aliases (sand=1 etc.) were the original web-app values and
 * are kept here for backward-compatibility with saved IndexedDB projects.
 * New code should use the WP_* constants below.
 */
export const TERRAIN_CODES = {
  // WorldPainter-correct ordinals
  grass: 0,
  dirt: 1,
  sand: 2,
  sandstone: 3,
  stone: 4,
  rock: 5,
  water: 6,
  lava: 7,
  snowOnRock: 8,
  deepSnow: 9,
  gravel: 10,
  clay: 11,
  cobblestone: 12,
  mossyCobblestone: 13,
  netherrack: 14,
  soulSand: 15,
  obsidian: 16,
  bedrock: 17,
  desert: 18,
  mycelium: 22,
  endStone: 23,
  bareGrass: 24,
  coarseDirt: 25,
  podzol: 26,
  redSand: 27,
  terracotta: 28,
  mesa: 45,
  granite: 48,
  diorite: 49,
  andesite: 50,

  // Legacy aliases kept for backward-compat with old IndexedDB saves
  /** @deprecated Use deepSnow (9) */
  snow: 9,
  /** @deprecated Use sand (2) */
  sand_legacy: 1,
  /** @deprecated Use stone (4) */
  stone_legacy: 22,
  /** @deprecated Use water (6) */
  water_legacy: 4,
} as const;

export type TerrainCode = number;

export interface CompatibilityStatus {
  readSupport: 'planned' | 'partial' | 'full';
  writeSupport: 'planned' | 'partial' | 'full';
  exportSupport: 'planned' | 'partial' | 'full';
  notes: string[];
}

export interface WorldFilePlugin {
  name: string;
  version: string;
}

export interface WorldFileMetadata {
  name: string | null;
  wpVersion: string | null;
  wpBuild: string | null;
  timestamp: string | null;
  plugins: WorldFilePlugin[];
}

export interface WorldFilePointSummary {
  x: number;
  y: number;
}

export interface WorldFileAnchorSummary {
  dim: number;
  role: string | null;
  invert: boolean;
  id: number;
  defaultName: string;
}

export type WorldFileLayerDataSize = 'BIT' | 'NIBBLE' | 'BYTE' | 'BIT_PER_CHUNK' | 'NONE' | 'unknown';

export interface WorldFileLayerSummary {
  className: string;
  id: string | null;
  name: string | null;
  dataSize: WorldFileLayerDataSize;
}

export interface WorldFileLayerBufferSummary {
  layer: WorldFileLayerSummary;
  storage: 'value' | 'bit';
  bufferLength: number;
  byteLength: number;
}

export interface WorldFileLayerSettingSummary {
  layer: WorldFileLayerSummary;
  settingsClassName: string | null;
}

export interface WorldFileTileSourcePatch {
  format: 'worldpainter-world';
  heightDataOffset: number;
  heightDataLength: number;
  heightDataType: 'int16-height' | 'int32-height';
  minHeight: number;
  waterLevelDataOffset?: number;
  waterLevelDataLength?: number;
  waterLevelDataType?: 'uint8-water' | 'int16-water';
}

export interface ImportedWorldFileSource {
  format: 'worldpainter-world';
  fileName: string;
  fileSize: number;
  serializedBytes: Uint8Array;
}

export interface WorldFileSeedSummary {
  className: string;
  x: number | null;
  y: number | null;
  z: number | null;
  category: number | null;
  seed: number | null;
}

export interface WorldFileDimensionSummary {
  anchor: WorldFileAnchorSummary | null;
  name: string | null;
  minHeight: number | null;
  maxHeight: number | null;
  dimensionSeed: number | null;
  minecraftSeed: number | null;
  minTileX: number | null;
  maxTileX: number | null;
  minTileY: number | null;
  maxTileY: number | null;
  tileCount: number | null;
  layerSettings: WorldFileLayerSettingSummary[];
  availableLayers: WorldFileLayerSummary[];
  tileLayerBufferCount: number;
  tileBitLayerBufferCount: number;
  seedCount: number;
  tiles: WorldFileTilePayload[];
}

export interface WorldFileTilePayload {
  x: number;
  y: number;
  heights: Int32Array;
  waterLevels: Int32Array;
  terrain: Uint8Array;
  layerSummaries: WorldFileLayerBufferSummary[];
  seedSummaries: WorldFileSeedSummary[];
  sourcePatch: WorldFileTileSourcePatch | null;
}

export interface WorldFileWorldSummary {
  name: string | null;
  minHeight: number | null;
  maxHeight: number | null;
  spawnPoint: WorldFilePointSummary | null;
  platformId: string | null;
  platformName: string | null;
  dimensions: WorldFileDimensionSummary[];
}

export interface WorldFileProbeResult {
  fileName: string;
  fileSize: number;
  compression: 'gzip' | 'unknown';
  serialization: 'java-object-stream' | 'unknown';
  status: 'recognized' | 'partial' | 'unsupported';
  worldRootClass: string | null;
  metadata: WorldFileMetadata | null;
  worldSummary: WorldFileWorldSummary | null;
  importSource: ImportedWorldFileSource | null;
  notes: string[];
}

export interface TileState {
  x: number;
  y: number;
  heights: Int32Array;
  waterLevels: Int32Array;
  terrain: Uint8Array;
  layerSummaries?: WorldFileLayerBufferSummary[];
  seedSummaries?: WorldFileSeedSummary[];
  sourcePatch?: WorldFileTileSourcePatch | null;
}

export interface ImportedDimensionMetadata {
  source: 'worldpainter-world';
  dimensionSeed: number | null;
  minecraftSeed: number | null;
  layerSettings: WorldFileLayerSettingSummary[];
  availableLayers: WorldFileLayerSummary[];
  tileLayerBufferCount: number;
  tileBitLayerBufferCount: number;
  seedCount: number;
}

export interface DimensionState {
  id: string;
  name: string;
  tileSize: number;
  minHeight: number | null;
  maxHeight: number | null;
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
  tiles: Record<string, TileState>;
  importMetadata?: ImportedDimensionMetadata;
}

export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';

export interface SpawnPoint {
  x: number;
  z: number;
  y: number;
}

export interface ProjectState {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: 'demo' | 'draft' | 'worldpainter-world';
  activeDimensionId: string;
  dimensions: Record<string, DimensionState>;
  importSource?: ImportedWorldFileSource;
  compatibility: CompatibilityStatus;
  /** Minecraft spawn point (world coordinates). */
  spawnPoint?: SpawnPoint;
  /** Default game mode for the exported world. */
  gameMode?: GameMode;
  /** World seed shown in world properties. */
  worldSeed?: number;
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function getActiveDimension(project: ProjectState): DimensionState {
  return project.dimensions[project.activeDimensionId];
}

export function getSortedTiles(dimension: DimensionState): TileState[] {
  return Object.values(dimension.tiles).sort((left, right) => {
    if (left.y === right.y) {
      return left.x - right.x;
    }

    return left.y - right.y;
  });
}