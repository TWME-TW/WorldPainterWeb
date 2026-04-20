# WorldPainterWeb Architecture Plan

## 1. Baseline From The Existing Codebase

The existing WorldPainter desktop codebase is still useful, but only as a design reference.

What we should carry forward are the domain ideas:

- a project contains one or more dimensions
- a dimension is divided into tiles
- each tile stores terrain, water, and layer data
- height maps are first-class terrain sources
- brush tools mutate tiles in local regions

What we should not carry forward as runtime assumptions:

- Swing and JIDE UI structure
- JVM-only storage and serialization formats as the default path
- desktop-only plugin and scripting behavior

At the same time, original project compatibility and Minecraft world export are now hard requirements, so the new architecture must reproduce those behaviors in browser-safe code.

## 2. Primary Decision

WorldPainterWeb is browser-only.

That means:

- no Java runtime in production
- no required backend for core editing behavior
- no server-authoritative world session model for the MVP
- the browser owns project state, rendering, editing, persistence, and export packaging
- original WorldPainter project compatibility is a primary feature
- Minecraft world export is a primary feature

The original Java code can still inform behavior, algorithms, and UI semantics, but it is no longer the executable core.

Strategically, the goal is still to make the browser version behave as much like the Java application as practical. The architecture is browser-native by implementation, not intentionally behavior-divergent by product design.

## 3. Architectural Consequence

Because compatibility and export are hard requirements, this project cannot be planned as a greenfield web editor with a new format only.

It needs three explicit subsystems:

- a browser-native canonical project model
- a compatibility layer for original WorldPainter project files
- a browser-native Minecraft export layer

The canonical model exists for runtime performance and maintainability. The compatibility and export layers exist to satisfy product requirements.

## 4. What Browser-Only Means In Practice

The application must still work when deployed as static files.

Core flows that must remain browser-native:

- create a project
- load a local project file
- load an original WorldPainter project file
- import a height map
- edit terrain and supported layers
- save a compatible WorldPainter project locally
- export a Minecraft world locally

Optional cloud features may exist later, but they must be additive rather than required.

## 5. Cloudflare Role

Cloudflare is compatible with this direction only as a deployment surface.

Good fits:

- Cloudflare Pages or Workers Static Assets for app hosting
- CDN caching for JS, CSS, and static assets
- optional later features such as share links, telemetry, or asset publishing

Bad fits for the core editor:

- depending on Worker execution for essential edit logic
- requiring server-side sessions for normal use
- moving project state off-device just to make the editor function

If the app cannot still edit maps when served as plain static assets, the architecture has drifted away from the requirement.

## 6. Proposed Target Architecture

### UI Shell

Recommended stack:

- React
- TypeScript
- Vite
- canvas-based viewport

Responsibilities:

- layout, toolbars, inspector panels, and dialogs
- project lifecycle actions
- viewport camera control
- undo and redo integration
- local file handling and save prompts

### Compute Layer

Recommended browser primitives:

- Web Workers for expensive mutations and rendering preparation
- OffscreenCanvas where supported
- Typed arrays for tile payloads
- optional WebAssembly only for proven hot paths

Responsibilities:

- tile mutation from brush commands
- height map processing
- preview tile rendering or render buffer generation
- project serialization and deserialization
- compatibility transforms
- Minecraft export transforms

### Compatibility Layer

This layer is required, not optional.

Responsibilities:

- read original WorldPainter project files into the canonical model
- preserve unsupported or unknown structures where feasible
- write compatible WorldPainter project files from the canonical model
- maintain a compatibility matrix for what is readable, preservable, editable, and exportable

### Persistence Layer

Recommended browser primitives:

- IndexedDB for autosave and recent projects
- File System Access API where available
- download-based save fallback for unsupported browsers

Responsibilities:

- autosave snapshots
- project metadata index
- explicit open and save flows
- import of source images and original WorldPainter project files
- export of compatible WorldPainter project files
- export of Minecraft world packages

## 7. Data Model Strategy

The runtime model should be reimplemented in TypeScript rather than mapped 1:1 from Java classes.

Suggested browser-native structures:

- Project
	- metadata
	- dimensions
	- export settings
- DimensionState
	- id
	- name
	- bounds
	- tile index
- TileState
	- height buffer
	- water buffer
	- terrain buffer
	- sparse layer buffers
	- preserved compatibility payloads where needed
