# Fixtures

This directory is reserved for compatibility samples and golden outputs.

Planned contents:

- original WorldPainter .world fixtures
- browser round-trip fixtures
- desktop exported Minecraft world references
- compatibility matrix notes for each sample

See manifest.json for the repository-side fixture index. Each future sample should record:

- source WorldPainter version
- expected probe worldSummary fields for the current parser slice
- expected browser load outcome
- expected browser save outcome
- expected desktop reopen outcome
- expected Minecraft export outcome
