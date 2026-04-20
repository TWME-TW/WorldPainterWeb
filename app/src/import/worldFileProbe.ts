import { gunzipSync } from 'fflate';
import type {
  ImportedWorldFileSource,
  TerrainCode,
  WorldFileAnchorSummary,
  WorldFileDimensionSummary,
  WorldFileLayerBufferSummary,
  WorldFileLayerDataSize,
  WorldFileLayerSettingSummary,
  WorldFileLayerSummary,
  WorldFileMetadata,
  WorldFilePlugin,
  WorldFilePointSummary,
  WorldFileProbeResult,
  WorldFileSeedSummary,
  WorldFileTileSourcePatch,
  WorldFileTilePayload,
  WorldFileWorldSummary,
} from '../model/types';

const TERRAIN_CODES = {
  grass: 0,
  sand: 1,
  stone: 2,
  snow: 3,
  water: 4,
} as const satisfies Record<string, TerrainCode>;

const GZIP_MAGIC = [0x1f, 0x8b] as const;
const JAVA_STREAM_HEADER = [0xac, 0xed, 0x00, 0x05] as const;
const BASE_WIRE_HANDLE = 0x7e0000;

const METADATA_KEY_NAME = 'name';
const METADATA_KEY_WP_VERSION = 'org.pepsoft.worldpainter.wp.version';
const METADATA_KEY_WP_BUILD = 'org.pepsoft.worldpainter.wp.build';
const METADATA_KEY_TIMESTAMP = 'org.pepsoft.worldpainter.timestamp';
const METADATA_KEY_PLUGINS = 'org.pepsoft.worldpainter.plugins';

const TokenCode = {
  Null: 0x70,
  Reference: 0x71,
  ClassDesc: 0x72,
  Object: 0x73,
  String: 0x74,
  Array: 0x75,
  Class: 0x76,
  BlockData: 0x77,
  EndBlockData: 0x78,
  Reset: 0x79,
  BlockDataLong: 0x7a,
  LongString: 0x7c,
  ProxyClassDesc: 0x7d,
  Enum: 0x7e,
} as const;

const ClassDescFlag = {
  WriteMethod: 0x01,
  Serializable: 0x02,
  Externalizable: 0x04,
  BlockData: 0x08,
} as const;

interface JavaFieldDesc {
  typeCode: string;
  name: string;
}

interface JavaClassDesc {
  name: string;
  flags: number;
  fields: JavaFieldDesc[];
  superClass: JavaClassDesc | null;
}

interface JavaObjectValue {
  kind: 'object';
  className: string;
  fields: Record<string, JavaValue>;
  annotations: JavaValue[];
}

type JavaMapValue = Map<unknown, JavaValue>;
type ReadHint = 'dimensions-map' | 'dimension-value' | 'tile-map' | 'tile-value';

type JavaValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | Int16Array
  | Int32Array
  | JavaObjectValue
  | JavaValue[]
  | JavaMapValue;

interface WorldFileHeader {
  metadata: JavaValue;
  worldRootClass: string | null;
  worldSummary: WorldFileWorldSummary | null;
}

interface JavaPrimitiveArraySource {
  typeName: '[B' | '[S' | '[I';
  dataOffset: number;
  length: number;
}

const PRIMITIVE_ARRAY_SOURCES = new WeakMap<object, JavaPrimitiveArraySource>();

function rememberPrimitiveArraySource(value: object, source: JavaPrimitiveArraySource): void {
  PRIMITIVE_ARRAY_SOURCES.set(value, source);
}

function getPrimitiveArraySource(value: object): JavaPrimitiveArraySource | null {
  return PRIMITIVE_ARRAY_SOURCES.get(value) ?? null;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  return prefix.every((value, index) => bytes[index] === value);
}

function normalizePluginList(value: JavaValue): WorldFilePlugin[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return [];
    }

    const [name, version] = entry;
    if (typeof name !== 'string' || typeof version !== 'string') {
      return [];
    }

    return [{ name, version }];
  });
}

function isJavaObjectValue(value: JavaValue): value is JavaObjectValue {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && !(value instanceof Map)
      && !(value instanceof Uint8Array)
      && 'kind' in value
      && value.kind === 'object',
  );
}

function normalizeTimestamp(value: JavaValue): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return toIsoTimestamp(value);
  }

  if (isJavaObjectValue(value)) {
    const timeValue = value.fields.fastTime ?? value.fields.time;
    if (typeof timeValue === 'number') {
      return toIsoTimestamp(timeValue);
    }
  }

  return null;
}

function normalizeMetadata(value: JavaValue): WorldFileMetadata | null {
  if (!(value instanceof Map)) {
    return null;
  }

  const name = value.get(METADATA_KEY_NAME);
  const wpVersion = value.get(METADATA_KEY_WP_VERSION);
  const wpBuild = value.get(METADATA_KEY_WP_BUILD);
  const timestamp = value.get(METADATA_KEY_TIMESTAMP);
  const plugins = value.get(METADATA_KEY_PLUGINS);

  return {
    name: typeof name === 'string' ? name : null,
    wpVersion: typeof wpVersion === 'string' ? wpVersion : null,
    wpBuild: typeof wpBuild === 'string' ? wpBuild : null,
    timestamp: normalizeTimestamp(timestamp ?? null),
    plugins: normalizePluginList(plugins ?? null),
  };
}

