# Release Notes
## 1.6.0
- Script variables are now named with `varName`, consistent with launch point variables. `varname` is still accepted but returns a deprecation warning to the client, a variable without a name fails the deployment instead of being skipped, and extraction writes `varName`.
- Value list fields of the JSON configuration take the localized value of the target Maximo again, and extraction writes the stored localized value, reverting the internal values introduced in 1.5.0. A field also accepts an internal value written as `!VALUE!`, for example `!MAXTABLE!`, which deploys to the target's default localized value, and an unknown internal value fails the deployment with a message naming the value and the synonym domain.
- The synonym domain helpers and the retained values snapshot requests are shared from the library, so the deploy and objects scripts no longer keep their own copies.
- Fixed a script variable without a `varBindingType` or `varType` failing the deployment. It is now created as a literal input.
- Fixed installing the developer tools on a Maximo whose base language is not English failing when the `NAVIAM_UTILS` integration object is created.

## 1.5.0
- Added a generic retained values engine, and cron tasks now support `_retain`, so redeploying a cron task keeps the values the customer tuned and, when a collection is named, the instances the customer added. The existing record is captured as a snapshot before it is replaced, and the snapshot is discarded only once the deployment has succeeded, so a retry recovers from a failed run.
- Domains now support `_retain`, so redeploying a domain keeps the values the customer tuned and, when a value collection is named, the values the customer added.
- Added the `snapshots/list` and `snapshots/discard` deploy actions, which report and remove retained values snapshots left behind by a failed deployment.
- Added a `deployscript` action that installs a script, runs it once synchronously and removes it again whether it succeeded or failed. It backs the `deployScript` kind of a deployment manifest entry.
- Added support for reading and updating the e-signature setting of sigoptions, so admin mode can be applied when e-signature is enabled.
- Synonym domain values are now translated between their internal and localized values on deployment and extraction, so configuration deploys and round trips on a Maximo whose base language is not English.
- Attributes that the Maximo version does not have are now skipped with an info log entry instead of failing the deployment.
- Number range domain values are now extracted as numbers instead of locale formatted strings.
- Fixed a property declared in a `scriptConfig` being created with an empty value, and `initialPropValue` never being applied.
- Fixed unquoted `autoScriptVars` and `scriptLaunchPoints` keys in a `scriptConfig` being ignored, and a script failing to deploy when it used a variable named `scriptConfig` for its own purposes.
- Fixed deleting an automation script that does not exist creating it instead.
- Fixed table domains, which could be neither deployed nor extracted because the domain type is `MAXTABLE`. Extraction now includes every field deployment accepts, including the logger `parentLogKey` and the message `operatorResponse`.
- Fixed extracting a synonym domain value with conditions, and setting the query template sort order on MAS 8.11.
- Fixed adding OSLC actions, queries and query templates to a new object structure on MAS 9, which failed with "mosInfo is null".
- Fixed the error with `FLATSUPPORTED` being read only for `MIGRATIONMGR` object structures.
- Fixed integration object application authorizations, which are now added or updated correctly and never removed, because they can be shared.
- Fixed redeploying an object that was previously deleted, deleting a message without its value, and setting a query owner.
- Fixed deploying actions of type `APPACTION`, deleting integration objects, and escalation fields being cleared when omitted.
- Fixed the retained values snapshot and the legacy script property security level failing validation on a Maximo whose base language is not English.

## 1.4.5
- Fix: set the domain after MAXTYPE and LENGTH for domain validation to succeed on new attributes

## 1.4.4
- Fix: make MAXSYSINDEXES.STORAGEPARTITION optional
- Fix: remove incorrect guards preventing setting correct domain length
- Add support for loadDefaultAttributes object property (defaults to true) - allows disabling creation of default attributes: unique id, description, hasld, longdescription

## 1.4.3
- Fixed error when installing in non-English primary language systems
  
## 1.4.2
- Fixed error where ENTITYNAME and CLASSNAME were removed if not specified.
  
## 1.4.1
- Reinstated JSON predeploy support for Maximo objects.
- Fixed property deployment errors related to instance only handling.
- Fixed logger deployment errors related to parent-child logger relations.

## 1.4.0
- Rebuilt the shared deployment library from TypeScript sources.
- Support for cron tasks, domains, loggers, integration objects, messages and properties was converted to TypeScript.
- Added JSON deploy support for actions, escalations and queries.
- Improved server-sent deployment progress events for consistency.
- Updated JSON deploy delete markers to use `_delete`, dropped support for `delete` key for consistency.

## 1.3.3
- Fixed index handling.
- Fixed child loggers.
  
## 1.3.2
- Fixed property installation process.
  
## 1.3.1
- Fixed installation of properties.
  
## 1.3.0
- Add support for remote debugging.
  
## 1.2.1
- Add support for deploying TypeScript compiled scripts directly.
  
## 1.2.0
- Added support for DBC and JSON extract
  
## 1.1.0 
- Added log streaming for selected server pod.
  
## 1.0.1
- Fixed issue with launch point type mapping.
- Fixed issue with undeclared `xml` variable.
  
## 1.0.0
- Initial release of Naviam branded deployment scripts in a shared repository.
