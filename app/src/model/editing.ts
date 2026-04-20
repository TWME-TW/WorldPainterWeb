import {
  TERRAIN_CODES,
  tileKey,
  type DimensionState,
  type ProjectState,
  type TerrainCode,
  type TileState,
} from './types.ts';

export type BrushTool =
  | 'raise' | 'lower' | 'flatten' | 'smooth' | 'erode'
  | 'raise-water' | 'lower-water'
  | 'paint-terrain' | 'spray'
  | 'flood-water' | 'flood-lava'
  | 'mountain' | 'sponge'
  | 'set-spawn';

export interface BrushSettings {
  tool: BrushTool;
  radius: number;
  strength: number;
  /** Active terrain code used when tool === 'paint-terrain'. */
  paintTerrain?: TerrainCode;
  /** Target height used when tool === 'flatten'. */
  flattenLevel?: number;
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

  if (settings.tool === 'paint-terrain' || settings.tool === 'spray') {
    return applyTerrainBrushToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'flatten') {
    return applyFlattenBrushToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'smooth') {
    return applySmoothBrushToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'erode') {
    return applyErodeBrushToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'flood-water' || settings.tool === 'flood-lava') {
    return applyFloodToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'mountain') {
    return applyMountainToProject(project, dimensionId, stamp, settings);
  }

  if (settings.tool === 'sponge') {
    return applySpongeToProject(project, dimensionId, stamp, settings);
  }

  // raise / lower (default)
  return applyHeightBrushToProject(project, dimensionId, stamp, settings);
}

