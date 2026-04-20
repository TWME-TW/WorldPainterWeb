/**
 * First-pass Minecraft Java Edition world export.
 *
 * Generates Anvil region files (.mca) and a minimal level.dat from the
 * active dimension's canonical tile data, then packages everything as a
 * downloadable .zip using fflate.
 *
 * Target format: Minecraft Java Edition 1.17.1 (DataVersion 2730).
 *   - Y range 0–255, sections 0–15 of 16 blocks each.
 *   - BlockStates long array uses 1.16+ compact encoding (no cross-long spans).
 *   - Biomes stored as int[1024] (4×4×4 biome cubes, 4×4×64 per chunk).
 *
 * Limitations (first pass):
 *   - Heights and water levels only; material variety beyond the five terrain
 *     codes (grass / sand / stone / snow / water) is not yet implemented.
 *   - Y values outside [0, 255] are clamped to the 1.17 range.
 *   - No lighting; Minecraft will recalculate sky/block light on first load.
 */

import { gzipSync, zlibSync, zipSync, type ZipOptions } from 'fflate';
import {
  TERRAIN_CODES,
  TILE_SIZE,
  getActiveDimension,
  type ProjectState,
  type TileState,
} from '../model/types.ts';
import {
  nbtByte,
  nbtCompound,
  nbtInt,
  nbtIntArray,
  nbtList,
  nbtLong,
  nbtLongArray,
  nbtString,
  serializeNbtRoot,
  TAG_COMPOUND,
} from './nbt.ts';

// ---- Constants ----

const MC_DATA_VERSION = 2730; // Java Edition 1.17.1
const MC_VERSION_NAME = '1.17.1';
const SECTION_HEIGHT = 16; // blocks per section
const SECTIONS_PER_CHUNK = 16; // sections per chunk (Y 0–255)
const CHUNK_SIZE = 16; // blocks per chunk in X or Z
const CHUNKS_PER_TILE = TILE_SIZE / CHUNK_SIZE; // 8 (128 / 16)
const CHUNKS_PER_REGION = 32; // chunks per region in X or Z
const BIOME_OCEAN = 0;
const BIOME_PLAINS = 1;
const BIOME_DESERT = 2;
const BIOME_MOUNTAINS = 3;
const BIOME_SNOWY_TUNDRA = 12;
const BIOMES_PER_CHUNK = 1024; // 4×4×64 biome entries per chunk (3D biomes, 1.15+)

// Block IDs
const AIR = 'minecraft:air';
const BEDROCK = 'minecraft:bedrock';
const STONE = 'minecraft:stone';
const DIRT = 'minecraft:dirt';
const GRASS_BLOCK = 'minecraft:grass_block';
const SAND = 'minecraft:sand';
const SANDSTONE = 'minecraft:sandstone';
const SNOW_BLOCK = 'minecraft:snow_block';
const GRAVEL = 'minecraft:gravel';
const WATER = 'minecraft:water';

// ---- Biome mapping ----

function biomeForTerrain(terrain: number): number {
  switch (terrain) {
    case TERRAIN_CODES.water: return BIOME_OCEAN;
    case TERRAIN_CODES.sand: return BIOME_DESERT;
    case TERRAIN_CODES.stone: return BIOME_MOUNTAINS;
    case TERRAIN_CODES.snow: return BIOME_SNOWY_TUNDRA;
    default: return BIOME_PLAINS;
  }
}

// ---- Block mapping ----

function surfaceBlock(terrain: number): string {
  switch (terrain) {
    case TERRAIN_CODES.sand: return SAND;
    case TERRAIN_CODES.stone: return STONE;
    case TERRAIN_CODES.snow: return SNOW_BLOCK;
    case TERRAIN_CODES.water: return GRAVEL; // ocean / river floor
    default: return GRASS_BLOCK; // grass, unknown
  }
}

function subSurfaceBlock(terrain: number): string {
  if (terrain === TERRAIN_CODES.grass) {
    return DIRT;
  }

  if (terrain === TERRAIN_CODES.sand) {
    return SANDSTONE;
  }

  return STONE;
}

// ---- Section generation ----

interface ColumnSample {
  height: number;   // terrain surface Y (Minecraft block Y)
  water: number;    // water surface Y (0 if no water)
  terrain: number;  // TERRAIN_CODES value
}

/**
 * Encode 4096 block palette indices into the Minecraft 1.16+ compact
 * BlockStates long array (indices do not span across longs).
 */
