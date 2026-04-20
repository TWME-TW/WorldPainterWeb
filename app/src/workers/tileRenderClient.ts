import type { TileState } from '../model/types';
import type {
  RenderTileResult,
  TileRenderWorkerRequest,
  TileRenderWorkerResponse,
} from './renderTypes';

export class TileRenderClient {
  private readonly worker: Worker;

  private nextRequestId = 1;

  private readonly pending = new Map<
    number,
    {
      resolve: (value: RenderTileResult) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor() {
    this.worker = new Worker(new URL('./tileRender.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (event: MessageEvent<TileRenderWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        return;
      }

      this.pending.delete(response.requestId);

      if (response.type === 'render-success') {
        pending.resolve(response.payload);
      } else {
        pending.reject(new Error(response.message));
      }
    };
  }

  renderTile(tileKey: string, tile: TileState, tileSize: number): Promise<RenderTileResult> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const request: TileRenderWorkerRequest = {
      requestId,
      type: 'render-tile',
      payload: {
        tileKey,
        tileSize,
        heights: tile.heights,
        waterLevels: tile.waterLevels,
        terrain: tile.terrain,
      },
    };

    return new Promise<RenderTileResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(new Error('Tile render worker disposed')));
    this.pending.clear();
  }
}