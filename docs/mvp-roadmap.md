# WorldPainterWeb MVP Roadmap

## Goal

Deliver a browser-only WorldPainter workflow that is useful before it is complete.

The MVP is successful if a user can open the app as static web content, create or load a project, edit terrain in the browser, and save the result without needing a backend or Java runtime.

The overall product target remains broad behavior parity with the Java version. The roadmap phases are a delivery strategy, not a statement that partial parity is the end state.

For this project, MVP also means two compatibility outcomes are present:

- the app can open and save compatible WorldPainter project files
- the app can export a Minecraft world locally

## Phase 0: Foundation

Target outcome:

- a runnable frontend shell with a compatibility-aware project model and a fixture corpus

Work items:

- scaffold React + TypeScript + Vite app
- define the initial Project, DimensionState, TileState, and LayerState schemas
- define compatibility matrix levels for read, preserve, edit, and export
- gather a fixture corpus of original .world files and desktop-exported worlds
- set up a canvas viewport shell
- establish IndexedDB based autosave
- establish local file open and save strategy

Acceptance criteria:

- app runs as static assets only
- app can create an empty project in memory
- project state can be autosaved locally without any backend
- a fixture strategy exists for compatibility verification

## Phase 1: Original Project Compatibility Read Path

Target outcome:

- a browser can open original WorldPainter projects into the internal model

Work items:

- implement browser-side parser pipeline for original WorldPainter project files
- map supported project structures into the canonical model
- preserve unknown or unsupported payloads where feasible
- expose compatibility warnings in the UI

Acceptance criteria:

- user can load a real original WorldPainter project file in the browser
- unsupported features are surfaced explicitly rather than silently dropped

## Phase 2: Viewport And Local Editing Core

Target outcome:

- a browser can inspect and edit loaded projects responsively

Work items:

- implement tile data containers with typed arrays
- implement worker-based tile rendering pipeline
- add pan and zoom controls
- add basic overlays for grid and cursor location
- add project metadata and dimension panels
- add height map import into the canonical model

Acceptance criteria:

- user can navigate and inspect a loaded project entirely in the browser
- viewport remains responsive while rendering visible tiles
- height map import works without any backend

## Phase 3: Compatible Save Path

Target outcome:

- a browser can save projects back into a compatible WorldPainter project format

Work items:

- implement compatible WorldPainter project writing from the canonical model
- preserve opaque compatibility payloads where possible
- validate browser-saved projects by reopening them in the browser and in original WorldPainter
- add explicit warnings for partially supported fields

Acceptance criteria:

- a loaded original project can be saved back out in a compatible form
- supported core features survive a round trip

## Phase 4: Basic Editing

Target outcome:

- a browser can make meaningful terrain changes locally

Recommended first tool set:

- raise and lower terrain
- flatten terrain
- smooth terrain
- paint terrain material

Work items:

- define browser-side brush command model
- execute mutations inside a Web Worker
- track dirty tiles for incremental rerender
- add undo and redo support
- add brush preview overlay

Acceptance criteria:

- edits are visible immediately after mutation completes
- the UI stays responsive during normal brush use
- save and reopen preserves edits

## Phase 5: Minecraft World Export

Target outcome:

- a browser can export a usable Minecraft world locally

Work items:

- implement NBT writing
- implement region and chunk writing
- implement terrain and material mapping
- implement export rules for the MVP-supported layer set
- add preview image export and project thumbnail generation

Acceptance criteria:

- user can download an exported Minecraft world locally
- exported output opens as a usable world for the explicitly supported target version
- preview exports work entirely client-side

## Deferred Until After MVP

- full compatibility with every WorldPainter plugin extension
- full compatibility with every WorldPainter historical version
- parity with every desktop exporter and layer rule
- scripting tools
- full layer editor parity
- full 3D editing
- collaborative editing
- cloud sync and multi-device project sharing

## First Implementation Backlog

These are the first concrete tasks worth doing after plan approval:

1. scaffold the app project in this repository
2. collect and version a compatibility fixture corpus
3. define the canonical browser project schema and compatibility matrix
4. implement initial original-project parsing experiments
5. implement a worker-driven tile renderer for one dimension
6. investigate the minimum viable NBT and region writing path for browser export

## Exit Criteria For MVP Planning

The planning phase can be considered complete when the team agrees on:

- no Java runtime in production
- no mandatory backend for the core editor
- original WorldPainter project compatibility is in-scope, not deferred
- Minecraft world export is in-scope, not deferred
- client-side tile rendering and editing remain the default path
- broad behavior parity with the Java application is the long-term product target
- explicit deferral is limited to plugins, scripting, full 3D, and deep parity edges