function packBlockStates(blocks: Uint16Array, paletteSize: number): BigInt64Array {
  const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(Math.max(paletteSize, 2))));
  const valuesPerLong = Math.floor(64 / bitsPerBlock);
  const longCount = Math.ceil(4096 / valuesPerLong);
  const longs = new BigInt64Array(longCount);

  for (let i = 0; i < 4096; i += 1) {
    const longIndex = Math.floor(i / valuesPerLong);
    const bitOffset = (i % valuesPerLong) * bitsPerBlock;
    // Use unsigned OR to avoid sign issues
    longs[longIndex] = BigInt.asIntN(64, (BigInt.asUintN(64, longs[longIndex]) | (BigInt(blocks[i]) << BigInt(bitOffset))));
  }

  return longs;
}

/**
 * Generate one 16×16×16 section worth of block data.
 * Returns null if the section is entirely air (should be omitted from NBT).
 * columns is indexed as [bx + bz * 16] (bx/bz: 0–15 in chunk).
 */
function generateSection(
  sectionY: number,
  columns: ColumnSample[],
): { palette: string[]; blockStates: BigInt64Array } | null {
  const minY = sectionY * SECTION_HEIGHT;
  const maxY = minY + SECTION_HEIGHT - 1;

  // Skip if no column has terrain or water reaching into this Y band.
  const hasContent = columns.some((col) => {
    const effectiveSurface = Math.max(col.height, col.water > col.height ? col.water : 0);
    return effectiveSurface >= minY || (minY === 0);
  });

  if (!hasContent) {
    return null;
  }

  const paletteMap = new Map<string, number>();
  const paletteList: string[] = [];
  // air is always palette index 0 so all-zero initialisation means air
  paletteList.push(AIR);
  paletteMap.set(AIR, 0);

  function paletteIndex(name: string): number {
    let idx = paletteMap.get(name);

    if (idx === undefined) {
      idx = paletteList.length;
      paletteList.push(name);
      paletteMap.set(name, idx);
    }

    return idx;
  }

  // blocks[y*256 + z*16 + x] stores the palette index for each of the 4096 positions.
  const blocks = new Uint16Array(4096); // initialised to 0 (= air)

  for (let bz = 0; bz < CHUNK_SIZE; bz += 1) {
    for (let bx = 0; bx < CHUNK_SIZE; bx += 1) {
      const { height, water, terrain } = columns[bx + bz * CHUNK_SIZE];
      // Clamp to 1.17 Y range.
      const h = Math.max(0, Math.min(255, height));
      const w = water > height ? Math.max(0, Math.min(255, water)) : 0;

      for (let localY = 0; localY < SECTION_HEIGHT; localY += 1) {
        const worldY = minY + localY;

        if (worldY > 255) {
          continue;
        }

        let blockName: string;

        if (worldY === 0) {
          blockName = BEDROCK;
        } else if (worldY > h) {
          // Above terrain surface: water if below water table, else air.
          if (w > h && worldY <= w) {
            blockName = WATER;
          } else {
            continue; // air, index already 0
          }
        } else if (worldY === h) {
          blockName = surfaceBlock(terrain);
        } else if (worldY >= h - 3) {
          blockName = subSurfaceBlock(terrain);
        } else {
          blockName = STONE;
        }

        // Section block order: Y first (stride 256), then Z (stride 16), then X.
        blocks[localY * 256 + bz * 16 + bx] = paletteIndex(blockName);
      }
    }
  }

  // If the only palette entry is air (nothing was placed), skip this section.
  if (paletteList.length === 1) {
    return null;
  }

  return {
    palette: paletteList,
    blockStates: packBlockStates(blocks, paletteList.length),
  };
}

// ---- Chunk generation ----

/**
 * Generate uncompressed NBT bytes for one 16×16×256 chunk.
 */
