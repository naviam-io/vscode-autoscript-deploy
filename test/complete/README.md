# Complete manifest test

One of every kind of resource a manifest can deploy, apart from a BIRT report, whose extraction does
not work on existing environments. Every record is named with a `TEST` prefix so it cannot collide
with a real one. `test/integration/cases/complete.test.js` deploys and removes it automatically; this
file describes doing the same by hand.

| Manifest                | Purpose                                                    |
| :---------------------- | :--------------------------------------------------------- |
| `release.manifest.json` | Deploys everything, in dependency order                    |
| `remove.manifest.json`  | Removes everything again, and can be rerun after a failure |

| Path                                             | Kind                    | Deploys                                                                                                                |
| :----------------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `configuration/configuration.manifest.json`      | `manifest`              | One file per JSON configuration type: property, message, logger, domains, object, action, cron task, escalation, query |
| (none)                                           | `databaseConfiguration` | Applies the `TESTOBJ` object, taking Admin Mode when Maximo requires it                                                |
| `scripts/test.complete.js`                       | `automationScript`      | `TEST.COMPLETE`, with a variable and an object launch point on `TESTOBJ`                                               |
| `scripts/osaction.testpersonapi.testcomplete.js` | `automationScript`      | The script behind the object structure action, which Maximo requires to be named `OSACTION.<structure>.<action>`       |
| `object-structure/object-structure.json`         | `configuration`         | `TESTPERSONAPI`, with an application authorization, a signature option, an action, a query and a query template        |
| `inspection-form/inspection-form.json`           | `inspectionForm`        | `TEST Complete Inspection`                                                                                             |
| `screen/create-testaction-app.js`                | `deployScript`          | The `TESTACTION` application, a duplicate of Actions, so the screen has an application to go to                        |
| `screen/testaction.xml`                          | `screen`                | The `TESTACTION` presentation, with conditional UI metadata                                                            |

The files `remove.manifest.json` deploys are in `remove/`.

## Deploying by hand

1. Use a disposable environment. The database configuration step may take Admin Mode, which logs
   every user out.
2. Deploy `release.manifest.json`.
3. Deploy `remove.manifest.json`.

Screen metadata deployment is not language neutral, so `screen/testaction.xml` only deploys to an
environment whose base language is English. The `TESTMEMO` signature option is created by
`screen/create-testaction-app.js` rather than by the screen metadata for the same reason.

## Not covered

- BIRT reports.
- Synonym domains, which Maximo does not let a deployment create or delete.
- Escalation notifications, which need a communication template.
- Inspection form scripts.
