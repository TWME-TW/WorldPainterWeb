/**
 * Terrain metadata for WorldPainterWeb.
 *
 * Code values match WorldPainter's Terrain enum ordinals to ensure
 * correct round-trip compatibility with .world files.
 * The rendering colors approximate the Dynmap "default" colour scheme.
 */
export interface TerrainMeta {
  code: number;
  label: string;
  /** CSS color string for the terrain swatch / renderer */
  color: string;
  /** Whether this terrain is deprecated / legacy */
  deprecated?: boolean;
}

export const TERRAIN_METADATA: TerrainMeta[] = [
  // ordinal 0
  { code: 0,  label: 'Grass',              color: '#5e9e47' },
  // ordinal 1
  { code: 1,  label: 'Dirt',               color: '#9c7043' },
  // ordinal 2
  { code: 2,  label: 'Sand',               color: '#d4c07a' },
  // ordinal 3
  { code: 3,  label: 'Sandstone',          color: '#d4b86e' },
  // ordinal 4
  { code: 4,  label: 'Stone',              color: '#7a7670' },
  // ordinal 5
  { code: 5,  label: 'Rock',               color: '#6b6860' },
  // ordinal 6
  { code: 6,  label: 'Water',              color: '#3670aa' },
  // ordinal 7
  { code: 7,  label: 'Lava',               color: '#cc4400' },
  // ordinal 8 (deprecated)
  { code: 8,  label: 'Snow on Rock',       color: '#d0dde0', deprecated: true },
  // ordinal 9
  { code: 9,  label: 'Deep Snow',          color: '#ebf0f2' },
  // ordinal 10
  { code: 10, label: 'Gravel',             color: '#8a8880' },
  // ordinal 11
  { code: 11, label: 'Clay',               color: '#959da8' },
  // ordinal 12
  { code: 12, label: 'Cobblestone',        color: '#6e6e68' },
  // ordinal 13
  { code: 13, label: 'Mossy Cobblestone',  color: '#5a6a50' },
  // ordinal 14
  { code: 14, label: 'Netherrack',         color: '#7a2525' },
  // ordinal 15
  { code: 15, label: 'Soul Sand',          color: '#6a5035' },
  // ordinal 16
  { code: 16, label: 'Obsidian',           color: '#1a1030' },
  // ordinal 17
  { code: 17, label: 'Bedrock',            color: '#3a3838' },
  // ordinal 18
  { code: 18, label: 'Desert',             color: '#c8b562' },
  // ordinal 19 (Netherlike)
  { code: 19, label: 'Netherlike',         color: '#8a3020' },
  // ordinal 20 (Resources)
  { code: 20, label: 'Resources',          color: '#6a6a6a' },
  // ordinal 21 (Beaches)
  { code: 21, label: 'Beaches',            color: '#b8a858' },
  // ordinal 22
  { code: 22, label: 'Mycelium',           color: '#8a6e8a' },
  // ordinal 23
  { code: 23, label: 'End Stone',          color: '#d4d08a' },
  // ordinal 24
  { code: 24, label: 'Bare Grass',         color: '#4e8c3c' },
  // ordinal 25
  { code: 25, label: 'Coarse Dirt',        color: '#7a5830' },
  // ordinal 26
  { code: 26, label: 'Podzol',             color: '#6a4a28' },
  // ordinal 27
  { code: 27, label: 'Red Sand',           color: '#b85a28' },
  // ordinal 28
  { code: 28, label: 'Terracotta',         color: '#9a5a3a' },
  // ordinal 29–44 stained terracotta
  { code: 29, label: 'White Terracotta',   color: '#d5c8b0' },
  { code: 30, label: 'Orange Terracotta',  color: '#a85030' },
  { code: 31, label: 'Magenta Terracotta', color: '#9a4a8a' },
  { code: 32, label: 'Lt Blue Terracotta', color: '#607898' },
  { code: 33, label: 'Yellow Terracotta',  color: '#b89030' },
  { code: 34, label: 'Lime Terracotta',    color: '#607840' },
  { code: 35, label: 'Pink Terracotta',    color: '#a87070' },
  { code: 36, label: 'Grey Terracotta',    color: '#4a4840' },
  { code: 37, label: 'Lt Grey Terracotta', color: '#8a8880' },
  { code: 38, label: 'Cyan Terracotta',    color: '#487880' },
  { code: 39, label: 'Purple Terracotta',  color: '#604880' },
  { code: 40, label: 'Blue Terracotta',    color: '#384870' },
  { code: 41, label: 'Brown Terracotta',   color: '#604830' },
  { code: 42, label: 'Green Terracotta',   color: '#485030' },
  { code: 43, label: 'Red Terracotta',     color: '#803030' },
  { code: 44, label: 'Black Terracotta',   color: '#202020' },
  // ordinal 45
  { code: 45, label: 'Mesa',               color: '#a05030' },
  // ordinal 46
  { code: 46, label: 'Red Desert',         color: '#b04820' },
  // ordinal 47
  { code: 47, label: 'Red Sandstone',      color: '#a84e28' },
  // ordinal 48
  { code: 48, label: 'Granite',            color: '#9a6858' },
  // ordinal 49
  { code: 49, label: 'Diorite',            color: '#c0baba' },
  // ordinal 50
  { code: 50, label: 'Andesite',           color: '#7a7878' },
];

/** Build a fast lookup map: terrain code → color as [R, G, B] */
export const TERRAIN_COLOUR_MAP: Map<number, [number, number, number]> = new Map(
  TERRAIN_METADATA.map(({ code, color }) => {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return [code, [r, g, b]];
  }),
);