- LayerState
	- id
	- type
	- config

Implementation guidance:

- prefer flat, serializable DTOs over class-heavy object graphs
- keep tile payloads in typed arrays
- favor sparse storage for optional layers
- avoid runtime shapes that require deep cloning for every edit
- store compatibility side data separately from fast-path editing buffers

## 8. Rendering Strategy

The first rendering path should also be browser-native.

Recommended MVP path:

1. store tile data in typed arrays
2. render visible tiles into ImageData or OffscreenCanvas in a Web Worker
3. transfer ImageBitmap or pixel buffers back to the UI thread
4. compose the viewport with a canvas-based tile renderer

Why this shape is appropriate:

- it keeps the main thread responsive
- it avoids server tile generation entirely
- it matches the requirement that the product is fundamentally browser-resident

WebGL can be introduced later if CPU canvas rendering becomes the bottleneck.

## 9. Storage And File Format

The existing .world format can no longer be treated as optional future compatibility. It is now a required external format.

Recommended path:

- keep an internal browser-native canonical model for runtime use
- support original .world as a required import and export format
- optionally keep a browser-native debug or snapshot format for internal development if useful

Possible package layout:

```text
manifest.json
dimensions/overworld/index.json
dimensions/overworld/tiles/0_0.bin
dimensions/overworld/tiles/0_1.bin
assets/previews/thumbnail.png
```

Implication:

- the runtime model and the compatibility format are no longer the same thing

## 10. Import And Export Strategy

### Import

Required for MVP:

- image-based height map import
- original WorldPainter project import

### Export

Required for MVP:

- compatible WorldPainter project save
- preview image export
- Minecraft world export

This is the heaviest technical area of the project, because it requires substantial reimplementation of project serialization, NBT writing, region writing, and exporter behavior in TypeScript or another browser-safe compilation target.

## 11. MVP Scope

In scope for the first usable release:

- open original WorldPainter project files
- import height maps
- view terrain in a 2D browser viewport
- perform a limited set of brush edits
- save compatible WorldPainter project files
- export Minecraft worlds locally
- keep autosave and recovery locally in the browser

Out of scope for the first usable release:

- full desktop parity in the first release
- support for every plugin-defined format extension
- support for every exporter variant and every Minecraft version
- scripting
- collaborative editing
- full 3D editing

## 12. Risks And Mitigations

### Browser memory pressure

Risk:

- large projects can exceed comfortable in-tab memory usage.

Mitigation:

- tile-based chunking
- lazy loading of project regions
- compact typed array storage
- autosave snapshots that avoid full deep copies

### WorldPainter format compatibility

Risk:

- the original project format is Java-centric and difficult to reproduce exactly in the browser.

Mitigation:

- target semantic compatibility rather than byte identity
- preserve opaque or unsupported payloads where feasible
- maintain a versioned compatibility matrix

### Main thread jank

Risk:

- rendering and brush operations can freeze the UI.

Mitigation:

- move heavy work into Web Workers
- keep viewport rendering incremental
- use dirty-tile invalidation instead of full rerenders

### Storage quota limits

Risk:

- IndexedDB quotas vary across browsers and devices.

Mitigation:

- treat local file export as a first-class save path
- keep autosave retention bounded
- provide project size visibility in the UI

### Export parity expectations

Risk:

- users may expect browser export to match desktop output immediately across all features.

Mitigation:

- publish an explicit support matrix for terrain, layers, and target versions
- validate output against golden reference worlds from original WorldPainter

### Cloudflare confusion

Risk:

- the deployment target can accidentally influence the product into requiring server logic.

Mitigation:

- keep the app able to run as static assets only
- treat any Cloudflare feature beyond hosting as optional

## 13. Suggested Repository Layout

This repository is empty right now. A good first shape would be:

```text
docs/
app/
fixtures/
```

If optional cloud helpers are added later, they should stay clearly secondary:

```text
docs/
app/
edge/
```

The app directory should remain the product core.

The fixtures directory should hold compatibility samples and golden outputs.

## 14. Practical Rule For The Project

If a feature requires an always-on server or a Java process to exist, it is not part of the browser-only MVP.

The project should prefer browser APIs, TypeScript data structures, and client-side workers first. Optional cloud features can come later, but they must never become the reason the editor works at all.

At the same time, no shortcut should be accepted if it blocks original WorldPainter compatibility or Minecraft world export, because those are now baseline product requirements.