function generateChunkNbt(
  chunkX: number,
  chunkZ: number,
  tile: TileState,
): Uint8Array {
  // Build the 16×16 column sample array.
  // chunkX / chunkZ are absolute Minecraft chunk coordinates.
  // tile.x / tile.y are WorldPainter tile coordinates.
  const tileOriginBlockX = tile.x * TILE_SIZE;
  const tileOriginBlockZ = tile.y * TILE_SIZE;
  const chunkOriginBlockX = chunkX * CHUNK_SIZE;
  const chunkOriginBlockZ = chunkZ * CHUNK_SIZE;

  const columns: ColumnSample[] = new Array(CHUNK_SIZE * CHUNK_SIZE);

  for (let bz = 0; bz < CHUNK_SIZE; bz += 1) {
    for (let bx = 0; bx < CHUNK_SIZE; bx += 1) {
      const blockX = chunkOriginBlockX + bx;
      const blockZ = chunkOriginBlockZ + bz;
      const localX = blockX - tileOriginBlockX;
      const localZ = blockZ - tileOriginBlockZ;
      const sampleIdx = localX + localZ * TILE_SIZE;

      columns[bx + bz * CHUNK_SIZE] = {
        height: tile.heights[sampleIdx] ?? 64,
        water: tile.waterLevels[sampleIdx] ?? 0,
        terrain: tile.terrain[sampleIdx] ?? TERRAIN_CODES.grass,
      };
    }
  }

  // Generate non-empty sections.
  const sectionEntries = [];

  for (let sY = 0; sY < SECTIONS_PER_CHUNK; sY += 1) {
    const sectionData = generateSection(sY, columns);

    if (!sectionData) {
      continue;
    }

    const paletteEntries = sectionData.palette.map((name) => nbtCompound({ Name: nbtString(name) }));
    sectionEntries.push(nbtCompound({
      Y: nbtByte(sY),
      Palette: nbtList(TAG_COMPOUND, paletteEntries),
      BlockStates: nbtLongArray(sectionData.blockStates),
    }));
  }

  // Biomes: int[1024] — 3D biome grid (4×4×64 per chunk, each cell covers 4×4×4 blocks).
  // Index: yb * 16 + zb * 4 + xb where xb = bx >> 2, zb = bz >> 2, yb (0–63).
  // Use terrain at the centre of each horizontal biome cell for all Y layers.
  const biomes = new Int32Array(BIOMES_PER_CHUNK);
  for (let yb = 0; yb < 64; yb += 1) {
    for (let zb = 0; zb < 4; zb += 1) {
      for (let xb = 0; xb < 4; xb += 1) {
        const bx = xb * 4 + 2; // centre of biome cell (0–15)
        const bz = zb * 4 + 2;
        const terrain = columns[bx + bz * CHUNK_SIZE].terrain;
        biomes[yb * 16 + zb * 4 + xb] = biomeForTerrain(terrain);
      }
    }
  }

  const level = nbtCompound({
    xPos: nbtInt(chunkX),
    zPos: nbtInt(chunkZ),
    LastUpdate: nbtLong(0n),
    InhabitedTime: nbtLong(0n),
    Status: nbtString('full'),
    Sections: nbtList(TAG_COMPOUND, sectionEntries),
    Entities: nbtList(TAG_COMPOUND, []),
    TileEntities: nbtList(TAG_COMPOUND, []),
    Biomes: nbtIntArray(biomes),
    Heightmaps: nbtCompound({}),
  });

  return serializeNbtRoot('', {
    DataVersion: nbtInt(MC_DATA_VERSION),
    Level: level,
  });
}

// ---- Region file (.mca) writer ----

interface RegionChunk {
  localX: number; // 0–31
  localZ: number; // 0–31
  compressed: Uint8Array;
  sectorOffset: number;
}

/**
 * Pack a set of chunks into a Minecraft Anvil region (.mca) file byte array.
 */
function writeRegionFile(chunks: Array<{ localX: number; localZ: number; nbt: Uint8Array }>): Uint8Array {
  // zlib-compress each chunk's NBT (Minecraft compression type 2).
  const regionChunks: RegionChunk[] = [];
  let currentSector = 2; // sectors 0 and 1 are the two 4096-byte header tables

  for (const { localX, localZ, nbt } of chunks) {
    const compressed = zlibSync(nbt);
    // Each chunk entry: 4-byte length + 1-byte compression type + compressed data.
    const entrySize = 4 + 1 + compressed.length;
    const sectorCount = Math.ceil(entrySize / 4096);
    regionChunks.push({ localX, localZ, compressed, sectorOffset: currentSector });
    currentSector += sectorCount;
  }

  const totalSectors = currentSector;
  const fileBytes = new Uint8Array(totalSectors * 4096);
  const view = new DataView(fileBytes.buffer);

  // Write chunk location table (sector 0, 1024 × 4 bytes).
  for (const chunk of regionChunks) {
    const entryIndex = chunk.localX + chunk.localZ * CHUNKS_PER_REGION;
    const sectorCount = Math.ceil((4 + 1 + chunk.compressed.length) / 4096);
    // Format: 3-byte sector offset (big-endian) + 1-byte sector count = one big-endian uint32.
    view.setUint32(entryIndex * 4, (chunk.sectorOffset << 8) | sectorCount, false);
  }

  // Chunk timestamp table (sector 1) stays all-zeros.

  // Write chunk data.
  for (const chunk of regionChunks) {
    const byteOffset = chunk.sectorOffset * 4096;
    // Length field: number of bytes following the 4-byte length field itself (= 1 + compressed size).
    view.setUint32(byteOffset, 1 + chunk.compressed.length, false);
    fileBytes[byteOffset + 4] = 2; // zlib compression type
    fileBytes.set(chunk.compressed, byteOffset + 5);
  }

  return fileBytes;
}

// ---- level.dat ----

