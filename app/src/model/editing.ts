import {
  TERRAIN_CODES,
  tileKey,
  type DimensionState,
  type ProjectState,
  type TerrainCode,
  type TileState,
} from './types.ts';

export type BrushTool = 'raise' | 'lower' | 'raise-water' | 'lower-water' | 'paint-terrain';

export interface BrushSettings {
  tool: BrushTool;
  radius: number;
  strength: number;
  /** Active terrain code used when tool === 'paint-terrain'. */
  paintTerrain?: TerrainCode;
}

export interface BrushStamp {
  worldX: number;
  worldY: number;
}

export interface BrushMutationResult {
  project: ProjectState;
  changedTileCount: number;
  changedSampleCount: number;
  changedTileKeys: string[];
}

function clamp(value: number, min: number | null, max: number | null): number {
  const minimum = min ?? Number.NEGATIVE_INFINITY;
  const maximum = max ?? Number.POSITIVE_INFINITY;
  return Math.min(maximum, Math.max(minimum, value));
}

function classifyTerrain(height: number, waterLevel: number): number {
  if (waterLevel > height) {
    return TERRAIN_CODES.water;
  }

  if (height <= waterLevel + 1) {
    return TERRAIN_CODES.sand;
  }

  if (height >= 96) {
    return TERRAIN_CODES.snow;
  }

  if (height >= 82) {
    return TERRAIN_CODES.stone;
  }

  return TERRAIN_CODES.grass;
}

function cloneTile(tile: TileState): TileState {
  return {
    ...tile,
    heights: tile.heights.slice(),
    waterLevels: tile.waterLevels.slice(),
    terrain: tile.terrain.slice(),
  };
}

export function applyHeightBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) {
    return {
      project,
      changedTileCount: 0,
      changedSampleCount: 0,
      changedTileKeys: [],
    };
  }

  const radius = Math.max(0, Math.floor(settings.radius));
  const strength = Math.max(1, Math.floor(settings.strength));
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const heightDirection = settings.tool === 'raise' ? 1 : -1;
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount = 0;
  let changedSampleCount = 0;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) {
        continue;
      }

      const tileOriginX = tileX * tileSize;
      const tileOriginY = tileY * tileSize;
      const localMinX = Math.max(0, stamp.worldX - radius - tileOriginX);
      const localMaxX = Math.min(tileSize - 1, stamp.worldX + radius - tileOriginX);
      const localMinY = Math.max(0, stamp.worldY - radius - tileOriginY);
      const localMaxY = Math.min(tileSize - 1, stamp.worldY + radius - tileOriginY);

      let nextTile: TileState | null = null;

      for (let localY = localMinY; localY <= localMaxY; localY += 1) {
        const sampleWorldY = tileOriginY + localY;

        for (let localX = localMinX; localX <= localMaxX; localX += 1) {
          const sampleWorldX = tileOriginX + localX;
          const distanceX = sampleWorldX - stamp.worldX;
          const distanceY = sampleWorldY - stamp.worldY;
          const distance = Math.hypot(distanceX, distanceY);
          if (distance > radius) {
            continue;
          }

          const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
          const delta = Math.max(1, Math.round(strength * falloff)) * heightDirection;
          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;
          const nextHeight = clamp(sourceTile.heights[index] + delta, dimension.minHeight, dimension.maxHeight);
          const waterLevel = sourceTile.waterLevels[index];
          const nextTerrain = classifyTerrain(nextHeight, waterLevel);

          if (nextHeight === sourceTile.heights[index] && nextTerrain === sourceTile.terrain[index]) {
            continue;
          }

          if (!nextTile) {
            nextTile = cloneTile(currentTile);
          }

          nextTile.heights[index] = nextHeight;
          nextTile.terrain[index] = nextTerrain;
          changedSampleCount += 1;
        }
      }

      if (nextTile) {
        nextTiles[tileKey(tileX, tileY)] = nextTile;
        changedTileCount += 1;
      }
    }
  }

  if (changedTileCount === 0) {
    return {
      project,
      changedTileCount,
      changedSampleCount,
      changedTileKeys: [],
    };
  }

  const nextDimension: DimensionState = {
    ...dimension,
    tiles: {
      ...dimension.tiles,
      ...nextTiles,
    },
  };

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      dimensions: {
        ...project.dimensions,
        [dimensionId]: nextDimension,
      },
    },
    changedTileCount,
    changedSampleCount,
    changedTileKeys: Object.keys(nextTiles),
  };
}

/**
 * Apply a water-raise or water-lower brush stroke to the project.
 * Modifies waterLevels and recalculates terrain codes.
 */
