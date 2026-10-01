# Copilot instructions

This file is intentionally short. The knowledge lives elsewhere so it has exactly one owner
and cannot drift into three inconsistent copies.

**Read [`AGENTS.md`](../AGENTS.md) first.** It is the contract for any AI agent working in
this repository: guardrails, what needs human approval, what "done" means.

Then use [`docs/README.md`](../docs/README.md) as the index into architecture, module guides,
flow walkthroughs, API references, setup and testing.

## The one thing to internalise before touching anything

This repository has two halves that run in different places:

- **Client**: `src/`, JavaScript bundled by webpack, runs in the VS Code extension host.
- **Server**: `resources/*.js` and `resources/library/`, runs on **Nashorn inside Maximo**.

They talk over REST. Changing behaviour that crosses that line usually means changing both
sides. Node idioms do not work on the server side.

## Two commands

```bash
npm install && npm run package    # the validation gate; ~6 s, no credentials needed
git submodule update --init --recursive    # resources/ is a private submodule
```

`npm test` runs lint plus the `node:test` unit tests. CI runs lint and unit tests on `develop` and pull requests. `npm run package`
is what you rely on, and `npx eslint .` must report no errors.

## Before running anything against Maximo

Deploys, admin mode and debugging all mutate a live server, irreversibly, for every user of
it. Read [`docs/setup/maximo-environments.md`](../docs/setup/maximo-environments.md) before
you point a command at a host.

## Additional agent configuration

- `.github/agents/`: task-specific agents (`maximo-investigator`, `maximo-verifier`).
- `.github/skills/`: repeatable procedures, e.g. `maximo-library-typescript`.
