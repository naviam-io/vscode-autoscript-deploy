---
name: maximo-library-typescript
description: Work on the webpack-built TypeScript deployment library under resources/library that generates resources/naviam.autoscript.library.js. Use for any change to this library: implementing or migrating a Maximo configuration object type from the legacy JavaScript into TypeScript, validating an already-migrated type against legacy behavior and current schemas, or refactoring the shared deploy/extraction/util logic. Covers deploy, extraction, JSON schemas, and extension wiring.
---

# Maximo TypeScript Deployment Library (`resources/library`)

## What this library is

`resources/library` is a TypeScript + Babel project that webpack-builds into the Maximo-side script
`resources/naviam.autoscript.library.js` (webpack `output.path` is `../`). The generated script runs
**inside Maximo** (Nashorn/Jython) and deploys/extracts configuration objects.

- Each Maximo object type is a module in `resources/library/src/*.ts`: `actions`, `cron-tasks`,
  `domains`, `escalations`, `integration-objects`, `loggers`, `messages`, `objects`, `properties`,
  `queries`. Shared helpers live in `util.ts`; wiring/dispatch in `index.ts`.
- `index.ts` maps each **plural JSON key** to a handler via `registerHandler('<types>', ...)`
  (`properties, messages, loggers, domains, cronTasks, integrationObjects, actions, escalations,
  queries, objects`).
- The JSON contract for these types is in `schemas/` (root), e.g. `deploy-schema.json`.

**Never hand-edit the generated `resources/naviam.autoscript.library.js`.** Edit the TypeScript and
rebuild. `resources` is a nested repo/submodule; run `git -C resources status --short` before editing
and never revert pre-existing or staged user changes there.

## When to use this skill

Use it for **any** work on `resources/library/src/*.ts` or on the behavior of the generated
`naviam.autoscript.library.js`, in one of three modes:

- **Implement / migrate**: bring a Maximo object type from the legacy JavaScript into a TypeScript module.
- **Validate**: audit an already-migrated type for behavioral gaps vs legacy, drift from `schemas/`,
  and bug/improvement opportunities.
- **Refactor**: change shared deploy/extraction/util logic without altering public JSON shape.

## Sources of truth: reconcile all three, do not blindly mirror the old JS

1. **Legacy JavaScript implementation**: the pre-TypeScript monolith `naviam.autoscript.library.js`.
   It was deleted from the `resources` submodule when the library moved to TypeScript, so read the
   committed original **from git history** (there is no `library_old.js` to rely on):
   `git -C resources show 100ad7c^:naviam.autoscript.library.js > /tmp/library-legacy.js`
   (commit `100ad7c` "Initial configuration of library to typescript" removed it; parent `100ad7c^`
   still has it). If that SHA is ever unavailable, rediscover the deleting commit with
   `git -C resources log --diff-filter=D -- naviam.autoscript.library.js`. Also consult
   `resources/naviam.autoscript.objects.js` for extraction round-trip behavior.
   - Treat the legacy code as a **behavioral reference, not a gold standard.** It contains
     inconsistencies and bugs. **Challenge it:** flag missing null handling, copy-paste errors,
     inconsistent field names/defaults, unsafe or mutating MBO access, and dead branches. Do not port
     a bug just because it exists; propose the corrected behavior and call it out.
2. **Current schemas**: `schemas/*.json` (and any workspace-copied schema) define the public JSON
   contract. When the old JS and the schema disagree, prefer the schema unless an instruction says
   otherwise, and keep both aligned when the extension seeds one from the other.
3. **Developer instructions / desired behavior**: the task description, any provided table DDL or
   object metadata, and repo docs. When an intentional change to legacy behavior is wanted, follow it
   and record the deviation rather than reproducing the old output.

Resolve conflicts **explicitly**: state which source wins and why. Use DDL nullability/defaults to
shape required vs optional JSON fields: only nullable columns or fields with a proven deploy default
should be optional or null-capable.

## Mode: implement / migrate a type

1. Learn the current pattern first. Read `resources/library/src/index.ts`, `src/core/util.ts`, and the
   nearest completed modules of the same lifecycle kind in `src/config/`; treat them as canonical for
   module shape, constructor behavior, delete intent, MBO lifecycle, and verification. Discover
   current file/module names from the repo; do not assume historical names.
2. Extract the legacy contract for the type from `/tmp/library-legacy.js`: the object constructor,
   `deploy<Type>s`, add/update functions, delete functions, `SqlFormat` where-clauses, child MBO
   relationships, save points, cache reloads, and service calls. Reconcile against the schema and
   instructions (above).
