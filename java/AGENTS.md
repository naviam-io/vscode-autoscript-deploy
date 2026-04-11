# AGENTS.md

## Purpose

This repository contains a Java 17 Maximo automation script debugging integration plus a small VS Code helper extension.

Primary code paths:

- `src/main/java/io/naviam/autoscript/debug`: Java debug adapter server, Maximo script driver, and script-facing bridge.
- `src/main/scripts/vscode-autoscript-debug`: VS Code extension that attaches to the in-process debug adapter.
- `docs/vscode-mvp.md`: Current MVP scope and expected debugger behavior.

## Working Rules

- Preserve the existing implementation style: small focused classes, straightforward control flow, and minimal abstraction.
- Add comments only where behavior is protocol-heavy, Maximo-specific, or otherwise non-obvious.
- Do not introduce dependencies unless they are clearly required.
- Keep Java changes compatible with the current Gradle/Maximo setup in `build.gradle`.
- Prefer targeted fixes over broad refactors.

## Build And Verify

- Compile Java: `./gradlew compileJava`
- Run full build: `./gradlew build`
- The project depends on a local Maximo installation for `compileOnly` jars and classes. If compilation fails, verify the `maximoHome` path in `build.gradle`.

## Deployment Notes

- `deployToContainer` builds the jar and copies it into the configured Podman container and local Maximo lib directory.
- Treat deployment-related paths and container names as environment-specific; avoid hardcoding new ones without a clear reason.

## Editing Guidance

- When changing debugger behavior, keep the Debug Adapter Protocol flow coherent across:
  - `DebugAdapterServer`
  - `Driver`
  - the VS Code extension under `src/main/scripts/vscode-autoscript-debug`
- If you change script names, breakpoints, stepping, source mapping, or variable inspection, update `docs/vscode-mvp.md` when the documented behavior changes.
- Favor read-safe inspection for Maximo objects. Avoid getters or reflective access patterns that may mutate state or trigger persistence work.

## Output Expectations

- Keep changes production-oriented and concise.
- Call out any environment assumptions, especially around Maximo, local filesystem paths, Gradle, and Podman.