function getStringField(value: JavaObjectValue, fieldName: string): string | null {
  const fieldValue = value.fields[fieldName];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function getNumberField(value: JavaObjectValue, fieldName: string): number | null {
  const fieldValue = value.fields[fieldName];
  return typeof fieldValue === 'number' ? fieldValue : null;
}

function getBooleanField(value: JavaObjectValue, fieldName: string): boolean | null {
  const fieldValue = value.fields[fieldName];
  return typeof fieldValue === 'boolean' ? fieldValue : null;
}

function getUint8ArrayField(value: JavaObjectValue, fieldName: string): Uint8Array | null {
  const fieldValue = value.fields[fieldName];
  return fieldValue instanceof Uint8Array ? fieldValue : null;
}

function getInt16ArrayField(value: JavaObjectValue, fieldName: string): Int16Array | null {
  const fieldValue = value.fields[fieldName];
  return fieldValue instanceof Int16Array ? fieldValue : null;
}

function getInt32ArrayField(value: JavaObjectValue, fieldName: string): Int32Array | null {
  const fieldValue = value.fields[fieldName];
  return fieldValue instanceof Int32Array ? fieldValue : null;
}

function getAnchorDefaultName(dim: number, role: string | null, invert: boolean, id: number): string {
  let baseName: string;

  switch (dim) {
    case 0:
      baseName = 'Surface';
      break;
    case 1:
      baseName = 'Nether';
      break;
    case 2:
      baseName = 'End';
      break;
    default:
      baseName = `Dimension ${dim}`;
      break;
  }

  switch (role) {
    case 'MASTER':
      baseName += ' Master';
      break;
    case 'CAVE_FLOOR':
      baseName += ' Cave Floor';
      break;
    case 'FLOATING_FLOOR':
      baseName += ' Floating Floor';
      break;
    default:
      break;
  }

  if (invert) {
    baseName += ' Ceiling';
  }

  if (id !== 0) {
    baseName += ` ${id}`;
  }

  return baseName;
}

function extractPointSummary(value: JavaValue): WorldFilePointSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  const x = getNumberField(value, 'x');
  const y = getNumberField(value, 'y');
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function extractAnchorSummary(value: JavaValue): WorldFileAnchorSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  const dim = getNumberField(value, 'dim');
  const role = getStringField(value, 'role');
  const invert = getBooleanField(value, 'invert');
  const id = getNumberField(value, 'id');
  if (dim === null || invert === null || id === null) {
    return null;
  }

  return {
    dim,
    role,
    invert,
    id,
    defaultName: getAnchorDefaultName(dim, role, invert, id),
  };
}

function extractTileCount(value: JavaValue): number | null {
  if (value instanceof Map) {
    return value.size;
  }

  return null;
}

function getShortClassName(className: string): string {
  const segments = className.split('.');
  return segments[segments.length - 1] ?? className;
}

function compareLayerSummary(left: WorldFileLayerSummary, right: WorldFileLayerSummary): number {
  const leftLabel = left.name ?? left.id ?? getShortClassName(left.className);
  const rightLabel = right.name ?? right.id ?? getShortClassName(right.className);
  const labelCompare = leftLabel.localeCompare(rightLabel);
  if (labelCompare !== 0) {
    return labelCompare;
  }

  return left.className.localeCompare(right.className);
}

function getLayerSummaryKey(layer: WorldFileLayerSummary): string {
  return `${layer.className}::${layer.id ?? ''}::${layer.name ?? ''}`;
}

function normalizeLayerDataSize(value: JavaValue): WorldFileLayerDataSize {
  switch (value) {
    case 'BIT':
    case 'NIBBLE':
    case 'BYTE':
    case 'BIT_PER_CHUNK':
    case 'NONE':
      return value;
    default:
      return 'unknown';
  }
}

function extractLayerSummary(value: JavaValue): WorldFileLayerSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  return {
    className: value.className,
    id: getStringField(value, 'id'),
    name: getStringField(value, 'name'),
    dataSize: normalizeLayerDataSize(value.fields.dataSize ?? null),
  };
}

function extractBufferLength(value: JavaValue): { bufferLength: number; byteLength: number } | null {
  if (value instanceof Uint8Array || value instanceof Int16Array || value instanceof Int32Array) {
    return {
      bufferLength: value.length,
      byteLength: value.byteLength,
    };
  }

  if (Array.isArray(value)) {
    return {
      bufferLength: value.length,
      byteLength: value.length * 8,
    };
  }

  return null;
}

function extractBitSetLength(value: JavaValue): { bufferLength: number; byteLength: number } | null {
  if (!isJavaObjectValue(value) || value.className !== 'java.util.BitSet') {
    return null;
  }

  const words = value.fields.words ?? null;
  const rawLength = Array.isArray(words) ? words.length : 0;
  const wordsInUse = getNumberField(value, 'wordsInUse');
  const bufferLength = wordsInUse === null ? rawLength : Math.max(0, Math.min(wordsInUse, rawLength || wordsInUse));

  return {
    bufferLength,
    byteLength: bufferLength * 8,
  };
}

function extractLayerBufferSummaries(value: JavaValue, storage: 'value' | 'bit'): WorldFileLayerBufferSummary[] {
  if (!(value instanceof Map)) {
    return [];
  }

  return Array.from(value.entries())
    .map(([layerValue, bufferValue]) => {
      const layer = extractLayerSummary(layerValue as JavaValue);
      if (!layer) {
        return null;
      }

      const length = storage === 'bit'
        ? extractBitSetLength(bufferValue)
        : extractBufferLength(bufferValue as JavaValue);
      if (!length) {
        return null;
      }

      return {
        layer,
        storage,
        bufferLength: length.bufferLength,
        byteLength: length.byteLength,
      } satisfies WorldFileLayerBufferSummary;
    })
    .filter((summary): summary is WorldFileLayerBufferSummary => summary !== null)
    .sort((left, right) => compareLayerSummary(left.layer, right.layer));
}

function extractSeedSummary(value: JavaValue): WorldFileSeedSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  const locationValue = value.fields.location ?? null;
  const location = isJavaObjectValue(locationValue)
    ? {
      x: getNumberField(locationValue, 'x'),
      y: getNumberField(locationValue, 'y'),
      z: getNumberField(locationValue, 'z'),
    }
    : { x: null, y: null, z: null };

  return {
    className: value.className,
    x: location.x,
    y: location.y,
    z: location.z,
    category: getNumberField(value, 'category'),
    seed: getNumberField(value, 'seed'),
  };
}

function extractSeedSummaries(value: JavaValue): WorldFileSeedSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(extractSeedSummary)
    .filter((summary): summary is WorldFileSeedSummary => summary !== null)
    .sort((left, right) => {
      const classCompare = left.className.localeCompare(right.className);
      if (classCompare !== 0) {
        return classCompare;
      }

      if (left.x !== right.x) {
        return (left.x ?? Number.MIN_SAFE_INTEGER) - (right.x ?? Number.MIN_SAFE_INTEGER);
      }

      if (left.y !== right.y) {
        return (left.y ?? Number.MIN_SAFE_INTEGER) - (right.y ?? Number.MIN_SAFE_INTEGER);
      }

      return (left.z ?? Number.MIN_SAFE_INTEGER) - (right.z ?? Number.MIN_SAFE_INTEGER);
    });
}

