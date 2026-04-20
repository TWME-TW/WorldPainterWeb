/// <reference lib="webworker" />

import { TERRAIN_COLOUR_MAP } from '../model/terrainMetadata';
import type {
  TileRenderWorkerRequest,
  TileRenderWorkerResponse,
} from './renderTypes';

// Fallback colour (grass green) for any terrain code not in the map
const FALLBACK_COLOUR: [number, number, number] = [88, 130, 78];

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function renderTile(request: TileRenderWorkerRequest): TileRenderWorkerResponse {
  const { tileSize, heights, waterLevels, terrain, tileKey } = request.payload;
  const rgba = new Uint8ClampedArray(tileSize * tileSize * 4);

  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      const index = x + y * tileSize;
      const pixelIndex = index * 4;
      const baseHeight = heights[index];
      const leftHeight = heights[(x > 0 ? x - 1 : x) + y * tileSize];
      const topHeight = heights[x + (y > 0 ? y - 1 : y) * tileSize];
      const slope = baseHeight - (leftHeight + topHeight) / 2;
      const brightness = 1 + slope * 0.04 + (baseHeight - 64) * 0.004;
      const colour = TERRAIN_COLOUR_MAP.get(terrain[index]) ?? FALLBACK_COLOUR;
      const hasWater = waterLevels[index] > baseHeight;

      let red = colour[0] * brightness;
      let green = colour[1] * brightness;
      let blue = colour[2] * brightness;

      if (hasWater) {
        // Depth-based water visualization: deeper water is darker and more saturated.
        const waterDepth = Math.min(waterLevels[index] - baseHeight, 20);
        const depthFactor = waterDepth / 20; // 0 = shallow, 1 = deep
        const opacity = 0.34 + depthFactor * 0.48;
        red = red * (1 - opacity) + 28 * opacity;
        green = green * (1 - opacity) + 94 * opacity;
        blue = blue * (1 - opacity) + 200 * opacity;
      }

      rgba[pixelIndex] = clampByte(red);
      rgba[pixelIndex + 1] = clampByte(green);
      rgba[pixelIndex + 2] = clampByte(blue);
      rgba[pixelIndex + 3] = 255;
    }
  }

  return {
    requestId: request.requestId,
    type: 'render-success',
    payload: {
      tileKey,
      width: tileSize,
      height: tileSize,
      rgbaBuffer: rgba.buffer,
    },
  };
}

self.onmessage = (event: MessageEvent<TileRenderWorkerRequest>) => {
  try {
    const response = renderTile(event.data);
    self.postMessage(response, [response.type === 'render-success' ? response.payload.rgbaBuffer : new ArrayBuffer(0)].filter(Boolean));
  } catch (error) {
    const failure: TileRenderWorkerResponse = {
      requestId: event.data.requestId,
      type: 'render-failure',
      message: error instanceof Error ? error.message : 'Unknown tile render error',
    };

    self.postMessage(failure);
  }
};

export {};