function generateLevelDat(project: ProjectState): Uint8Array {
  const dimension = getActiveDimension(project);
  // Approximate spawn point: midpoint of loaded tile bounds.
  const midTileX = Math.round((dimension.minTileX + dimension.maxTileX) / 2);
  const midTileZ = Math.round((dimension.minTileY + dimension.maxTileY) / 2);
  const spawnX = midTileX * TILE_SIZE + TILE_SIZE / 2;
  const spawnZ = midTileZ * TILE_SIZE + TILE_SIZE / 2;
  const spawnY = 64;

  const data = nbtCompound({
    DataVersion: nbtInt(MC_DATA_VERSION),
    LevelName: nbtString(project.name),
    RandomSeed: nbtLong(0n),
    GameType: nbtInt(1), // creative
    SpawnX: nbtInt(spawnX),
    SpawnY: nbtInt(spawnY),
    SpawnZ: nbtInt(spawnZ),
    Time: nbtLong(0n),
    DayTime: nbtLong(6000n), // midday
    initialized: nbtByte(1),
    allowCommands: nbtByte(1),
    Version: nbtCompound({
      Id: nbtInt(MC_DATA_VERSION),
      Name: nbtString(MC_VERSION_NAME),
      Snapshot: nbtByte(0),
    }),
  });

  // level.dat on disk is gzip-compressed NBT.
  return gzipSync(serializeNbtRoot('', { Data: data }));
}

// ---- Public API ----

export interface ExportedMinecraftWorld {
  fileName: string;
  bytes: Uint8Array;
  regionCount: number;
  chunkCount: number;
}

export function canExportMinecraftWorld(project: ProjectState): boolean {
  const dimension = getActiveDimension(project);
  return Object.keys(dimension.tiles).length > 0;
}

/**
 * Export the active dimension of a project as a Minecraft Java Edition 1.17.1 world.
 * Returns a zip archive containing level.dat and all region files.
 *
 * Each WorldPainter tile (128×128 blocks) maps to an 8×8 chunk grid;
 * one Minecraft region (32×32 chunks = 512×512 blocks) accommodates 4×4 WP tiles.
 */
export function exportMinecraftWorld(project: ProjectState): ExportedMinecraftWorld {
  const dimension = getActiveDimension(project);
  const tiles = Object.values(dimension.tiles);

  if (tiles.length === 0) {
    throw new Error('The active dimension has no decoded tile data to export.');
  }

  // Group the 8×8 chunks for each tile by their Minecraft region.
  const regionMap = new Map<string, Array<{ localX: number; localZ: number; nbt: Uint8Array }>>();

  let chunkCount = 0;

  for (const tile of tiles) {
    const startChunkX = tile.x * CHUNKS_PER_TILE;
    const startChunkZ = tile.y * CHUNKS_PER_TILE;

    // Every WP tile's 8 chunks fall entirely within one region (since 8 | 32).
    const regionX = Math.floor(startChunkX / CHUNKS_PER_REGION);
    const regionZ = Math.floor(startChunkZ / CHUNKS_PER_REGION);
    const regionKey = `${regionX},${regionZ}`;

    if (!regionMap.has(regionKey)) {
      regionMap.set(regionKey, []);
    }

    const regionChunks = regionMap.get(regionKey)!;

    for (let lcz = 0; lcz < CHUNKS_PER_TILE; lcz += 1) {
      for (let lcx = 0; lcx < CHUNKS_PER_TILE; lcx += 1) {
        const chunkX = startChunkX + lcx;
        const chunkZ = startChunkZ + lcz;
        const localX = chunkX - regionX * CHUNKS_PER_REGION;
        const localZ = chunkZ - regionZ * CHUNKS_PER_REGION;
        regionChunks.push({ localX, localZ, nbt: generateChunkNbt(chunkX, chunkZ, tile) });
        chunkCount += 1;
      }
    }
  }

  // Build the zip contents.
  // Region files are stored without additional zip compression (chunks are already zlib-compressed).
  // level.dat is already gzip-compressed, so also store it uncompressed in zip.
  const noCompress: ZipOptions = { level: 0 };
  const zipFiles: Record<string, [Uint8Array, ZipOptions]> = {};

  for (const [regionKey, chunks] of regionMap) {
    const [regionX, regionZ] = regionKey.split(',').map(Number);
    zipFiles[`region/r.${regionX}.${regionZ}.mca`] = [writeRegionFile(chunks), noCompress];
  }

  zipFiles['level.dat'] = [generateLevelDat(project), noCompress];

  const safeName = project.name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();

  return {
    fileName: `${safeName}-mc1171.zip`,
    bytes: zipSync(zipFiles),
    regionCount: regionMap.size,
    chunkCount,
  };
}
