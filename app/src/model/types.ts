export const PROJECT_SCHEMA_VERSION = 1;
export const TILE_SIZE = 128;

export const TERRAIN_CODES = {
  grass: 0,
  sand: 1,
  stone: 2,
  snow: 3,
  water: 4,
} as const;

export type TerrainCode = (typeof TERRAIN_CODES)[keyof typeof TERRAIN_CODES];

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