import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { exportMinecraftWorld } from '../src/export/minecraftExport.ts';
import { exportPatchedWorldFile } from '../src/export/worldFileExport.ts';
import { createImportedProject } from '../src/import/createImportedProject.ts';
import { probeWorldFile } from '../src/import/worldFileProbe.ts';
import { applyHeightBrushToProject, type BrushSettings } from '../src/model/editing.ts';
import type { DimensionState } from '../src/model/types.ts';

interface FixtureProbeExpectation {
  status: 'recognized' | 'partial' | 'unsupported';
  worldRootClass: string | null;
  metadata?: {
    name?: string | null;
    wpVersion?: string | null;
    wpBuild?: string | null;
    pluginCount?: number;
  };
  worldSummary?: {
    name?: string | null;
    minHeight?: number | null;
    maxHeight?: number | null;
    platformId?: string | null;
    platformName?: string | null;
    spawnPoint?: {
      x?: number;
      y?: number;
    };
    dimensionCount?: number;
    dimensions?: Array<{
      name?: string | null;
      minHeight?: number | null;
      maxHeight?: number | null;
      dimensionSeed?: number | null;
      minecraftSeed?: number | null;
      minTileX?: number | null;
      maxTileX?: number | null;
      minTileY?: number | null;
      maxTileY?: number | null;
      tileCount?: number | null;
      decodedTileCount?: number;
      layerSettingCount?: number;
      availableLayerCount?: number;
      availableLayers?: Array<{
        name?: string | null;
        id?: string | null;
        dataSize?: string;
      }>;
      tileLayerBufferCount?: number;
      tileBitLayerBufferCount?: number;
      seedCount?: number;
      anchor?: {
        dim?: number;
        role?: string | null;
        invert?: boolean;
        id?: number;
        defaultName?: string;
      };
    }>;
  };
}

interface FixtureManifestEntry {
  id: string;
  path: string;
  sourceFormat: string;
  probeExpectation?: FixtureProbeExpectation;
  importExpectation?: {
    source?: 'demo' | 'draft' | 'worldpainter-world';
    readSupport?: 'planned' | 'partial' | 'full';
    writeSupport?: 'planned' | 'partial' | 'full';
    exportSupport?: 'planned' | 'partial' | 'full';
    dimensionCount?: number;
    activeDimension?: {
      name?: string;
      tileSize?: number;
      minTileX?: number;
      maxTileX?: number;
      minTileY?: number;
      maxTileY?: number;
      loadedTileCount?: number;
      importMetadata?: {
        dimensionSeed?: number | null;
        minecraftSeed?: number | null;
        layerSettingCount?: number;
        availableLayerCount?: number;
        tileLayerBufferCount?: number;
        tileBitLayerBufferCount?: number;
        seedCount?: number;
      };
    };
  };
  saveExpectation?: {
    kind: 'height-patch-roundtrip';
    worldX: number;
    worldY: number;
    brush: BrushSettings;
  };
  mcExportExpectation?: {
    regionCount: number;
    chunkCount: number;
  };
}

