# Complete manifest test

One of every kind of resource a manifest can deploy, apart from a BIRT report, whose extraction does
not work on existing environments. Every record is named with a `TEST` prefix so it cannot collide
with a real one. `test/integration/cases/complete.test.js` deploys and removes it automatically; this
file describes doing the same by hand.

| Manifest                | Purpose                                                    |
| :---------------------- | :--------------------------------------------------------- |
| `release.manifest.json` | Deploys everything, in dependency order                    |
| `remove.manifest.json`  | Removes everything again, and can be rerun after a failure |

| Path                                             | Kind                    | Deploys                                                                                                                                                                                                                                                                                    |
| :----------------------------------------------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration/create-comm-template.js`          | `deployScript`          | The `TESTCOMPLETE` communication template the escalation notification uses                                                                                                                                                                                                                 |
| `configuration/configuration.manifest.json`      | `manifest`              | One file per JSON configuration type: property, message, logger, domains, object, action, cron task, escalation, query, end point, a publish channel and an enterprise service that each embed an object structure, and a disabled external system that embeds its own channel and service |
| (none)                                           | `databaseConfiguration` | Applies the `TESTOBJ` object, taking Admin Mode when Maximo requires it                                                                                                                                                                                                                    |
| `scripts/test.complete.js`                       | `automationScript`      | `TEST.COMPLETE`, with a variable and an object launch point on `TESTOBJ`                                                                                                                                                                                                                   |
| `scripts/osaction.testpersonapi.testcomplete.js` | `automationScript`      | The script behind the object structure action, which Maximo requires to be named `OSACTION.<structure>.<action>`                                                                                                                                                                           |
| `configuration/object-structure.json`            | `configuration`         | The standalone `TESTPERSONAPI` object structure, with an application authorization, a signature option, an action, a query and a query template                                                                                                                                            |
| `inspection-form/inspection-form.json`           | `inspectionForm`        | `TEST Complete Inspection`                                                                                                                                                                                                                                                                 |
| `screen/create-testaction-app.js`                | `deployScript`          | The `TESTACTION` application, a duplicate of Actions, so the screen has an application to go to                                                                                                                                                                                            |
| `screen/testaction.xml`                          | `screen`                | The `TESTACTION` presentation, with conditional UI metadata                                                                                                                                                                                                                                |
| `screen/testaction-changes.json`                 | `configuration`         | Presentation changes to `TESTACTION`: a tab added, a label modified, a field moved and a column removed                                                                                                                                                                                    |

`configuration/object-structure.json` is a separate release step, not part of the configuration manifest, because
its action needs `scripts/osaction.testpersonapi.testcomplete.js` deployed first. The files `remove.manifest.json`
deploys are in `remove/`.

## Deploying by hand

1. Use a disposable environment. The database configuration step may take Admin Mode, which logs
   every user out.
2. Deploy `release.manifest.json`.
3. Deploy `remove.manifest.json`.

Screen metadata deployment is not language neutral, so `screen/testaction.xml` only deploys to an
environment whose base language is English. The `TESTMEMO` signature option is created by
`screen/create-testaction-app.js` rather than by the screen metadata for the same reason.

## Demonstrating retained values

The supported JSON configuration records declare `_retain`: the first deployment installs the file's
defaults, and subsequent deployments preserve the named values from Maximo. A retained collection
also preserves customer-added rows; markers on its declared rows preserve the named fields of those
rows. See [Retaining Customer Values](../../README.md#retaining-customer-values).

1. Deploy `release.manifest.json` by hand in a disposable environment.
2. In Maximo, change the `TESTSETPRIORITY` action's value from `1` to `5` and its description to
   `Customer description`. Save.
3. Redeploy `configuration/action.json` without editing the file.
4. Reopen the action: the value is still `5`, while the description is back to
   `Complete manifest test action`. The memo is retained too.
5. Optionally repeat with another configuration below, or redeploy the release manifest to show
   retention across the whole release.
6. Deploy `remove.manifest.json` when finished.

Other examples available for the same edit, save and redeploy sequence:

| File                                    | Example customer change that survives redeployment                                     |
| :-------------------------------------- | :------------------------------------------------------------------------------------- |
| `configuration/property.json`           | Change the global or declared instance value; add an instance                          |
| `configuration/message.json`            | Change the message text or explanation                                                 |
| `configuration/logger.json`             | Change the log level or appenders                                                      |
| `configuration/domain.json`             | Add an ALN value; edit a declared value's description or a table domain's list clause  |
| `configuration/object.json`             | Change the object description, an attribute title or the relationship's where clause   |
| `configuration/cron-task.json`          | Change the instance schedule, history settings or `PURGETIME`; add an instance         |
| `configuration/escalation.json`         | Change the schedule or elapsed interval; add a point or notification                   |
| `configuration/query.json`              | Change the saved query's clause, notes or priority                                     |
| `configuration/object-structure.json`   | Change search attributes, an alias or a query template's page size                     |
| `configuration/end-point.json`          | Change the end point description or its URL                                            |
| `configuration/publish-channel.json`    | Change the channel description or message tracking; disable the processing rule        |
| `configuration/enterprise-service.json` | Change the service description, message tracking or gateway property; disable the rule |
| `configuration/external-system.json`    | Change the system description or the `WOSTART` list values; keep it disabled           |

Keep the cron task and escalation inactive during the demo. Object changes may require database
configuration. Use the release manifest when demonstrating those changes so its database
configuration step runs after the object declaration.

The automated `complete` case still verifies deployment and removal, not customer edits or retention.
It removes the records before returning, so use the manual sequence above to leave them available
for inspection. Scripts, inspection forms, presentations and indexes do not support `_retain`.

## Not covered

- BIRT reports.
- Synonym domains, which Maximo does not let a deployment create or delete.
- Inspection form scripts.