3. Implement a focused module:
   - Export a `process(...)` function, an input `interface`, and a class that maps input to fields.
   - Include the same reference headers used by nearby modules.
   - Map required non-null input fields directly in the constructor; do not invent defaults for
     non-null database columns unless legacy, Maximo metadata, or the user proves the default.
   - Keep constructors as field mappers; no validation `throw` unless the existing pattern does it or
     the user asks. Use `_delete` for delete intent; do not add legacy `delete` support.
4. Shape `process(...)` like existing modules:
   - `const set = MXServer.getMXServer().getMboSet('<OBJECT>', maximo.getSystemUserInfo())`; close it in
     `finally` with `close(...)`.
   - Use `SqlFormat` for lookup clauses, never string concatenation.
   - If `_delete`, delete when found (save) and no-op when missing. For add/update, add when missing,
     set identity fields only for new records when appropriate, then apply mutable values.
   - Split into small helpers for lookup, add/update, child records, and side effects; reuse `util.ts`
     rather than duplicating lookup/delete/value-setting logic.
5. Preserve required Maximo side effects at the same behavioral boundary as the legacy code (saves,
   cache reloads, service calls, child MBO delete/recreate with the same relationship names), unless a
   source of truth intentionally changes them.

## Mode: validate an existing migration

- Build the legacy contract for the type from `/tmp/library-legacy.js` and compare it to the migrated
  TS module (constructor fields, add/update, delete, lookup keys, side effects).
- Cross-check the JSON shape (property names, defaults, plural key, identity fields) against `schemas/`
  and the extraction round-trip in `resources/naviam.autoscript.objects.js`.
- Classify every finding as one of:
  - **Regression**: TS drops or changes behavior the legacy code intentionally had → fix.
  - **Legacy defect**: inconsistency/bug in the old JS → do **not** replicate; propose the corrected
    behavior and note it.
  - **Improvement**: safe simplification or shared-helper reuse that keeps public behavior → suggest.
- Do not change the public JSON shape unless `schemas/` or an instruction requires it. Report generated
  artifacts and schema/README changes that were emitted but intentionally left alone.

## Wire deploy, extraction, and editor support

- Import the class and `process` in `index.ts` and register the plural key:
  `registerHandler('<types>', function (item: any): void { processType(new MaximoType(item)); });`.
  Keep unknown JSON keys ignored, matching existing `deployConfig`/dispatch behavior.
- If extension code classifies config files by top-level keys, add the plural key there.
- If extraction is supported, add list/detail handling to the Maximo-side extraction script and the VS
  Code picker/merge behavior. Emit required non-null fields, omit nullable fields when null unless local
  style preserves nulls, and de-duplicate using explicit identity fields, not fallback defaults.
- Update **every** schema source that can be copied into a workspace, not only the active workspace copy.

## Verify

- `cd resources/library && npm install && npm run lint && npm run package` (webpack production;
  regenerates `resources/naviam.autoscript.library.js`). Node 22 / TypeScript 5.9.
- When extension JavaScript wiring changed, run targeted lint on the touched files and the root
  `npm run package`.
- Parse changed JSON schemas and run `diff --check` on touched files in both the root repo and the
  nested `resources` repo.
- Review the diff for accidental schema, README, generated-bundle, staged-index, or unrelated changes.
- Do not bump extension or Maximo script version constants to force reinstall unless the user asks or
  the release process requires it.

## Style notes

- Keep emitted code ES5/Nashorn compatible by relying on the existing TypeScript + webpack setup.
- Prefer Maximo object/field names that match the legacy implementation; name helper interfaces and
  lifecycle variables after the Maximo concept they represent; keep JSON property names stable and
  camel-cased unless a schema or extraction script proves otherwise.
- Keep input optionality separate from class state: `field?: T` for omitted JSON input;
  `field: T = default` (or `field: T | null`) for class fields with initializers or valid runtime null.
- Prefer shared bulk helpers from `util.ts` (`setValue`, `applyValues`, `applyOptionalValues`,
  `applyWritableValues`, default-coercion helpers like `booleanOrDefault`) over object-local setter
  variants. If such a helper is needed by more than one module, **move it to `util.ts`** and update
  callers; state this rule once and apply it everywhere. `setValue` semantics: skip `undefined`, call
  `setValueNull` for `null`, pass access modifiers through.
- Do not refactor unrelated object types unless it removes duplication introduced by the current change
  or the user asks. Do not bake object-specific examples into the skill; record reusable checks.