interface FixtureManifest {
  schemaVersion: number;
  fixtures: FixtureManifestEntry[];
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function getHeightAtWorldCell(dimension: DimensionState, worldX: number, worldY: number): number | null {
  const tileX = Math.floor(worldX / dimension.tileSize);
  const tileY = Math.floor(worldY / dimension.tileSize);
  const tile = dimension.tiles[`${tileX},${tileY}`];
  if (!tile) {
    return null;
  }

  const localX = ((worldX % dimension.tileSize) + dimension.tileSize) % dimension.tileSize;
  const localY = ((worldY % dimension.tileSize) + dimension.tileSize) % dimension.tileSize;
  const index = localX + localY * dimension.tileSize;

  return tile.heights[index] ?? null;
}

async function verifyFixture(manifestDir: string, fixture: FixtureManifestEntry): Promise<void> {
  const absolutePath = resolve(manifestDir, fixture.path);
  const bytes = await readFile(absolutePath);
  const result = await probeWorldFile(new File([bytes], basename(absolutePath)));

  if (!fixture.probeExpectation) {
    console.log(`SKIP ${fixture.id}: no probe expectation recorded`);
    return;
  }

  assertEqual(result.status, fixture.probeExpectation.status, `${fixture.id} status`);
  assertEqual(result.worldRootClass, fixture.probeExpectation.worldRootClass, `${fixture.id} root class`);

  if (fixture.probeExpectation.metadata) {
    const expectedMetadata = fixture.probeExpectation.metadata;
    if (Object.hasOwn(expectedMetadata, 'name')) {
      assertEqual(result.metadata?.name ?? null, expectedMetadata.name ?? null, `${fixture.id} metadata.name`);
    }

    if (Object.hasOwn(expectedMetadata, 'wpVersion')) {
      assertEqual(result.metadata?.wpVersion ?? null, expectedMetadata.wpVersion ?? null, `${fixture.id} metadata.wpVersion`);
    }

    if (Object.hasOwn(expectedMetadata, 'wpBuild')) {
      assertEqual(result.metadata?.wpBuild ?? null, expectedMetadata.wpBuild ?? null, `${fixture.id} metadata.wpBuild`);
    }

    if (Object.hasOwn(expectedMetadata, 'pluginCount')) {
      assertEqual(result.metadata?.plugins.length ?? 0, expectedMetadata.pluginCount ?? 0, `${fixture.id} metadata.pluginCount`);
    }
  }

  if (fixture.probeExpectation.worldSummary) {
    const expectedWorldSummary = fixture.probeExpectation.worldSummary;

    if (Object.hasOwn(expectedWorldSummary, 'name')) {
      assertEqual(result.worldSummary?.name ?? null, expectedWorldSummary.name ?? null, `${fixture.id} worldSummary.name`);
    }

    if (Object.hasOwn(expectedWorldSummary, 'minHeight')) {
      assertEqual(result.worldSummary?.minHeight ?? null, expectedWorldSummary.minHeight ?? null, `${fixture.id} worldSummary.minHeight`);
    }

    if (Object.hasOwn(expectedWorldSummary, 'maxHeight')) {
      assertEqual(result.worldSummary?.maxHeight ?? null, expectedWorldSummary.maxHeight ?? null, `${fixture.id} worldSummary.maxHeight`);
    }

    if (Object.hasOwn(expectedWorldSummary, 'platformId')) {
      assertEqual(result.worldSummary?.platformId ?? null, expectedWorldSummary.platformId ?? null, `${fixture.id} worldSummary.platformId`);
    }

    if (Object.hasOwn(expectedWorldSummary, 'platformName')) {
      assertEqual(result.worldSummary?.platformName ?? null, expectedWorldSummary.platformName ?? null, `${fixture.id} worldSummary.platformName`);
    }

    if (expectedWorldSummary.spawnPoint) {
      if (Object.hasOwn(expectedWorldSummary.spawnPoint, 'x')) {
        assertEqual(result.worldSummary?.spawnPoint?.x ?? null, expectedWorldSummary.spawnPoint.x ?? null, `${fixture.id} worldSummary.spawnPoint.x`);
      }

      if (Object.hasOwn(expectedWorldSummary.spawnPoint, 'y')) {
        assertEqual(result.worldSummary?.spawnPoint?.y ?? null, expectedWorldSummary.spawnPoint.y ?? null, `${fixture.id} worldSummary.spawnPoint.y`);
      }
    }

    if (Object.hasOwn(expectedWorldSummary, 'dimensionCount')) {
      assertEqual(result.worldSummary?.dimensions.length ?? 0, expectedWorldSummary.dimensionCount ?? 0, `${fixture.id} worldSummary.dimensionCount`);
    }

    if (expectedWorldSummary.dimensions) {
      assertEqual(result.worldSummary?.dimensions.length ?? 0, expectedWorldSummary.dimensions.length, `${fixture.id} worldSummary.dimensions.length`);

      expectedWorldSummary.dimensions.forEach((expectedDimension, index) => {
        const actualDimension = result.worldSummary?.dimensions[index];

        if (Object.hasOwn(expectedDimension, 'name')) {
          assertEqual(actualDimension?.name ?? null, expectedDimension.name ?? null, `${fixture.id} worldSummary.dimensions[${index}].name`);
        }

        if (Object.hasOwn(expectedDimension, 'minHeight')) {
          assertEqual(actualDimension?.minHeight ?? null, expectedDimension.minHeight ?? null, `${fixture.id} worldSummary.dimensions[${index}].minHeight`);
        }

        if (Object.hasOwn(expectedDimension, 'maxHeight')) {
          assertEqual(actualDimension?.maxHeight ?? null, expectedDimension.maxHeight ?? null, `${fixture.id} worldSummary.dimensions[${index}].maxHeight`);
        }

        if (Object.hasOwn(expectedDimension, 'dimensionSeed')) {
          assertEqual(actualDimension?.dimensionSeed ?? null, expectedDimension.dimensionSeed ?? null, `${fixture.id} worldSummary.dimensions[${index}].dimensionSeed`);
        }

        if (Object.hasOwn(expectedDimension, 'minecraftSeed')) {
          assertEqual(actualDimension?.minecraftSeed ?? null, expectedDimension.minecraftSeed ?? null, `${fixture.id} worldSummary.dimensions[${index}].minecraftSeed`);
        }

        if (Object.hasOwn(expectedDimension, 'minTileX')) {
          assertEqual(actualDimension?.minTileX ?? null, expectedDimension.minTileX ?? null, `${fixture.id} worldSummary.dimensions[${index}].minTileX`);
        }

        if (Object.hasOwn(expectedDimension, 'maxTileX')) {
          assertEqual(actualDimension?.maxTileX ?? null, expectedDimension.maxTileX ?? null, `${fixture.id} worldSummary.dimensions[${index}].maxTileX`);
        }

        if (Object.hasOwn(expectedDimension, 'minTileY')) {
          assertEqual(actualDimension?.minTileY ?? null, expectedDimension.minTileY ?? null, `${fixture.id} worldSummary.dimensions[${index}].minTileY`);
        }

        if (Object.hasOwn(expectedDimension, 'maxTileY')) {
          assertEqual(actualDimension?.maxTileY ?? null, expectedDimension.maxTileY ?? null, `${fixture.id} worldSummary.dimensions[${index}].maxTileY`);
        }

        if (Object.hasOwn(expectedDimension, 'tileCount')) {
          assertEqual(actualDimension?.tileCount ?? null, expectedDimension.tileCount ?? null, `${fixture.id} worldSummary.dimensions[${index}].tileCount`);
        }

        if (Object.hasOwn(expectedDimension, 'decodedTileCount')) {
          assertEqual(actualDimension?.tiles.length ?? 0, expectedDimension.decodedTileCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].decodedTileCount`);
        }

        if (Object.hasOwn(expectedDimension, 'layerSettingCount')) {
          assertEqual(actualDimension?.layerSettings.length ?? 0, expectedDimension.layerSettingCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].layerSettingCount`);
        }

        if (Object.hasOwn(expectedDimension, 'availableLayerCount')) {
          assertEqual(actualDimension?.availableLayers.length ?? 0, expectedDimension.availableLayerCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].availableLayerCount`);
        }

        if (expectedDimension.availableLayers) {
          assertEqual(actualDimension?.availableLayers.length ?? 0, expectedDimension.availableLayers.length, `${fixture.id} worldSummary.dimensions[${index}].availableLayers.length`);

          expectedDimension.availableLayers.forEach((expectedLayer, layerIndex) => {
            const actualLayer = actualDimension?.availableLayers[layerIndex];

            if (Object.hasOwn(expectedLayer, 'name')) {
              assertEqual(actualLayer?.name ?? null, expectedLayer.name ?? null, `${fixture.id} worldSummary.dimensions[${index}].availableLayers[${layerIndex}].name`);
            }

            if (Object.hasOwn(expectedLayer, 'id')) {
              assertEqual(actualLayer?.id ?? null, expectedLayer.id ?? null, `${fixture.id} worldSummary.dimensions[${index}].availableLayers[${layerIndex}].id`);
            }

            if (Object.hasOwn(expectedLayer, 'dataSize')) {
              assertEqual(actualLayer?.dataSize ?? null, expectedLayer.dataSize ?? null, `${fixture.id} worldSummary.dimensions[${index}].availableLayers[${layerIndex}].dataSize`);
            }
          });
        }

        if (Object.hasOwn(expectedDimension, 'tileLayerBufferCount')) {
          assertEqual(actualDimension?.tileLayerBufferCount ?? 0, expectedDimension.tileLayerBufferCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].tileLayerBufferCount`);
        }

        if (Object.hasOwn(expectedDimension, 'tileBitLayerBufferCount')) {
          assertEqual(actualDimension?.tileBitLayerBufferCount ?? 0, expectedDimension.tileBitLayerBufferCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].tileBitLayerBufferCount`);
        }

        if (Object.hasOwn(expectedDimension, 'seedCount')) {
          assertEqual(actualDimension?.seedCount ?? 0, expectedDimension.seedCount ?? 0, `${fixture.id} worldSummary.dimensions[${index}].seedCount`);
        }

        if (expectedDimension.anchor) {
          if (Object.hasOwn(expectedDimension.anchor, 'dim')) {
            assertEqual(actualDimension?.anchor?.dim ?? null, expectedDimension.anchor.dim ?? null, `${fixture.id} worldSummary.dimensions[${index}].anchor.dim`);
          }

          if (Object.hasOwn(expectedDimension.anchor, 'role')) {
            assertEqual(actualDimension?.anchor?.role ?? null, expectedDimension.anchor.role ?? null, `${fixture.id} worldSummary.dimensions[${index}].anchor.role`);
          }

          if (Object.hasOwn(expectedDimension.anchor, 'invert')) {
            assertEqual(actualDimension?.anchor?.invert ?? null, expectedDimension.anchor.invert ?? null, `${fixture.id} worldSummary.dimensions[${index}].anchor.invert`);
          }

          if (Object.hasOwn(expectedDimension.anchor, 'id')) {
            assertEqual(actualDimension?.anchor?.id ?? null, expectedDimension.anchor.id ?? null, `${fixture.id} worldSummary.dimensions[${index}].anchor.id`);
          }

          if (Object.hasOwn(expectedDimension.anchor, 'defaultName')) {
            assertEqual(actualDimension?.anchor?.defaultName ?? null, expectedDimension.anchor.defaultName ?? null, `${fixture.id} worldSummary.dimensions[${index}].anchor.defaultName`);
          }
        }
      });
    }
  }

  if (fixture.importExpectation) {
    const importedProject = createImportedProject(result);

    if (!importedProject) {
      throw new Error(`${fixture.id} importExpectation: imported project was not created`);
    }

    if (Object.hasOwn(fixture.importExpectation, 'source')) {
      assertEqual(importedProject.source, fixture.importExpectation.source, `${fixture.id} importExpectation.source`);
    }

    if (Object.hasOwn(fixture.importExpectation, 'readSupport')) {
      assertEqual(importedProject.compatibility.readSupport, fixture.importExpectation.readSupport, `${fixture.id} importExpectation.readSupport`);
    }

    if (Object.hasOwn(fixture.importExpectation, 'writeSupport')) {
      assertEqual(importedProject.compatibility.writeSupport, fixture.importExpectation.writeSupport, `${fixture.id} importExpectation.writeSupport`);
    }

    if (Object.hasOwn(fixture.importExpectation, 'exportSupport')) {
      assertEqual(importedProject.compatibility.exportSupport, fixture.importExpectation.exportSupport, `${fixture.id} importExpectation.exportSupport`);
    }

    if (Object.hasOwn(fixture.importExpectation, 'dimensionCount')) {
      assertEqual(Object.keys(importedProject.dimensions).length, fixture.importExpectation.dimensionCount, `${fixture.id} importExpectation.dimensionCount`);
    }

    if (fixture.importExpectation.activeDimension) {
      const activeDimension = importedProject.dimensions[importedProject.activeDimensionId];
      const expectedActiveDimension = fixture.importExpectation.activeDimension;

      if (Object.hasOwn(expectedActiveDimension, 'name')) {
        assertEqual(activeDimension?.name ?? null, expectedActiveDimension.name ?? null, `${fixture.id} importExpectation.activeDimension.name`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'tileSize')) {
        assertEqual(activeDimension?.tileSize ?? null, expectedActiveDimension.tileSize ?? null, `${fixture.id} importExpectation.activeDimension.tileSize`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'minTileX')) {
        assertEqual(activeDimension?.minTileX ?? null, expectedActiveDimension.minTileX ?? null, `${fixture.id} importExpectation.activeDimension.minTileX`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'maxTileX')) {
        assertEqual(activeDimension?.maxTileX ?? null, expectedActiveDimension.maxTileX ?? null, `${fixture.id} importExpectation.activeDimension.maxTileX`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'minTileY')) {
        assertEqual(activeDimension?.minTileY ?? null, expectedActiveDimension.minTileY ?? null, `${fixture.id} importExpectation.activeDimension.minTileY`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'maxTileY')) {
        assertEqual(activeDimension?.maxTileY ?? null, expectedActiveDimension.maxTileY ?? null, `${fixture.id} importExpectation.activeDimension.maxTileY`);
      }

      if (Object.hasOwn(expectedActiveDimension, 'loadedTileCount')) {
        assertEqual(Object.keys(activeDimension?.tiles ?? {}).length, expectedActiveDimension.loadedTileCount ?? 0, `${fixture.id} importExpectation.activeDimension.loadedTileCount`);
      }

      if (expectedActiveDimension.importMetadata) {
        const actualImportMetadata = activeDimension?.importMetadata;
        const expectedImportMetadata = expectedActiveDimension.importMetadata;

        if (Object.hasOwn(expectedImportMetadata, 'dimensionSeed')) {
          assertEqual(actualImportMetadata?.dimensionSeed ?? null, expectedImportMetadata.dimensionSeed ?? null, `${fixture.id} importExpectation.activeDimension.importMetadata.dimensionSeed`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'minecraftSeed')) {
          assertEqual(actualImportMetadata?.minecraftSeed ?? null, expectedImportMetadata.minecraftSeed ?? null, `${fixture.id} importExpectation.activeDimension.importMetadata.minecraftSeed`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'layerSettingCount')) {
          assertEqual(actualImportMetadata?.layerSettings.length ?? 0, expectedImportMetadata.layerSettingCount ?? 0, `${fixture.id} importExpectation.activeDimension.importMetadata.layerSettingCount`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'availableLayerCount')) {
          assertEqual(actualImportMetadata?.availableLayers.length ?? 0, expectedImportMetadata.availableLayerCount ?? 0, `${fixture.id} importExpectation.activeDimension.importMetadata.availableLayerCount`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'tileLayerBufferCount')) {
          assertEqual(actualImportMetadata?.tileLayerBufferCount ?? 0, expectedImportMetadata.tileLayerBufferCount ?? 0, `${fixture.id} importExpectation.activeDimension.importMetadata.tileLayerBufferCount`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'tileBitLayerBufferCount')) {
          assertEqual(actualImportMetadata?.tileBitLayerBufferCount ?? 0, expectedImportMetadata.tileBitLayerBufferCount ?? 0, `${fixture.id} importExpectation.activeDimension.importMetadata.tileBitLayerBufferCount`);
        }

        if (Object.hasOwn(expectedImportMetadata, 'seedCount')) {
          assertEqual(actualImportMetadata?.seedCount ?? 0, expectedImportMetadata.seedCount ?? 0, `${fixture.id} importExpectation.activeDimension.importMetadata.seedCount`);
        }
      }
    }
  }

  if (fixture.saveExpectation?.kind === 'height-patch-roundtrip') {
    const importedProject = createImportedProject(result);

    if (!importedProject) {
      throw new Error(`${fixture.id} saveExpectation: imported project was not created`);
    }

    const originalDimension = importedProject.dimensions[importedProject.activeDimensionId];
    const originalHeight = getHeightAtWorldCell(originalDimension, fixture.saveExpectation.worldX, fixture.saveExpectation.worldY);
    if (originalHeight === null) {
      throw new Error(`${fixture.id} saveExpectation: original height sample is unavailable`);
    }

    const editedResult = applyHeightBrushToProject(
      importedProject,
      importedProject.activeDimensionId,
      {
        worldX: fixture.saveExpectation.worldX,
        worldY: fixture.saveExpectation.worldY,
      },
      fixture.saveExpectation.brush,
    );

    if (editedResult.project === importedProject) {
      throw new Error(`${fixture.id} saveExpectation: brush edit did not change the imported project`);
    }

    const editedDimension = editedResult.project.dimensions[editedResult.project.activeDimensionId];
    const editedHeight = getHeightAtWorldCell(editedDimension, fixture.saveExpectation.worldX, fixture.saveExpectation.worldY);
    if (editedHeight === null) {
      throw new Error(`${fixture.id} saveExpectation: edited height sample is unavailable`);
    }

    if (fixture.saveExpectation.brush.tool === 'raise' && editedHeight <= originalHeight) {
      throw new Error(`${fixture.id} saveExpectation: raise brush did not increase the sampled height`);
    }

    if (fixture.saveExpectation.brush.tool === 'lower' && editedHeight >= originalHeight) {
      throw new Error(`${fixture.id} saveExpectation: lower brush did not decrease the sampled height`);
    }

    const exportedWorld = exportPatchedWorldFile(editedResult.project);
    if (exportedWorld.patchedTileCount <= 0) {
      throw new Error(`${fixture.id} saveExpectation: exporter did not patch any imported tiles`);
    }

    const roundTripProbe = await probeWorldFile(new File([exportedWorld.bytes], exportedWorld.fileName));
    assertEqual(roundTripProbe.status, 'recognized', `${fixture.id} saveExpectation.roundTrip.status`);

    const reopenedProject = createImportedProject(roundTripProbe);
    if (!reopenedProject) {
      throw new Error(`${fixture.id} saveExpectation: round-trip import did not create a project`);
    }

    const reopenedDimension = reopenedProject.dimensions[reopenedProject.activeDimensionId];
    const reopenedHeight = getHeightAtWorldCell(reopenedDimension, fixture.saveExpectation.worldX, fixture.saveExpectation.worldY);
    assertEqual(reopenedHeight, editedHeight, `${fixture.id} saveExpectation.roundTrip.heightAtCell`);
  }

  if (fixture.mcExportExpectation) {
    const mcProject = createImportedProject(result);
    if (!mcProject) {
      throw new Error(`${fixture.id} mcExportExpectation: imported project was not created`);
    }

    const exported = exportMinecraftWorld(mcProject);
    assertEqual(exported.regionCount, fixture.mcExportExpectation.regionCount, `${fixture.id} mcExportExpectation.regionCount`);
    assertEqual(exported.chunkCount, fixture.mcExportExpectation.chunkCount, `${fixture.id} mcExportExpectation.chunkCount`);

    // Unzip and verify structure.
    const zipContents = unzipSync(exported.bytes);
    const fileNames = Object.keys(zipContents);

    if (!fileNames.includes('level.dat')) {
      throw new Error(`${fixture.id} mcExportExpectation: level.dat missing from zip`);
    }

    const regionFiles = fileNames.filter((name) => name.startsWith('region/') && name.endsWith('.mca'));
    assertEqual(regionFiles.length, fixture.mcExportExpectation.regionCount, `${fixture.id} mcExportExpectation region file count`);

    // Verify chunk count by parsing region file location tables (sector 0, 1024 × uint32).
    let totalChunks = 0;
    for (const regionFile of regionFiles) {
      const regionBytes = zipContents[regionFile];
      if (!regionBytes || regionBytes.length < 4096) {
        throw new Error(`${fixture.id} mcExportExpectation: region ${regionFile} is too short (${regionBytes?.length ?? 0} bytes)`);
      }

      const view = new DataView(regionBytes.buffer, regionBytes.byteOffset);
      for (let i = 0; i < 1024; i += 1) {
        if (view.getUint32(i * 4, false) !== 0) {
          totalChunks += 1;
        }
      }
    }

    assertEqual(totalChunks, fixture.mcExportExpectation.chunkCount, `${fixture.id} mcExportExpectation.chunksFromHeaders`);
  }

  console.log(`PASS ${fixture.id}: ${result.worldRootClass ?? 'unknown root'} / ${result.metadata?.wpVersion ?? 'unknown version'}`);
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(scriptDir, '../../fixtures/manifest.json');
  const manifestDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest;

  let failures = 0;
  for (const fixture of manifest.fixtures) {
    try {
      await verifyFixture(manifestDir, fixture);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : 'unknown verification error'}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${manifest.fixtures.length} fixture(s) successfully.`);
}

await main();