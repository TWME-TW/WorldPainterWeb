# WorldPainterWeb

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/your-username/WorldPainterWeb)

WorldPainterWeb is a browser-only reimagining of WorldPainter.

The project goal is now explicit:

- no Java runtime in production
- no mandatory backend for core editing
- compatibility with original WorldPainter project files is a hard requirement
- exporting Minecraft worlds is a hard requirement
- all essential editing, rendering, save, and load behavior runs in the browser

The original WorldPainter codebase remains useful as a reference for product behavior and domain concepts, but not as a runtime dependency.

## Current Direction

This repository is now in early implementation, with the architectural direction fixed:

- browser-only and local-first
- compatibility-first rather than greenfield format-first
- broad behavior parity with the Java application is the product north star
- TypeScript as the primary implementation language
- Cloudflare only as a static deployment surface or optional lightweight edge layer

## What We Reuse From WorldPainter

We reuse concepts, not the Java runtime:

- world
- dimension
- tile
- layer
- height map
- brush based editing

We also reuse the original application's file and export behavior as a reference target:

- original .world project semantics
- original editing expectations as the long-term parity target
- Minecraft export behavior as the long-term parity target

These concepts will be reimplemented in browser-native data structures.

## What We Do Not Reuse Directly

- WPCore as a runtime library
- WPGUI as a UI layer
- plugin and scripting systems that depend on desktop or JVM assumptions

The browser app may still need to read and write the original .world format for compatibility, but that will have to be reimplemented rather than reused.

## Recommended Shape

- React + TypeScript application
- browser-side state and rendering pipeline
- Web Workers for heavy compute off the main thread
- IndexedDB and browser file APIs for persistence
- optional WebAssembly only where profiling proves it is necessary

Internally, the app should use a browser-native canonical model. Compatibility with original WorldPainter files and Minecraft export should be built as import and export adapters around that model.

## Cloudflare Fit

Cloudflare is still compatible with this direction, but only in a limited role.

What fits well:

- serving the static app bundle
- caching static assets globally
- optional share, publish, or sync helpers later

What should not depend on Cloudflare:

- core terrain editing
- core render pipeline
- local project save and load
- original WorldPainter file compatibility
- Minecraft world export

In other words, if the network disappears, the editor should still fundamentally work.

## MVP Scope

- open an original WorldPainter project file in the browser
- edit terrain in a 2D viewport
- save a compatible WorldPainter project file from the browser
- export a Minecraft world from the browser
- persist working state locally for autosave and recovery

The MVP is still phased, but the overall product direction is broader than the MVP scope. The long-term goal is to make the browser application behave as much like the Java version as the browser runtime realistically allows.

## Explicit Non Goals For V1

- full desktop feature parity
- byte-for-byte identity with Java serialized output
- complete plugin compatibility unless explicitly implemented
- scripting support
- full 3D editing
- collaborative multi-user editing

## Documents

- docs/architecture.md
- docs/compatibility-strategy.md
- docs/mvp-roadmap.md

## Immediate Next Step

Browser import preserves dimension seeds, layer settings, tile-level layer presence summaries, and enough raw source metadata to patch imported height maps and water levels back into the original `.world` container. Terrain brush edits support full undo/redo (Ctrl+Z / Ctrl+Y, up to 50 steps). A first-pass **Minecraft Java Edition 1.17.1 export** is now in place: the active dimension's terrain tiles are converted into Anvil region files (`.mca`), a minimal `level.dat`, and packaged as a downloadable `.zip`. The export covers heights, water levels, and the five terrain codes (grass/sand/stone/snow/water). The next implementation steps are layer-aware compatible `.world` writes and broader Minecraft biome/material fidelity.
