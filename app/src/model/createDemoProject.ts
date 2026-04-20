import { createId } from '../utils/ids.ts';
import {
  PROJECT_SCHEMA_VERSION,
  TERRAIN_CODES,
  TILE_SIZE,
  type DimensionState,
  type ProjectState,
  type TileState,
  tileKey,
} from './types.ts';

const WATER_LEVEL = 64;
const DEMO_MIN_HEIGHT = -64;
const DEMO_MAX_HEIGHT = 320;

function buildTile(tileX: number, tileY: number): TileState {
  const heights = new Int32Array(TILE_SIZE * TILE_SIZE);
  const waterLevels = new Int32Array(TILE_SIZE * TILE_SIZE);
  const terrain = new Uint8Array(TILE_SIZE * TILE_SIZE);

  for (let localY = 0; localY < TILE_SIZE; localY += 1) {
    for (let localX = 0; localX < TILE_SIZE; localX += 1) {
      const index = localX + localY * TILE_SIZE;
      const worldX = tileX * TILE_SIZE + localX;
      const worldY = tileY * TILE_SIZE + localY;

      const broadWave = Math.sin(worldX / 88) * 12 + Math.cos(worldY / 93) * 10;
      const ridge = Math.sin((worldX + worldY) / 47) * 7;
      const hillMask = Math.cos(worldX / 29) * Math.sin(worldY / 37) * 18;
      const height = Math.round(62 + broadWave + ridge + hillMask);

      heights[index] = height;
      waterLevels[index] = WATER_LEVEL;

      if (height < WATER_LEVEL - 3) {
        terrain[index] = TERRAIN_CODES.water;
      } else if (height < WATER_LEVEL + 2) {
        terrain[index] = TERRAIN_CODES.sand;
      } else if (height > 92) {
        terrain[index] = TERRAIN_CODES.snow;
      } else if (height > 80) {
        terrain[index] = TERRAIN_CODES.stone;
      } else {
        terrain[index] = TERRAIN_CODES.grass;
      }
    }
  }

  return {
    x: tileX,
    y: tileY,
    heights,
    waterLevels,
    terrain,
  };
}

export function createDemoProject(name = 'Compatibility Draft'): ProjectState {
  const surfaceId = createId('dimension');
  const tiles: Record<string, TileState> = {};
  const tileRadius = 2;

  for (let tileY = -tileRadius; tileY <= tileRadius; tileY += 1) {
    for (let tileX = -tileRadius; tileX <= tileRadius; tileX += 1) {
      tiles[tileKey(tileX, tileY)] = buildTile(tileX, tileY);
    }
  }

  const surface: DimensionState = {
    id: surfaceId,
    name: 'Surface',
    tileSize: TILE_SIZE,
    minHeight: DEMO_MIN_HEIGHT,
    maxHeight: DEMO_MAX_HEIGHT,
    minTileX: -tileRadius,
    maxTileX: tileRadius,
    minTileY: -tileRadius,
    maxTileY: tileRadius,
    tiles,
  };

  const now = new Date().toISOString();

  return {
    id: createId('project'),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    source: 'demo',
    activeDimensionId: surfaceId,
    dimensions: {
      [surfaceId]: surface,
    },
    spawnPoint: { x: 0, y: 65, z: 0 },
    gameMode: 'survival',
    worldSeed: 0,
    compatibility: {
      readSupport: 'planned',
      writeSupport: 'planned',
      exportSupport: 'partial',
      notes: [
        'This shell uses a browser-native canonical model.',
        'Original .world read/write and Minecraft export adapters are not implemented yet.',
      ],
    },
  };
}