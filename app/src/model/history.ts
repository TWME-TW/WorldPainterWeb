import type { ProjectState, TileState } from './types.ts';

export const MAX_HISTORY_SIZE = 50;

/**
 * Captures the before/after tile states for a single brush mutation
 * so that undo and redo can replay or reverse the change.
 */
export interface HistoryEntry {
  dimensionId: string;
  tilesBefore: Record<string, TileState>;
  tilesAfter: Record<string, TileState>;
}

function mergeTiles(project: ProjectState, dimensionId: string, tiles: Record<string, TileState>): ProjectState {
  const dimension = project.dimensions[dimensionId];
  if (!dimension) {
    return project;
  }

  return {
    ...project,
    updatedAt: new Date().toISOString(),
    dimensions: {
      ...project.dimensions,
      [dimensionId]: {
        ...dimension,
        tiles: {
          ...dimension.tiles,
          ...tiles,
        },
      },
    },
  };
}

export function applyUndoEntry(project: ProjectState, entry: HistoryEntry): ProjectState {
  return mergeTiles(project, entry.dimensionId, entry.tilesBefore);
}

export function applyRedoEntry(project: ProjectState, entry: HistoryEntry): ProjectState {
  return mergeTiles(project, entry.dimensionId, entry.tilesAfter);
}