export function applyWaterBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) {
    return {
      project,
      changedTileCount: 0,
      changedSampleCount: 0,
      changedTileKeys: [],
    };
  }

  const radius = Math.max(0, Math.floor(settings.radius));
  const strength = Math.max(1, Math.floor(settings.strength));
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const waterDirection = settings.tool === 'raise-water' ? 1 : -1;
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount = 0;
  let changedSampleCount = 0;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) {
        continue;
      }

      const tileOriginX = tileX * tileSize;
      const tileOriginY = tileY * tileSize;
      const localMinX = Math.max(0, stamp.worldX - radius - tileOriginX);
      const localMaxX = Math.min(tileSize - 1, stamp.worldX + radius - tileOriginX);
      const localMinY = Math.max(0, stamp.worldY - radius - tileOriginY);
      const localMaxY = Math.min(tileSize - 1, stamp.worldY + radius - tileOriginY);

      let nextTile: TileState | null = null;

      for (let localY = localMinY; localY <= localMaxY; localY += 1) {
        const sampleWorldY = tileOriginY + localY;

        for (let localX = localMinX; localX <= localMaxX; localX += 1) {
          const sampleWorldX = tileOriginX + localX;
          const distanceX = sampleWorldX - stamp.worldX;
          const distanceY = sampleWorldY - stamp.worldY;
          const distance = Math.hypot(distanceX, distanceY);
          if (distance > radius) {
            continue;
          }

          const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
          const delta = Math.max(1, Math.round(strength * falloff)) * waterDirection;
          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;
          const nextWater = clamp(sourceTile.waterLevels[index] + delta, dimension.minHeight, dimension.maxHeight);
          const height = sourceTile.heights[index];
          const nextTerrain = classifyTerrain(height, nextWater);

          if (nextWater === sourceTile.waterLevels[index] && nextTerrain === sourceTile.terrain[index]) {
            continue;
          }

          if (!nextTile) {
            nextTile = cloneTile(currentTile);
          }

          nextTile.waterLevels[index] = nextWater;
          nextTile.terrain[index] = nextTerrain;
          changedSampleCount += 1;
        }
      }

      if (nextTile) {
        nextTiles[tileKey(tileX, tileY)] = nextTile;
        changedTileCount += 1;
      }
    }
  }

  if (changedTileCount === 0) {
    return {
      project,
      changedTileCount,
      changedSampleCount,
      changedTileKeys: [],
    };
  }

  const nextDimension: DimensionState = {
    ...dimension,
    tiles: {
      ...dimension.tiles,
      ...nextTiles,
    },
  };

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      dimensions: {
        ...project.dimensions,
        [dimensionId]: nextDimension,
      },
    },
    changedTileCount,
    changedSampleCount,
    changedTileKeys: Object.keys(nextTiles),
  };
}

/**
 * Dispatch a brush stroke to the appropriate handler based on the tool type.
 */
export function applyBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  if (settings.tool === 'raise-water' || settings.tool === 'lower-water') {
    return applyWaterBrushToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'paint-terrain') {
    return applyTerrainBrushToProject(project, dimensionId, stamp, settings);
  }

  return applyHeightBrushToProject(project, dimensionId, stamp, settings);
}

/**
 * Explicitly paint a terrain code onto all cells within the brush radius.
 * Does not modify heights or water levels.
 */
export function applyTerrainBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) {
    return {
      project,
      changedTileCount: 0,
      changedSampleCount: 0,
      changedTileKeys: [],
    };
  }

  const targetTerrain: TerrainCode = settings.paintTerrain ?? TERRAIN_CODES.grass;
  const radius = Math.max(0, Math.floor(settings.radius));
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount = 0;
  let changedSampleCount = 0;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) {
        continue;
      }

      const tileOriginX = tileX * tileSize;
      const tileOriginY = tileY * tileSize;
      const localMinX = Math.max(0, stamp.worldX - radius - tileOriginX);
      const localMaxX = Math.min(tileSize - 1, stamp.worldX + radius - tileOriginX);
      const localMinY = Math.max(0, stamp.worldY - radius - tileOriginY);
      const localMaxY = Math.min(tileSize - 1, stamp.worldY + radius - tileOriginY);

      let nextTile: TileState | null = null;

      for (let localY = localMinY; localY <= localMaxY; localY += 1) {
        const sampleWorldY = tileOriginY + localY;

        for (let localX = localMinX; localX <= localMaxX; localX += 1) {
          const sampleWorldX = tileOriginX + localX;
          const distance = Math.hypot(sampleWorldX - stamp.worldX, sampleWorldY - stamp.worldY);
          if (distance > radius) {
            continue;
          }

          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;

          if (sourceTile.terrain[index] === targetTerrain) {
            continue;
          }

          if (!nextTile) {
            nextTile = cloneTile(currentTile);
          }

          nextTile.terrain[index] = targetTerrain;
          changedSampleCount += 1;
        }
      }

      if (nextTile) {
        nextTiles[tileKey(tileX, tileY)] = nextTile;
        changedTileCount += 1;
      }
    }
  }

  if (changedTileCount === 0) {
    return {
      project,
      changedTileCount,
      changedSampleCount,
      changedTileKeys: [],
    };
  }

  const nextDimension: DimensionState = {
    ...dimension,
    tiles: {
      ...dimension.tiles,
      ...nextTiles,
    },
  };

  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      dimensions: {
        ...project.dimensions,
        [dimensionId]: nextDimension,
      },
    },
    changedTileCount,
    changedSampleCount,
    changedTileKeys: Object.keys(nextTiles),
  };
}