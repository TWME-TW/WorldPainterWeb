import type { ProjectState } from '../model/types';

const DB_NAME = 'worldpainterweb';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const META_STORE = 'meta';
const LAST_PROJECT_ID_KEY = 'last-project-id';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveProjectSnapshot(project: ProjectState): Promise<string> {
  const database = await openDatabase();
  const transaction = database.transaction([PROJECT_STORE, META_STORE], 'readwrite');

  const savedAt = new Date().toISOString();
  const storedProject = {
    ...project,
    updatedAt: savedAt,
  };

  transaction.objectStore(PROJECT_STORE).put(storedProject);
  transaction.objectStore(META_STORE).put(project.id, LAST_PROJECT_ID_KEY);

  await waitForTransaction(transaction);
  database.close();

  return savedAt;
}

export async function loadProject(projectId: string): Promise<ProjectState | null> {
  const database = await openDatabase();
  const transaction = database.transaction(PROJECT_STORE, 'readonly');
  const request = transaction.objectStore(PROJECT_STORE).get(projectId);

  const project = await new Promise<ProjectState | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as ProjectState | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return project;
}

export async function loadLastProject(): Promise<ProjectState | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const request = transaction.objectStore(META_STORE).get(LAST_PROJECT_ID_KEY);

  const projectId = await new Promise<string | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });

  database.close();

  if (!projectId) {
    return null;
  }

  return loadProject(projectId);
}