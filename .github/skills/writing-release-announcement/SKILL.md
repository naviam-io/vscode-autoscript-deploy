---
name: writing-release-announcement
description: Use when asked to write, draft or summarise an internal release announcement, release post or "what's new" message for a Maximo Development Tools version, to be shared in team groups or channels rather than in the changelog.
---

# Writing an internal release announcement

## Overview

The announcement tells colleagues **why the release matters**, not what changed line by line.
`CHANGELOG.md` is the detailed record; the announcement points to it.

## Inputs

- The version's section in `CHANGELOG.md`. For a patch release, also read the preceding minor
  release if the patch revises it, so the announcement describes the net result.
- The release theme, if the user gave one. Otherwise infer it from the largest changes.

## Output shape

The announcement is exactly these four parts, in this order:

1. **Title:** `New release - Maximo Development Tools <version>`
2. **Impact sentence:** one sentence stating the goal or impact of the release for the team's
   delivery work.
3. **`Release highlights:`** followed by up to 6 bullets, never padded to look bigger. Each
   bullet is one line stating a capability or outcome a user would notice, in about 25 words or
   fewer. Lead with the biggest features; fold related small fixes into a single bullet, e.g.
   "Better support for Maximo systems with a non-English base language".
4. **Changelog link, always this exact line:**
   `Complete changelog: https://marketplace.visualstudio.com/items/sharptree.maximo-script-deploy/changelog`

Write each bullet for a reader who has never opened a configuration file: a team lead or
consultant deciding whether the release matters to them. If a bullet needs a Maximo field name, a
JSON key or a literal value to make sense, rewrite it at the level of the capability:

| Changelog level                                                                                  | Announcement level                                                        |
| :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| Synonym domain fields such as domain type and cron task access level take localized values again | Configuration extracted with the previous release deploys again unchanged |
| Script variables are named `varName`; `varname` logs a deprecation warning                       | More consistent automation script configuration                           |

A breaking change or required action gets one bullet saying who is affected and that the
changelog has the steps.

Follow the repository writing style: no em dashes; use a colon, comma or full stop.

## Example

```text
New release - Maximo Development Tools 1.30.0

This is a strategic step towards a more controlled Maximo delivery process, where configuration releases are intentional, reproducible, structured, and easy to automate across development workflows and CI/CD pipelines.

Release highlights:
- Deployment manifests become central to delivery, allowing an entire release to be structured and deployed in a defined order
- Capability to retain customer-owned values during releases and upgrades
- Improved quick project bootstrapping with TypeScript automation script support, now available to everyone
- Better support for Maximo systems with a non-English base language
- The bundled local MCP server has been removed in favour of a registered MCP server definition, preparing the tooling to work with the autoscript-based MCP server

Complete changelog: https://marketplace.visualstudio.com/items/sharptree.maximo-script-deploy/changelog
```

## Common mistakes

| Mistake                                           | Fix                                                    |
| :------------------------------------------------ | :----------------------------------------------------- |
| One bullet per changelog entry                    | Group by theme; at most 6 bullets                      |
| Field names, code or value syntax in bullets      | Describe the capability; leave syntax to the changelog |
| Parenthesised list of every affected type         | Name the capability once, e.g. "configuration values"  |
| Linking `CHANGELOG.md` in the repo                | Use the Marketplace changelog URL above                |
| Opening with "This is a patch release..."         | Open with the impact for users, even for a patch       |
| Custom title such as "Released" or emoji headings | Use the fixed title format                             |