function extractLayerSettingSummaries(value: JavaValue): WorldFileLayerSettingSummary[] {
  if (!(value instanceof Map)) {
    return [];
  }

  return Array.from(value.entries())
    .map(([layerValue, settingsValue]) => {
      const layer = extractLayerSummary(layerValue as JavaValue);
      if (!layer) {
        return null;
      }

      return {
        layer,
        settingsClassName: isJavaObjectValue(settingsValue) ? settingsValue.className : null,
      } satisfies WorldFileLayerSettingSummary;
    })
    .filter((summary): summary is WorldFileLayerSettingSummary => summary !== null)
    .sort((left, right) => compareLayerSummary(left.layer, right.layer));
}

function collectAvailableLayers(
  tileLayerSummaries: WorldFileLayerBufferSummary[],
  layerSettings: WorldFileLayerSettingSummary[],
): WorldFileLayerSummary[] {
  const layersByKey = new Map<string, WorldFileLayerSummary>();

  tileLayerSummaries.forEach((summary) => {
    layersByKey.set(getLayerSummaryKey(summary.layer), summary.layer);
  });

  layerSettings.forEach((summary) => {
    layersByKey.set(getLayerSummaryKey(summary.layer), summary.layer);
  });

  return Array.from(layersByKey.values()).sort(compareLayerSummary);
}

