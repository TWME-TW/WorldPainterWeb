export interface RenderTilePayload {
  tileKey: string;
  tileSize: number;
  heights: Int32Array;
  waterLevels: Int32Array;
  terrain: Uint8Array;
}

export interface RenderTileResult {
  tileKey: string;
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer;
}

export interface TileRenderWorkerRequest {
  requestId: number;
  type: 'render-tile';
  payload: RenderTilePayload;
}

export interface TileRenderWorkerSuccess {
  requestId: number;
  type: 'render-success';
  payload: RenderTileResult;
}

export interface TileRenderWorkerFailure {
  requestId: number;
  type: 'render-failure';
  message: string;
}

export type TileRenderWorkerResponse = TileRenderWorkerSuccess | TileRenderWorkerFailure;