/**
 * Explicitly paint a terrain code onto all cells within the brush radius.
 * For the `spray` tool, uses probabilistic painting (denser at centre).
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

          // Spray tool: probabilistic — probability decreases toward edge
          if (settings.tool === 'spray') {
            const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
            const probability = falloff * (settings.strength / 20);
            if (Math.random() > probability) continue;
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
// ─── Flatten brush ──────────────────────────────────────────────────────────

export function applyFlattenBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) {
    return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  }

  let targetHeight: number;
  if (settings.flattenLevel !== undefined) {
    targetHeight = settings.flattenLevel;
  } else {
    const centreKey = tileKey(
      Math.floor(stamp.worldX / dimension.tileSize),
      Math.floor(stamp.worldY / dimension.tileSize),
    );
    const centreTile = dimension.tiles[centreKey];
    if (!centreTile) {
      return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
    }
    const cx = ((stamp.worldX % dimension.tileSize) + dimension.tileSize) % dimension.tileSize;
    const cy = ((stamp.worldY % dimension.tileSize) + dimension.tileSize) % dimension.tileSize;
    targetHeight = centreTile.heights[cx + cy * dimension.tileSize];
  }

  const radius = Math.max(0, Math.floor(settings.radius));
  const strength = Math.max(1, Math.floor(settings.strength));
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
      if (!currentTile) continue;
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
          if (distance > radius) continue;
          const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
          const step = Math.max(1, Math.round(strength * falloff));
          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;
          const current = sourceTile.heights[index];
          const diff = targetHeight - current;
          if (diff === 0) continue;
          const move = Math.sign(diff) * Math.min(Math.abs(diff), step);
          const nextHeight = clamp(current + move, dimension.minHeight, dimension.maxHeight);
          const nextTerrain = classifyTerrain(nextHeight, sourceTile.waterLevels[index]);
          if (nextHeight === current && nextTerrain === sourceTile.terrain[index]) continue;
          if (!nextTile) nextTile = cloneTile(currentTile);
          nextTile.heights[index] = nextHeight;
          nextTile.terrain[index] = nextTerrain;
          changedSampleCount += 1;
        }
      }
      if (nextTile) { nextTiles[tileKey(tileX, tileY)] = nextTile; changedTileCount += 1; }
    }
  }

  if (changedTileCount === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount, changedSampleCount, changedTileKeys: Object.keys(nextTiles),
  };
}

// ─── Smooth brush ────────────────────────────────────────────────────────────

export function applySmoothBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const radius = Math.max(0, Math.floor(settings.radius));
  const blendFactor = Math.min(1, settings.strength / 20);
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount = 0;
  let changedSampleCount = 0;

  const getH = (wx: number, wy: number): number => {
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    const tile = dimension.tiles[tileKey(tx, ty)];
    if (!tile) return 0;
    const lx = ((wx % tileSize) + tileSize) % tileSize;
    const ly = ((wy % tileSize) + tileSize) % tileSize;
    return tile.heights[lx + ly * tileSize];
  };

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) continue;
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
          if (distance > radius) continue;
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += getH(sampleWorldX + dx, sampleWorldY + dy);
          const avg = sum / 9;
          const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;
          const current = sourceTile.heights[index];
          const nextHeight = clamp(Math.round(current + (avg - current) * blendFactor * falloff), dimension.minHeight, dimension.maxHeight);
          const nextTerrain = classifyTerrain(nextHeight, sourceTile.waterLevels[index]);
          if (nextHeight === current && nextTerrain === sourceTile.terrain[index]) continue;
          if (!nextTile) nextTile = cloneTile(currentTile);
          nextTile.heights[index] = nextHeight;
          nextTile.terrain[index] = nextTerrain;
          changedSampleCount += 1;
        }
      }
      if (nextTile) { nextTiles[tileKey(tileX, tileY)] = nextTile; changedTileCount += 1; }
    }
  }

  if (changedTileCount === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount, changedSampleCount, changedTileKeys: Object.keys(nextTiles),
  };
}

// ─── Erode brush ─────────────────────────────────────────────────────────────

export function applyErodeBrushToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const radius = Math.max(0, Math.floor(settings.radius));
  const strength = Math.max(1, Math.floor(settings.strength));
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount = 0;
  let changedSampleCount = 0;

  const getH = (wx: number, wy: number): number => {
    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    const tile = dimension.tiles[tileKey(tx, ty)];
    if (!tile) return 0;
    const lx = ((wx % tileSize) + tileSize) % tileSize;
    const ly = ((wy % tileSize) + tileSize) % tileSize;
    return tile.heights[lx + ly * tileSize];
  };

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) continue;
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
          if (distance > radius) continue;
          let minNeighbour = Number.MAX_SAFE_INTEGER;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const h = getH(sampleWorldX + dx, sampleWorldY + dy);
            if (h < minNeighbour) minNeighbour = h;
          }
          const index = localX + localY * tileSize;
          const sourceTile = nextTile ?? currentTile;
          const current = sourceTile.heights[index];
          if (current <= minNeighbour) continue;
          const falloff = radius === 0 ? 1 : 1 - distance / (radius + 1);
          const step = Math.max(1, Math.round(strength * falloff));
          const erosionAmount = Math.min(step, current - minNeighbour);
          const nextHeight = clamp(current - erosionAmount, dimension.minHeight, dimension.maxHeight);
          const nextTerrain = classifyTerrain(nextHeight, sourceTile.waterLevels[index]);
          if (nextHeight === current && nextTerrain === sourceTile.terrain[index]) continue;
          if (!nextTile) nextTile = cloneTile(currentTile);
          nextTile.heights[index] = nextHeight;
          nextTile.terrain[index] = nextTerrain;
          changedSampleCount += 1;
        }
      }
      if (nextTile) { nextTiles[tileKey(tileX, tileY)] = nextTile; changedTileCount += 1; }
    }
  }

  if (changedTileCount === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount, changedSampleCount, changedTileKeys: Object.keys(nextTiles),
  };
}

// ─── Flood tool ───────────────────────────────────────────────────────────────
// BFS from click point: fills all contiguous terrain at/below flood level with water or lava.
const MAX_FLOOD_CELLS = 100_000;

export function applyFloodToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const isLava = settings.tool === 'flood-lava';
  const tileSize = dimension.tileSize;
  const startTX = Math.floor(stamp.worldX / tileSize);
  const startTY = Math.floor(stamp.worldY / tileSize);
  const startTile = dimension.tiles[tileKey(startTX, startTY)];
  if (!startTile) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const startLX = ((stamp.worldX % tileSize) + tileSize) % tileSize;
  const startLY = ((stamp.worldY % tileSize) + tileSize) % tileSize;
  const floodLevel = startTile.heights[startLX + startLY * tileSize];

  const nextTiles: Record<string, TileState> = {};
  const getOrCloneTile = (tx: number, ty: number): TileState | null => {
    const k = tileKey(tx, ty);
    if (nextTiles[k]) return nextTiles[k];
    const orig = dimension.tiles[k];
    if (!orig) return null;
    nextTiles[k] = cloneTile(orig);
    return nextTiles[k];
  };

  const visited = new Set<string>();
  const queue: [number, number][] = [[stamp.worldX, stamp.worldY]];
  let changedSampleCount = 0;

  while (queue.length > 0 && changedSampleCount < MAX_FLOOD_CELLS) {
    const item = queue.shift()!;
    const wx = item[0]; const wy = item[1];
    const cellKey = `${wx},${wy}`;
    if (visited.has(cellKey)) continue;
    visited.add(cellKey);

    const tx = Math.floor(wx / tileSize);
    const ty = Math.floor(wy / tileSize);
    const lx = ((wx % tileSize) + tileSize) % tileSize;
    const ly = ((wy % tileSize) + tileSize) % tileSize;
    const tile = getOrCloneTile(tx, ty);
    if (!tile) continue;

    const idx = lx + ly * tileSize;
    const height = tile.heights[idx];
    if (height > floodLevel) continue;

    const newTerrain = isLava ? TERRAIN_CODES.lava : TERRAIN_CODES.water;
    if (tile.waterLevels[idx] === floodLevel && tile.terrain[idx] === newTerrain) continue;

    tile.waterLevels[idx] = floodLevel;
    tile.terrain[idx] = newTerrain;
    changedSampleCount += 1;

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nKey = `${wx + dx},${wy + dy}`;
      if (!visited.has(nKey)) queue.push([wx + dx, wy + dy]);
    }
  }

  const changedTileKeys = Object.keys(nextTiles);
  if (changedTileKeys.length === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount: changedTileKeys.length, changedSampleCount, changedTileKeys,
  };
}

// ─── Mountain tool ─────────────────────────────────────────────────────────────
// Creates a conical mountain at the click point; peak gain = strength * 8.

export function applyMountainToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const radius = Math.max(1, Math.floor(settings.radius));
  const peakGain = settings.strength * 8;
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount2 = 0; let changedSampleCount2 = 0;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) continue;
      const toX = tileX * tileSize; const toY = tileY * tileSize;
      const lMinX = Math.max(0, stamp.worldX - radius - toX);
      const lMaxX = Math.min(tileSize - 1, stamp.worldX + radius - toX);
      const lMinY = Math.max(0, stamp.worldY - radius - toY);
      const lMaxY = Math.min(tileSize - 1, stamp.worldY + radius - toY);
      let nextTile: TileState | null = null;
      for (let ly = lMinY; ly <= lMaxY; ly++) {
        for (let lx = lMinX; lx <= lMaxX; lx++) {
          const swX = toX + lx; const swY = toY + ly;
          const dist = Math.hypot(swX - stamp.worldX, swY - stamp.worldY);
          if (dist > radius) continue;
          const cone = Math.round(peakGain * (1 - dist / radius));
          if (cone <= 0) continue;
          const index = lx + ly * tileSize;
          const src = nextTile ?? currentTile;
          const nh = clamp(src.heights[index] + cone, dimension.minHeight, dimension.maxHeight);
          const nt = classifyTerrain(nh, src.waterLevels[index]);
          if (nh === src.heights[index] && nt === src.terrain[index]) continue;
          if (!nextTile) nextTile = cloneTile(currentTile);
          nextTile.heights[index] = nh; nextTile.terrain[index] = nt;
          changedSampleCount2 += 1;
        }
      }
      if (nextTile) { nextTiles[tileKey(tileX, tileY)] = nextTile; changedTileCount2 += 1; }
    }
  }

  if (changedTileCount2 === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount: changedTileCount2, changedSampleCount: changedSampleCount2, changedTileKeys: Object.keys(nextTiles),
  };
}

// ─── Sponge tool ──────────────────────────────────────────────────────────────
// Removes water within the brush radius (sets waterLevel → minHeight).

export function applySpongeToProject(
  project: ProjectState,
  dimensionId: string,
  stamp: BrushStamp,
  settings: BrushSettings,
): BrushMutationResult {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };

  const radius = Math.max(0, Math.floor(settings.radius));
  const tileSize = dimension.tileSize;
  const minTileX = Math.floor((stamp.worldX - radius) / tileSize);
  const maxTileX = Math.floor((stamp.worldX + radius) / tileSize);
  const minTileY = Math.floor((stamp.worldY - radius) / tileSize);
  const maxTileY = Math.floor((stamp.worldY + radius) / tileSize);
  const nextTiles: Record<string, TileState> = {};
  let changedTileCount3 = 0; let changedSampleCount3 = 0;
  const dryLevel = dimension.minHeight ?? 0;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const currentTile = dimension.tiles[tileKey(tileX, tileY)];
      if (!currentTile) continue;
      const toX = tileX * tileSize; const toY = tileY * tileSize;
      const lMinX = Math.max(0, stamp.worldX - radius - toX);
      const lMaxX = Math.min(tileSize - 1, stamp.worldX + radius - toX);
      const lMinY = Math.max(0, stamp.worldY - radius - toY);
      const lMaxY = Math.min(tileSize - 1, stamp.worldY + radius - toY);
      let nextTile: TileState | null = null;
      for (let ly = lMinY; ly <= lMaxY; ly++) {
        for (let lx = lMinX; lx <= lMaxX; lx++) {
          const swX = toX + lx; const swY = toY + ly;
          if (Math.hypot(swX - stamp.worldX, swY - stamp.worldY) > radius) continue;
          const index = lx + ly * tileSize;
          const src = nextTile ?? currentTile;
          if (src.waterLevels[index] <= dryLevel) continue;
          if (!nextTile) nextTile = cloneTile(currentTile);
          nextTile.waterLevels[index] = dryLevel;
          nextTile.terrain[index] = classifyTerrain(nextTile.heights[index], dryLevel);
          changedSampleCount3 += 1;
        }
      }
      if (nextTile) { nextTiles[tileKey(tileX, tileY)] = nextTile; changedTileCount3 += 1; }
    }
  }

  if (changedTileCount3 === 0) return { project, changedTileCount: 0, changedSampleCount: 0, changedTileKeys: [] };
  return {
    project: { ...project, updatedAt: new Date().toISOString(), dimensions: { ...project.dimensions, [dimensionId]: { ...dimension, tiles: { ...dimension.tiles, ...nextTiles } } } },
    changedTileCount: changedTileCount3, changedSampleCount: changedSampleCount3, changedTileKeys: Object.keys(nextTiles),
  };
}