function mapTerrainOrdinalToPreviewCode(rawTerrain: number, height: number, waterLevel: number): TerrainCode {
  if (waterLevel > height || rawTerrain === 6 || rawTerrain === 7) {
    return TERRAIN_CODES.water;
  }

  if (rawTerrain === 2 || rawTerrain === 3) {
    return TERRAIN_CODES.sand;
  }

  if (rawTerrain === 8 || rawTerrain === 9) {
    return TERRAIN_CODES.snow;
  }

  if ([4, 5, 10, 11, 12, 13, 18, 21].includes(rawTerrain)) {
    return TERRAIN_CODES.stone;
  }

  if (height <= 62) {
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

function extractTileCoordinates(tileValue: JavaObjectValue, pointValue: JavaValue): { x: number; y: number } | null {
  const tileX = getNumberField(tileValue, 'x');
  const tileY = getNumberField(tileValue, 'y');
  if (tileX !== null && tileY !== null) {
    return { x: tileX, y: tileY };
  }

  const point = extractPointSummary(pointValue);
  if (point) {
    return point;
  }

  return null;
}

function extractTileSourcePatch(
  tileValue: JavaObjectValue,
  minHeight: number,
  tall: boolean,
  expectedLength: number,
): WorldFileTileSourcePatch | null {
  const heightMap = tall ? getInt32ArrayField(tileValue, 'tallHeightMap') : getInt16ArrayField(tileValue, 'heightMap');
  if (!heightMap) {
    return null;
  }

  const source = getPrimitiveArraySource(heightMap);
  if (!source || source.length !== expectedLength) {
    return null;
  }

  // Also try to locate the water level buffer so it can be patched during export.
  let waterLevelDataOffset: number | undefined;
  let waterLevelDataLength: number | undefined;
  let waterLevelDataType: 'uint8-water' | 'int16-water' | undefined;

  if (tall) {
    const waterLevelBuffer = getInt16ArrayField(tileValue, 'tallWaterLevel');
    if (waterLevelBuffer) {
      const waterSource = getPrimitiveArraySource(waterLevelBuffer);
      if (waterSource && waterSource.length === expectedLength) {
        waterLevelDataOffset = waterSource.dataOffset;
        waterLevelDataLength = waterSource.length;
        waterLevelDataType = 'int16-water';
      }
    }
  } else {
    const waterLevelBuffer = getUint8ArrayField(tileValue, 'waterLevel');
    if (waterLevelBuffer) {
      const waterSource = getPrimitiveArraySource(waterLevelBuffer);
      if (waterSource && waterSource.length === expectedLength) {
        waterLevelDataOffset = waterSource.dataOffset;
        waterLevelDataLength = waterSource.length;
        waterLevelDataType = 'uint8-water';
      }
    }
  }

  return {
    format: 'worldpainter-world',
    heightDataOffset: source.dataOffset,
    heightDataLength: source.length,
    heightDataType: tall ? 'int32-height' : 'int16-height',
    minHeight,
    ...(waterLevelDataType !== undefined && {
      waterLevelDataOffset,
      waterLevelDataLength,
      waterLevelDataType,
    }),
  };
}

function extractTilePayload(pointValue: JavaValue, tileValue: JavaValue): WorldFileTilePayload | null {
  if (!isJavaObjectValue(tileValue)) {
    return null;
  }

  const coordinates = extractTileCoordinates(tileValue, pointValue);
  const minHeight = getNumberField(tileValue, 'minHeight');
  const tall = getBooleanField(tileValue, 'tall') ?? false;
  const terrainBuffer = getUint8ArrayField(tileValue, 'terrain');

  if (!coordinates || minHeight === null || !terrainBuffer) {
    return null;
  }

  const heights = new Int32Array(terrainBuffer.length);
  const waterLevels = new Int32Array(terrainBuffer.length);
  const terrain = new Uint8Array(terrainBuffer.length);

  if (tall) {
    const heightMap = getInt32ArrayField(tileValue, 'tallHeightMap');
    const waterLevel = getInt16ArrayField(tileValue, 'tallWaterLevel');
    if (!heightMap || !waterLevel || heightMap.length !== terrainBuffer.length || waterLevel.length !== terrainBuffer.length) {
      return null;
    }

    for (let index = 0; index < terrainBuffer.length; index += 1) {
      const height = Math.round(heightMap[index] / 256 + minHeight);
      const water = (waterLevel[index] & 0xffff) + minHeight;
      heights[index] = height;
      waterLevels[index] = water;
      terrain[index] = mapTerrainOrdinalToPreviewCode(terrainBuffer[index], height, water);
    }
  } else {
    const heightMap = getInt16ArrayField(tileValue, 'heightMap');
    const waterLevel = getUint8ArrayField(tileValue, 'waterLevel');
    if (!heightMap || !waterLevel || heightMap.length !== terrainBuffer.length || waterLevel.length !== terrainBuffer.length) {
      return null;
    }

    for (let index = 0; index < terrainBuffer.length; index += 1) {
      const height = Math.round((heightMap[index] & 0xffff) / 256 + minHeight);
      const water = waterLevel[index] + minHeight;
      heights[index] = height;
      waterLevels[index] = water;
      terrain[index] = mapTerrainOrdinalToPreviewCode(terrainBuffer[index], height, water);
    }
  }

  const valueLayerSummaries = extractLayerBufferSummaries(tileValue.fields.layerData ?? null, 'value');
  const bitLayerSummaries = extractLayerBufferSummaries(tileValue.fields.bitLayerData ?? null, 'bit');
  const seedSummaries = extractSeedSummaries(tileValue.fields.seeds ?? null);
  const sourcePatch = extractTileSourcePatch(tileValue, minHeight, tall, terrainBuffer.length);

  return {
    x: coordinates.x,
    y: coordinates.y,
    heights,
    waterLevels,
    terrain,
    layerSummaries: [...valueLayerSummaries, ...bitLayerSummaries],
    seedSummaries,
    sourcePatch,
  };
}

function extractTilePayloads(value: JavaValue): WorldFileTilePayload[] {
  if (!(value instanceof Map)) {
    return [];
  }

  return Array.from(value.entries())
    .map(([pointValue, tileValue]) => extractTilePayload(pointValue as JavaValue, tileValue))
    .filter((tile): tile is WorldFileTilePayload => tile !== null)
    .sort((left, right) => {
      if (left.y === right.y) {
        return left.x - right.x;
      }

      return left.y - right.y;
    });
}

function extractPlatformSummary(value: JavaValue): Pick<WorldFileWorldSummary, 'platformId' | 'platformName'> {
  if (!isJavaObjectValue(value)) {
    return {
      platformId: null,
      platformName: null,
    };
  }

  return {
    platformId: getStringField(value, 'id'),
    platformName: getStringField(value, 'displayName'),
  };
}

function extractDimensionSummary(value: JavaValue, anchorFallback: JavaValue): WorldFileDimensionSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  const anchor = extractAnchorSummary(value.fields.anchor ?? anchorFallback) ?? extractAnchorSummary(anchorFallback);
  const tiles = extractTilePayloads(value.fields.tiles ?? null);
  const layerSettings = extractLayerSettingSummaries(value.fields.layerSettings ?? null);
  const tileLayerSummaries = tiles.flatMap((tile) => tile.layerSummaries);
  const availableLayers = collectAvailableLayers(tileLayerSummaries, layerSettings);
  const tileLayerBufferCount = tileLayerSummaries.filter((summary) => summary.storage === 'value').length;
  const tileBitLayerBufferCount = tileLayerSummaries.filter((summary) => summary.storage === 'bit').length;
  const seedCount = tiles.reduce((count, tile) => count + tile.seedSummaries.length, 0);

  return {
    anchor,
    name: getStringField(value, 'name') ?? anchor?.defaultName ?? null,
    minHeight: getNumberField(value, 'minHeight'),
    maxHeight: getNumberField(value, 'maxHeight'),
    dimensionSeed: getNumberField(value, 'seed'),
    minecraftSeed: getNumberField(value, 'minecraftSeed'),
    minTileX: getNumberField(value, 'lowestX'),
    maxTileX: getNumberField(value, 'highestX'),
    minTileY: getNumberField(value, 'lowestY'),
    maxTileY: getNumberField(value, 'highestY'),
    tileCount: tiles.length > 0 ? tiles.length : extractTileCount(value.fields.tiles ?? null),
    layerSettings,
    availableLayers,
    tileLayerBufferCount,
    tileBitLayerBufferCount,
    seedCount,
    tiles,
  };
}

function compareDimensionSummary(left: WorldFileDimensionSummary, right: WorldFileDimensionSummary): number {
  const roleOrder = new Map<string, number>([
    ['DETAIL', 0],
    ['MASTER', 1],
    ['CAVE_FLOOR', 2],
    ['FLOATING_FLOOR', 3],
  ]);

  const leftAnchor = left.anchor;
  const rightAnchor = right.anchor;

  if (!leftAnchor && !rightAnchor) {
    return (left.name ?? '').localeCompare(right.name ?? '');
  }

  if (!leftAnchor) {
    return 1;
  }

  if (!rightAnchor) {
    return -1;
  }

  if (leftAnchor.dim !== rightAnchor.dim) {
    return leftAnchor.dim - rightAnchor.dim;
  }

  const leftRole = roleOrder.get(leftAnchor.role ?? '') ?? Number.MAX_SAFE_INTEGER;
  const rightRole = roleOrder.get(rightAnchor.role ?? '') ?? Number.MAX_SAFE_INTEGER;
  if (leftRole !== rightRole) {
    return leftRole - rightRole;
  }

  if (leftAnchor.invert !== rightAnchor.invert) {
    return Number(leftAnchor.invert) - Number(rightAnchor.invert);
  }

  if (leftAnchor.id !== rightAnchor.id) {
    return leftAnchor.id - rightAnchor.id;
  }

  return (left.name ?? '').localeCompare(right.name ?? '');
}

function extractWorldSummary(value: JavaValue): WorldFileWorldSummary | null {
  if (!isJavaObjectValue(value)) {
    return null;
  }

  const dimensionsByAnchor = value.fields.dimensionsByAnchor;
  const dimensions = dimensionsByAnchor instanceof Map
    ? Array.from(dimensionsByAnchor.entries())
      .map(([anchorValue, dimensionValue]) => extractDimensionSummary(dimensionValue, anchorValue as JavaValue))
      .filter((dimension): dimension is WorldFileDimensionSummary => dimension !== null)
      .sort(compareDimensionSummary)
    : [];

  const platform = extractPlatformSummary(value.fields.platform ?? null);

  return {
    name: getStringField(value, 'name'),
    minHeight: getNumberField(value, 'minHeight'),
    maxHeight: getNumberField(value, 'maxheight') ?? getNumberField(value, 'maxHeight'),
    spawnPoint: extractPointSummary(value.fields.spawnPoint ?? null),
    platformId: platform.platformId,
    platformName: platform.platformName,
    dimensions,
  };
}

function shouldSkipObjectField(ownerClassName: string, fieldName: string): boolean {
  if (ownerClassName === 'org.pepsoft.worldpainter.World2') {
    return !['name', 'spawnPoint', 'platform', 'dimensionsByAnchor'].includes(fieldName);
  }

  if (ownerClassName === 'org.pepsoft.worldpainter.Dimension') {
    return !['tiles', 'anchor', 'name', 'layerSettings'].includes(fieldName);
  }

  if (ownerClassName === 'org.pepsoft.worldpainter.Tile') {
    return !['heightMap', 'tallHeightMap', 'terrain', 'waterLevel', 'tallWaterLevel', 'layerData', 'bitLayerData', 'seeds'].includes(fieldName);
  }

  if (ownerClassName === 'org.pepsoft.worldpainter.Platform') {
    return !['id', 'displayName'].includes(fieldName);
  }

  if (ownerClassName === 'org.pepsoft.worldpainter.layers.Layer') {
    return !['id', 'name', 'dataSize'].includes(fieldName);
  }

  if (ownerClassName.startsWith('org.pepsoft.worldpainter.layers.')) {
    return true;
  }

  if (ownerClassName === 'org.pepsoft.worldpainter.gardenofeden.Seed') {
    return fieldName !== 'location';
  }

  if (ownerClassName.startsWith('org.pepsoft.worldpainter.gardenofeden.')) {
    return true;
  }

  if (ownerClassName.endsWith('ExporterSettings')) {
    return true;
  }

  return false;
}

function buildProbeNotes(
  metadata: WorldFileMetadata | null,
  worldRootClass: string | null,
  worldSummary: WorldFileWorldSummary | null,
): string[] {
  const notes = ['Recognized a GZIP-wrapped Java object stream, which matches the desktop WorldPainter container format.'];

  if (metadata?.wpVersion) {
    const versionLabel = metadata.wpBuild ? `${metadata.wpVersion} (${metadata.wpBuild})` : metadata.wpVersion;
    notes.push(`Metadata reports WorldPainter ${versionLabel}.`);
  }

  if (metadata?.plugins.length) {
    notes.push(`This file records ${metadata.plugins.length} non-standard plugin entries, so browser compatibility will need opaque preservation or plugin-specific adapters.`);
  }

  if (worldRootClass === 'org.pepsoft.worldpainter.World2') {
    notes.push('The serialized root object is World2, which is the current desktop project model.');
  } else if (worldRootClass === 'org.pepsoft.worldpainter.World') {
    notes.push('The serialized root object is the legacy World model; desktop WorldPainter migrates it to World2 while loading.');
  } else if (worldRootClass) {
    notes.push(`The serialized root object was detected as ${worldRootClass}.`);
  }

  if (worldSummary?.platformName || worldSummary?.platformId) {
    notes.push(`World summary extraction identified platform ${worldSummary.platformName ?? worldSummary.platformId}.`);
  }

  if (worldSummary?.dimensions.length) {
    notes.push(`World summary extraction identified ${worldSummary.dimensions.length} serialized dimension entries.`);
  }

  const importedTileCount = worldSummary?.dimensions.reduce((count, dimension) => count + dimension.tiles.length, 0) ?? 0;
  const importedLayerBufferCount = worldSummary?.dimensions.reduce(
    (count, dimension) => count + dimension.tileLayerBufferCount + dimension.tileBitLayerBufferCount,
    0,
  ) ?? 0;
  const importedSeedCount = worldSummary?.dimensions.reduce((count, dimension) => count + dimension.seedCount, 0) ?? 0;
  const importedLayerSettingCount = worldSummary?.dimensions.reduce((count, dimension) => count + dimension.layerSettings.length, 0) ?? 0;
  const patchableTileCount = worldSummary?.dimensions.reduce(
    (count, dimension) => count + dimension.tiles.filter((tile) => tile.sourcePatch !== null).length,
    0,
  ) ?? 0;
  if (importedTileCount > 0) {
    notes.push(`Core tile payload extraction decoded ${importedTileCount} tiles into browser-native height, water, and preview terrain buffers.`);
  }

  if ((importedLayerBufferCount > 0) || (importedSeedCount > 0) || (importedLayerSettingCount > 0)) {
    notes.push(
      `Semantic import preserved ${importedLayerSettingCount} layer setting entries, ${importedLayerBufferCount} tile layer buffers, and ${importedSeedCount} garden seeds as browser-readable compatibility metadata.`,
    );
  }

  if (patchableTileCount > 0) {
    notes.push(`The browser also retained original serialized height-map offsets for ${patchableTileCount} decoded tiles, which enables a first-pass patched .world save path for elevation edits.`);
  }

  notes.push('Browser-side compatibility currently covers container validation, World2 metadata, dimension bounds, core tile height/water import, semantic summaries for layers and seeds, and preservation of raw source bytes for future round-trip patching. Layer-aware save, plugin payload interpretation, and Minecraft export remain incomplete.');

  return notes;
}

function toIsoTimestamp(value: number): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

class JavaObjectStreamParser {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;
  private nextHandle = BASE_WIRE_HANDLE;
  private readonly objectStack: string[] = [];
  private currentFieldContext: string | null = null;
  private readonly handles = new Map<number, unknown>();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  readWorldFileHeader(): WorldFileHeader {
    this.expectStreamHeader();
    const metadata = this.readContent();
    const worldValue = this.readContent();

    return {
      metadata,
      worldRootClass: isJavaObjectValue(worldValue) ? worldValue.className : null,
      worldSummary: extractWorldSummary(worldValue),
    };
  }

  private expectStreamHeader(): void {
    const header = [this.readUnsignedByte(), this.readUnsignedByte(), this.readUnsignedByte(), this.readUnsignedByte()];

    if (!JAVA_STREAM_HEADER.every((value, index) => header[index] === value)) {
      throw new Error('Not a Java serialization stream header.');
    }
  }

  private readContent(hint?: ReadHint): JavaValue {
    const token = this.readUnsignedByte();
    return this.readContentByToken(token, hint);
  }

  private readContentByToken(token: number, hint?: ReadHint): JavaValue {
    switch (token) {
      case TokenCode.Null:
        return null;
      case TokenCode.Reference:
        return this.readReference() as JavaValue;
      case TokenCode.String:
        return this.readNewString();
      case TokenCode.LongString:
        return this.readNewLongString();
      case TokenCode.Object:
        return this.readNewObject(hint);
      case TokenCode.Array:
        return this.readNewArray();
      case TokenCode.Class:
        return this.readNewClass();
      case TokenCode.BlockData:
        return this.readBlockData(this.readUnsignedByte());
      case TokenCode.BlockDataLong:
        return this.readBlockData(this.readInt());
      case TokenCode.Reset:
        this.handles.clear();
        return this.readContent(hint);
      case TokenCode.Enum:
        return this.readNewEnum();
      default:
        throw new Error(`Unsupported Java serialization token 0x${token.toString(16)} at offset ${this.offset - 1}${this.describeContext()}.`);
    }
  }

  private readReference(): unknown {
    const handle = this.readInt();
    if (!this.handles.has(handle)) {
      throw new Error(`Missing handle reference 0x${handle.toString(16)}.`);
    }

    return this.handles.get(handle);
  }

  private readNewString(): string {
    const value = this.readUtf(this.readUnsignedShort());
    this.registerHandle(value);
    return value;
  }

  private readNewLongString(): string {
    const length = this.readLongAsNumber();
    const value = this.readUtf(length);
    this.registerHandle(value);
    return value;
  }

  private readNewObject(hint?: ReadHint): JavaValue {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Object token without class descriptor.');
    }

    const placeholder: JavaObjectValue = {
      kind: 'object',
      className: classDesc.name,
      fields: {},
      annotations: [],
    };
    const handle = this.registerHandle(placeholder);
    this.objectStack.push(classDesc.name);

    try {
      const hierarchy = this.collectHierarchy(classDesc);
      for (const currentClass of hierarchy) {
        Object.assign(placeholder.fields, this.readFieldValues(currentClass.name, currentClass.fields));

        if (currentClass.flags & ClassDescFlag.Externalizable) {
          if ((currentClass.flags & ClassDescFlag.BlockData) === 0) {
            throw new Error(`Externalizable class ${currentClass.name} without block data is not supported.`);
          }

          placeholder.annotations.push(...this.readAnnotations());
          continue;
        }

        if (currentClass.flags & ClassDescFlag.WriteMethod) {
          if (currentClass.name === 'java.util.HashMap') {
            const mapValue = this.readHashMapEntries(
              hint === 'dimensions-map'
                ? 'dimension-value'
                : hint === 'tile-map'
                  ? 'tile-value'
                  : undefined,
            );
            this.handles.set(handle, mapValue);
            return mapValue;
          }

          if ((currentClass.name === 'java.util.HashSet') || (currentClass.name === 'java.util.LinkedHashSet')) {
            const setValue = this.readHashSetEntries();
            this.handles.set(handle, setValue);
            return setValue;
          }

          placeholder.annotations.push(...this.readAnnotations());
        }
      }

      if (classDesc.name === 'java.util.Date') {
        const fastTime = placeholder.fields.fastTime;
        if (typeof fastTime === 'number') {
          const iso = toIsoTimestamp(fastTime);
          if (iso) {
            this.handles.set(handle, iso);
            return iso;
          }
        }
      }

      return placeholder;
    } finally {
      this.objectStack.pop();
    }
  }

  private readNewArray(): JavaValue[] | Uint8Array | Int16Array | Int32Array {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Array token without class descriptor.');
    }

    const length = this.readInt();
    const typeName = classDesc.name;
    const dataOffset = this.offset;

    if (typeName === '[B') {
      const data = new Uint8Array(this.bytes.buffer, this.bytes.byteOffset + this.offset, length).slice();
      this.offset += length;
      rememberPrimitiveArraySource(data, { typeName, dataOffset, length });
      this.registerHandle(data);
      return data;
    }

    const values: JavaValue[] = new Array(length);
    const handle = this.registerHandle(values);

    if (typeName === '[I') {
      const data = new Int32Array(length);
      for (let index = 0; index < length; index += 1) {
        data[index] = this.readInt();
      }
      rememberPrimitiveArraySource(data, { typeName, dataOffset, length });
      this.handles.set(handle, data);
      return data;
    }

    if (typeName === '[S') {
      const data = new Int16Array(length);
      for (let index = 0; index < length; index += 1) {
        data[index] = this.readShort();
      }
      rememberPrimitiveArraySource(data, { typeName, dataOffset, length });
      this.handles.set(handle, data);
      return data;
    }

    if (typeName === '[J') {
      for (let index = 0; index < length; index += 1) {
        values[index] = this.readLongAsNumber();
      }
      return values;
    }

    if (typeName === '[Z') {
      for (let index = 0; index < length; index += 1) {
        values[index] = this.readUnsignedByte() !== 0;
      }
      return values;
    }

    for (let index = 0; index < length; index += 1) {
      values[index] = this.readContent();
    }

    this.handles.set(handle, values);
    return values;
  }

  private readNewEnum(): JavaValue {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Enum token without class descriptor.');
    }

    const handle = this.registerHandle(null);
    const constantName = this.readContent();
    const value = typeof constantName === 'string' ? constantName : null;
    this.handles.set(handle, value);
    return value;
  }

  private readNewClass(): JavaValue {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Class token without class descriptor.');
    }

    const value = classDesc.name;
    this.registerHandle(value);
    return value;
  }

  private readClassDesc(): JavaClassDesc | null {
    const token = this.readUnsignedByte();

    if (token === TokenCode.Null) {
      return null;
    }

    if (token === TokenCode.Reference) {
      return this.readReference() as JavaClassDesc;
    }

    if (token === TokenCode.ClassDesc) {
      return this.readNewClassDesc();
    }

    if (token === TokenCode.ProxyClassDesc) {
      throw new Error('Proxy class descriptors are not supported by the world probe.');
    }

    throw new Error(`Unexpected class descriptor token 0x${token.toString(16)}.`);
  }

  private readNewClassDesc(): JavaClassDesc {
    const name = this.readUtf(this.readUnsignedShort());
    this.offset += 8;
    const flags = this.readUnsignedByte();
    const fieldCount = this.readUnsignedShort();
    const fields: JavaFieldDesc[] = [];

    const placeholder: JavaClassDesc = {
      name,
      flags,
      fields,
      superClass: null,
    };
    this.registerHandle(placeholder);

    for (let index = 0; index < fieldCount; index += 1) {
      const typeCode = String.fromCharCode(this.readUnsignedByte());
      const fieldName = this.readUtf(this.readUnsignedShort());

      if (typeCode === 'L' || typeCode === '[') {
        this.readContent();
      }

      fields.push({
        typeCode,
        name: fieldName,
      });
    }

    this.readAnnotations();
    placeholder.superClass = this.readClassDesc();

    return placeholder;
  }

  private readFieldValues(ownerClassName: string, fields: JavaFieldDesc[]): Record<string, JavaValue> {
    const values: Record<string, JavaValue> = {};

    for (const field of fields) {
      values[field.name] = this.readFieldValue(ownerClassName, field);
    }

    return values;
  }

  private readFieldValue(ownerClassName: string, field: JavaFieldDesc): JavaValue {
    this.currentFieldContext = `${ownerClassName}.${field.name}`;

    try {
      switch (field.typeCode) {
        case 'B':
          return this.readSignedByte();
        case 'C':
          return String.fromCharCode(this.readUnsignedShort());
        case 'D':
          return this.readDouble();
        case 'F':
          return this.readFloat();
        case 'I':
          return this.readInt();
        case 'J':
          return this.readLongAsNumber();
        case 'S':
          return this.readShort();
        case 'Z':
          return this.readUnsignedByte() !== 0;
        case 'L':
        case '[':
          if (ownerClassName === 'org.pepsoft.worldpainter.World2' && field.name === 'dimensionsByAnchor') {
            return this.readContent('dimensions-map');
          }

          if (ownerClassName === 'org.pepsoft.worldpainter.Dimension' && field.name === 'tiles') {
            return this.readContent('tile-map');
          }

          if (shouldSkipObjectField(ownerClassName, field.name)) {
            this.skipContent();
            return null;
          }

          return this.readContent();
        default:
          throw new Error(`Unsupported field type ${field.typeCode}.`);
      }
    } finally {
      this.currentFieldContext = null;
    }
  }

  private describeContext(): string {
    const parts: string[] = [];

    if (this.objectStack.length > 0) {
      parts.push(`object stack ${this.objectStack.join(' > ')}`);
    }

    if (this.currentFieldContext) {
      parts.push(`field ${this.currentFieldContext}`);
    }

    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
  }

  private readHashMapEntries(valueHint?: ReadHint): JavaMapValue {
    const map: JavaMapValue = new Map();
    let pendingKey: JavaValue | undefined;

    while (true) {
      const token = this.readUnsignedByte();
      if (token === TokenCode.EndBlockData) {
        return map;
      }

      if (token === TokenCode.BlockData) {
        this.readBlockData(this.readUnsignedByte());
        continue;
      }

      if (token === TokenCode.BlockDataLong) {
        this.readBlockData(this.readInt());
        continue;
      }

      const value = this.readContentByToken(token, pendingKey === undefined ? undefined : valueHint);
      if (pendingKey === undefined) {
        pendingKey = value;
      } else {
        map.set(pendingKey, value);
        pendingKey = undefined;
      }
    }
  }

  private readHashSetEntries(): JavaValue[] {
    const values: JavaValue[] = [];

    while (true) {
      const token = this.readUnsignedByte();
      if (token === TokenCode.EndBlockData) {
        return values;
      }

      if (token === TokenCode.BlockData) {
        this.readBlockData(this.readUnsignedByte());
        continue;
      }

      if (token === TokenCode.BlockDataLong) {
        this.readBlockData(this.readInt());
        continue;
      }

      values.push(this.readContentByToken(token));
    }
  }

  private readAnnotations(): JavaValue[] {
    const values: JavaValue[] = [];

    while (true) {
      const token = this.readUnsignedByte();
      if (token === TokenCode.EndBlockData) {
        return values;
      }

      values.push(this.readContentByToken(token));
    }
  }

  private skipContent(): void {
    const token = this.readUnsignedByte();
    this.skipContentByToken(token);
  }

  private skipContentByToken(token: number): void {
    switch (token) {
      case TokenCode.Null:
        return;
      case TokenCode.Reference:
        this.readInt();
        return;
      case TokenCode.String:
        this.readNewString();
        return;
      case TokenCode.LongString:
        this.readNewLongString();
        return;
      case TokenCode.Object:
        this.skipNewObject();
        return;
      case TokenCode.Array:
        this.skipNewArray();
        return;
      case TokenCode.Class:
        this.readNewClass();
        return;
      case TokenCode.BlockData:
        this.readBlockData(this.readUnsignedByte());
        return;
      case TokenCode.BlockDataLong:
        this.readBlockData(this.readInt());
        return;
      case TokenCode.Reset:
        this.handles.clear();
        this.skipContent();
        return;
      case TokenCode.Enum:
        this.skipNewEnum();
        return;
      default:
        throw new Error(`Unsupported Java serialization token 0x${token.toString(16)} while skipping content.`);
    }
  }

  private skipNewObject(): void {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Object token without class descriptor while skipping content.');
    }

    this.registerHandle({ skippedClassName: classDesc.name });
    this.objectStack.push(`skip:${classDesc.name}`);

    try {
      const hierarchy = this.collectHierarchy(classDesc);
      for (const currentClass of hierarchy) {
        for (const field of currentClass.fields) {
          this.skipFieldValue(field.typeCode);
        }

        if (currentClass.flags & ClassDescFlag.Externalizable) {
          if ((currentClass.flags & ClassDescFlag.BlockData) === 0) {
            throw new Error(`Externalizable class ${currentClass.name} without block data is not supported while skipping content.`);
          }

          this.skipAnnotations();
          continue;
        }

        if (currentClass.flags & ClassDescFlag.WriteMethod) {
          this.skipAnnotations();
        }
      }
    } finally {
      this.objectStack.pop();
    }
  }

  private skipNewArray(): void {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Array token without class descriptor while skipping content.');
    }

    const length = this.readInt();
    this.registerHandle({ skippedArrayClassName: classDesc.name, length });

    switch (classDesc.name) {
      case '[B':
      case '[Z':
        this.offset += length;
        return;
      case '[C':
      case '[S':
        this.offset += length * 2;
        return;
      case '[I':
      case '[F':
        this.offset += length * 4;
        return;
      case '[J':
      case '[D':
        this.offset += length * 8;
        return;
      default:
        for (let index = 0; index < length; index += 1) {
          this.skipContent();
        }
    }
  }

  private skipNewEnum(): void {
    const classDesc = this.readClassDesc();
    if (!classDesc) {
      throw new Error('Enum token without class descriptor while skipping content.');
    }

    this.registerHandle({ skippedEnumClassName: classDesc.name });
    this.skipContent();
  }

  private skipFieldValue(typeCode: string): void {
    switch (typeCode) {
      case 'B':
      case 'Z':
        this.offset += 1;
        return;
      case 'C':
      case 'S':
        this.offset += 2;
        return;
      case 'I':
      case 'F':
        this.offset += 4;
        return;
      case 'J':
      case 'D':
        this.offset += 8;
        return;
      case 'L':
      case '[':
        this.skipContent();
        return;
      default:
        throw new Error(`Unsupported field type ${typeCode} while skipping content.`);
    }
  }

  private skipAnnotations(): void {
    while (true) {
      const token = this.readUnsignedByte();
      if (token === TokenCode.EndBlockData) {
        return;
      }

      this.skipContentByToken(token);
    }
  }

  private collectHierarchy(classDesc: JavaClassDesc): JavaClassDesc[] {
    const hierarchy: JavaClassDesc[] = [];
    let current: JavaClassDesc | null = classDesc;

    while (current) {
      hierarchy.unshift(current);
      current = current.superClass;
    }

    return hierarchy.filter((entry) => (
      (entry.flags & ClassDescFlag.Serializable) !== 0
      || (entry.flags & ClassDescFlag.WriteMethod) !== 0
      || (entry.flags & ClassDescFlag.Externalizable) !== 0
    ));
  }

  private readBlockData(length: number): Uint8Array {
    const chunk = new Uint8Array(this.bytes.buffer, this.bytes.byteOffset + this.offset, length).slice();
    this.offset += length;
    return chunk;
  }

  private registerHandle<T>(value: T): number {
    const handle = this.nextHandle;
    this.handles.set(handle, value);
    this.nextHandle += 1;
    return handle;
  }

  private readUtf(length: number): string {
    const value = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  private readUnsignedByte(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  private readSignedByte(): number {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUnsignedShort(): number {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readShort(): number {
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  private readInt(): number {
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readFloat(): number {
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  private readDouble(): number {
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return value;
  }

  private readLongAsNumber(): number {
    const value = Number(this.view.getBigInt64(this.offset, false));
    this.offset += 8;
    return value;
  }
}

export async function probeWorldFile(file: File): Promise<WorldFileProbeResult> {
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  if (!startsWithBytes(fileBytes, GZIP_MAGIC)) {
    return {
      fileName: file.name,
      fileSize: file.size,
      compression: 'unknown',
      serialization: 'unknown',
      status: 'unsupported',
      worldRootClass: null,
      metadata: null,
      worldSummary: null,
      importSource: null,
      notes: ['This file does not start with the GZIP magic bytes expected by WorldPainter .world files.'],
    };
  }

  let decompressed: Uint8Array;
  try {
    decompressed = gunzipSync(fileBytes);
  } catch (error) {
    return {
      fileName: file.name,
      fileSize: file.size,
      compression: 'gzip',
      serialization: 'unknown',
      status: 'unsupported',
      worldRootClass: null,
      metadata: null,
      worldSummary: null,
      importSource: null,
      notes: [error instanceof Error ? error.message : 'Failed to decompress the GZIP stream.'],
    };
  }

  if (!startsWithBytes(decompressed, JAVA_STREAM_HEADER)) {
    return {
      fileName: file.name,
      fileSize: file.size,
      compression: 'gzip',
      serialization: 'unknown',
      status: 'unsupported',
      worldRootClass: null,
      metadata: null,
      worldSummary: null,
      importSource: null,
      notes: ['The file is GZIP-compressed, but the decompressed payload does not start with a Java object stream header.'],
    };
  }

  const importSource: ImportedWorldFileSource = {
    format: 'worldpainter-world',
    fileName: file.name,
    fileSize: file.size,
    serializedBytes: decompressed.slice(),
  };

  try {
    const parser = new JavaObjectStreamParser(decompressed);
    const { metadata: metadataValue, worldRootClass, worldSummary } = parser.readWorldFileHeader();
    const metadata = normalizeMetadata(metadataValue);

    return {
      fileName: file.name,
      fileSize: file.size,
      compression: 'gzip',
      serialization: 'java-object-stream',
      status: worldRootClass ? 'recognized' : 'partial',
      worldRootClass,
      metadata,
      worldSummary,
      importSource,
      notes: buildProbeNotes(metadata, worldRootClass, worldSummary),
    };
  } catch (error) {
    return {
      fileName: file.name,
      fileSize: file.size,
      compression: 'gzip',
      serialization: 'java-object-stream',
      status: 'partial',
      worldRootClass: null,
      metadata: null,
      worldSummary: null,
      importSource,
      notes: [
        'The file looks like a WorldPainter Java object stream, but metadata parsing only completed partially.',
        error instanceof Error ? error.message : 'Unknown Java serialization parsing error.',
      ],
    };
  }
}
