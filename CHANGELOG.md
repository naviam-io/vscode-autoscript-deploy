# Release Notes
## 1.30.0
### Retaining customer values
- Cron tasks now support `_retain`, so redeploying a product's cron task no longer overwrites the values the customer tuned, such as a schedule, the active flag or a parameter value. Naming a collection, for example `"_retain": ["cronTaskInstance"]`, also preserves the instances the customer added that the deployed file does not declare.
- Domains now support `_retain`, so redeploying a product's domain no longer wipes the values the customer tuned. Naming a value collection, for example `"_retain": ["alnDomain"]`, also preserves the values the customer added that the deployed file does not declare.
- If an earlier deployment that used `_retain` failed, the next deployment asks whether to restore the customer values saved by that deployment or discard them. Dismissing the prompt cancels the deployment before anything is changed.

### Deployment manifests
- Manifest entries may now declare a `kind`: `configuration`, `databaseConfiguration`, `automationScript`, `deployScript`, `inspectionForm`, `screen`, `report` or `manifest`. An entry is then deployed as exactly that kind, without its predeploy and deploy companion files. A `deployScript` entry is installed, run once and removed again.
- Manifests may include other manifests, and TypeScript entries are now built and deployed instead of being ignored.
- A manifest entry may set `"disabled": true` to skip it without removing it. Disabling a `manifest` entry skips everything in the nested manifest.
- Added `manifest-schema.json` for editor validation of `*.manifest.json` and `*-manifest.json` files.
- A manifest is now validated in full before anything is sent to Maximo, and deployment stops at the first entry that fails or whose file does not exist, instead of skipping it silently.
- Manifest entries that declare no `kind` are deprecated. They still deploy as before, but a notification and the log name each such entry.
- Fixed manifest entry paths being resolved against the working directory instead of the manifest's own directory.
- Fixed a manifest being deployed as configuration when it contained a configuration property.

### TypeScript projects
- The `Initialize Maximo TypeScript Project` command is now available to everyone from the Command Palette.
- The TypeScript project template now builds every script in the project with one webpack config. Each file that declares a `scriptConfig` becomes its own script, and development and production builds are kept in separate folders.
- Deploying a TypeScript file now always deploys the script webpack built from it. Deploying a helper file that is only imported by other scripts now shows an error naming the script to deploy instead.
- Fixed launch point settings, such as whether a launch point is active, being lost from production builds. The template now also includes the missing `terser-webpack-plugin` dependency.
- Fixed deploying from a freshly cloned project failing with a misleading error, because the project dependencies were not installed first.
- Fixed the predeploy and deploy companion files of a TypeScript script not being deployed.

### Automation scripts
- Applying database configuration no longer hangs when e-signature is enabled for the "Manage Admin Mode" or "Apply Configuration Changes" options. The extension offers to disable e-signature for these options temporarily and restores the original settings afterwards.
- Objects declared under `objects` in a script's deploy configuration now trigger a database configuration, as they already did in the predeploy configuration and under the legacy `maxObjects` key.
- Fixed a property declared in a `scriptConfig` being created with an empty value until the script was deployed a second time. `initialPropValue` now sets the value of a new property, as documented.
- Fixed a script being deployed without its variables or launch points when the `autoScriptVars` or `scriptLaunchPoints` keys in its `scriptConfig` were not quoted.
- Fixed a script failing to deploy when it used a variable named `scriptConfig` for another purpose.
- Fixed deleting an automation script that does not exist creating a stray Draft script instead.
- Fixed an already applied predeploy configuration being reported as a failure, which skipped the script deployment.

### Configuration deployment and extraction
- Configuration now deploys and extracts correctly on a Maximo whose base language is not English. Values such as action types, cron task access levels, domain types and property security levels are translated to and from their localized form.
- Configuration attributes that the target Maximo version does not have are now skipped and noted in the log, instead of failing the deployment.
- Any JSON file that is not a manifest or an inspection form is now deployed as configuration.
- Extracting configuration from an open JSON file now writes into that file even when it has no companion automation script. When the open file is a manifest or an inspection form, the result is copied to the clipboard instead.
- Fixed table domains, which could be neither deployed nor extracted.
- Fixed number range domain values being extracted in the server's number format, such as `1,000`. They are now extracted as numbers.
- Fixed extracting a synonym domain value with conditions.
- Fixed extracted loggers turning a child logger into a root logger on redeployment, and extracted messages missing the operator response.
- Fixed adding OSLC actions, queries and query templates to a new object structure on MAS 9, and setting the query template sort order on MAS 8.11.
- Fixed deploying `MIGRATIONMGR` object structures, where the flat supported flag is read only.
- Fixed application authorizations of integration objects (`objectAppAuth`). They are now added or updated correctly and never removed, because other integration objects may share them.
- Fixed redeploying an object that was previously deleted, deleting a message, and setting a query owner.
- Fixed deploying actions of type `APPACTION`, deleting integration objects, and escalation fields being cleared when omitted.
- Fixed deploy schema errors for integration objects and crossover domains.

### MCP server
- Removed the bundled local MCP server. The extension no longer decrypts a server into the workspace or writes a `maximo` entry to `.vscode/mcp.json`; it registers an MCP server definition that points VS Code at the Maximo MCP script instead, and keeps it current whether the environment comes from `.devtools-config.json` or the `naviam.*` settings. The server is only offered where the `NAVIAM.MCP` automation script is installed and active; otherwise starting it explains why and it is hidden until `Refresh Maximo MCP Server` is run.

### General
- BIRT report extraction now shows a clear error message naming each report that failed and why.
- Configuration, inspection form, screen and report deployments now report failures consistently.
- Modal dialogs no longer show a "No" button that duplicates "Cancel".

## 1.29.7
- Fixed domain validation errors when adding new object attributes

## 1.29.6
- Added missing schema properties: `loadDefaultAttributes`, `searchType`, `multilanguageSupported`.
- Fixed incorrect guards that prevented setting the correct cookie domain length.
- Reference source schema files directly instead of copies checked into the repo.

## 1.29.5
- Release to update publish token.
  
## 1.29.4
- Fixed non-English primary language support for creating system properties.

## 1.29.3
- Updated the library scripts to fix pre-deploy issues.
  
## 1.29.2
- Reinstated JSON predeploy support for Maximo objects.
- Fixed property deployment errors related to instance only handling.
- Fixed logger deployment errors related to parent-child logger relations.
- Updated pre-deployment and deployment schemas for consistency.
- Improved JSON configuration deployment error handling so streamed deployment errors are surfaced consistently.
- Fixed script deployment flow to stop after database configuration is deferred or declined.
- Fixed session cookie handling for Maximo/MAS responses that return an incorrect cookie domain.

## 1.29.1
- Improved VS Code logging for all commands.

## 1.29.0
- Added JSON deploy and extract support for actions, escalations and queries.
- Migrated the shared JSON deployment library to TypeScript.
- Updated TypeScript project templates and deployment handling for the shared library build.
- Updated JSON key for integration objects to `integrationObjects`, dropped support for the shorter `intObjects` key for consistency.
- Updated JSON deploy delete markers to use `_delete`, dropped support for `delete` key for consistency.
- Fixed TypeScript definition references used by generated projects.

## 1.28.3
- Add annotation support for maximoGlobal
- Add support for multiple TypeScript files
- Fixed compile time path encoding for MCP

## 1.28.2
- Update MCP with general query capabilities.
  
## 1.28.1
- Change how environment variables are passed to the MCP.
  
## 1.28.0
- Added support for Maximo MCP
  
## 1.27.15
- Fixed manage-facade.d.ts.zip file handling.

## 1.27.14
- Added stable anchors for documentation
- Fixed dependency on the zip utility being on the system path.
  
## 1.27.13
- Fixed index handling.
- Fixed child logger handling.
  
## 1.27.12
- Minor fix for debugging interface scripts.
- Allow deploying type script files from any .ts file in the project.
  
## 1.27.11 
- Compressed typescript definitions for GitHub publishing.

## 1.27.10
- Missed version
  
## 1.27.9
- Fixed pipeline issue with publishing to GitHub
  
## 1.27.9
- Fixed missing version number bump for debug jar.
  
## 1.27.8
- Fixed issues with missing .version file and caught/uncaught exception handling.
  
## 1.27.7
- Add support for Maximo types within TypeScript projects.
  
## 1.27.6
- Handle caught and uncaught exceptions.
  
## 1.27.5
- Remote debugging documentation.
  
## 1.27.4
- Added trace level logging and moved common client error handling to trace.
- Fixed webpack resolution
- Fixed property fetching and branch name resolution.

## 1.27.3
- Fixed issue where webpack had to be installed globally.

## 1.27.2
- Push to fix pipeline publishing, no changes to the extension.
  
## 1.27.1
- Minor fixes for installation of properties.
  
## 1.27.0
- Added remote debugging for automation scripts.
- Fixed issue with low activity systems when log streaming.
- Fixed issue with deploying inspection forms.
   
## 1.26.2
- Update the TypeScript templates.
  
## 1.26.1
- Fixed missing jsconfig.json from the extension package.

## 1.26.0
- Add support for creating TypeScript automation script projects.
  
## 1.25.0
- Add support for direct TypeScript deploys.
- Add support for local manage containers.
  
## 1.24.6
- Add experimental support for webpack and TypeScript files.
  
## 1.24.5
- Fixed issue where an Abort error was shown if the progress object was unavailable.
  
## 1.24.4
- Fixed issue with copying the DTD file to the dbc file directory on Windows.

## 1.24.3
- Add support for DBC extract location.
- Fixed external system extract list (was displaying enterprise services)
  
## 1.24.2
- Fixes for EAM when using a user name and password.
## 1.24.1
- Updated dependencies to latest versions.
## 1.24.0
- Added support for extracting DBC files.
- Added support for extracting JSON configuration files.
- Added multi-type select where each type displays a list of available files.
  
## 1.23.1
- Fixed missing cases with json schemas
- Updated logo
  
## 1.23.0
- Add support for selecting the server to stream a log from.
- Add support for schema validations for configuration and deployment JSON files.
- Fixed bug in MAS 9 deployment when creating the logger.
  
## 1.22.2
- Finally updated to Axios 1.10 to resolve security issues.
- Restore GitHub publishing with new `naviam-io` organization.
  
## 1.22.1
- Fixed issue where submodules were not included in the final package.
- Fixed issue with incorrect mapping of launch point types.
- Fixed issue with unbound xml variable deploying screens.
  
## 1.22.0
- Migrated to Naviam branding and scripts.
  
## 1.21.3
- Fixed issue with deployment script for adding a table domain.
  
## 1.21.2
- Fixed table domain handling and property refreshing.
  
## 1.20.1
- Fixed bug that caused reports to be extracted to the forms extraction folder. Thank you to Jason Pun for pointing this out.
  
## 1.20.0
- Add support for manifest files to specify multiple files to deploy at once.
- Fixed case comparison of object attributes.
- Fixed issue where an object description was required otherwise the object description would be removed.
- Fixed screen deployment to finally not require a WebClientSession object, which has been a source of issues forever.
- Allow Table Domain types to be created against a non-existent table that is created as part of the deployment.
- Fixed bug that caused the extension to fail to load if a folder was not selected on load.
- Removed references to Nashorn and switched to the more generic "javascript"
- Add support for "object" instead of "maxObject" in deployment descriptor to be more consistent
  
## 1.19.2
- Fixed issue where single environment configurations would not encrypt the password on save.
- Added extract support for the allowInvokingScriptFunctions (INTERFACE) attribute.
- Added support for automatically setting the allowInvokingScriptFunctions (INTERFACE) attribute to true for APPBEAN and DATABEAN scripts.
  
## 1.19.1
- Add support for jy Python files.
  
## 1.19.0
- Multiple environment configurations selection support.

## 1.18.0
- Deployments are now cancellable.
- Logging handles disconnects properly.
- Deployment scripts can now provide progress updates using the deployId.
  
## 1.17.3
- Support for MAS 9 log streaming.
- Handling for cleaning up log streaming sessions if a client disconnects unexpectedly.
  
## 1.17.2
- Fixed CSRF handling during the installation bootstrap process.
  
## 1.17.1
- Enhanced error reporting on long running configuration tasks.
  
## 1.17.0
- Add support for specifying a configuration script timeout.
- Add CSRF support.
  
## 1.16.0
- Fixed reports.xml multilookup value from true/false to 1/0
- Added support for specifying a proxy.
- Added support for non-English script status.
## 1.15.9
- Fixed a bug with MaxVars handling (again).
  
## 1.15.8
- Add domains, added support for Allow Invoking Script Functions? and fixed a bug with MaxVars handling.
  
## 1.15.7
- Provide more flexible source fetching with fallback to check language.

## 1.15.6
- Added compatibility to use MXAPIAUTOSCRIPT if MXSCRIPT is not available.
  
## 1.15.5
- Fixed error with deployment file path errors.
  
## 1.15.4
- Fixed errors related to toolbar position defaulting to zero.
- Added nicer support for missing design files in Maximo.

## 1.15.3
- Fixed defaults for dploc, qlloc and padloc to be NONE since it is missing from some of the out of the box reports.xml files.

## 1.15.2
- Fixed export formatting issues that could cause problems with re-imports.
- Added application name to selection list.
  
## 1.15.1
- Documentation updates.
  
## 1.15.0
- Significant code restructuring to better accommodate future command modules.
- Add support for exporting and importing BIRT reports.
  
## 1.14.4
- Remove Maximo version check because all versions are now supported.
- Minor documentation updated.
  
## 1.14.3
- Updated security to ensure only users with SHARPTREE_UTILS : DEPLOYSCRIPT can perform deploy actions.
  
## 1.14.2
- Minor change so deploy script returns the deployed script's name for the command line tools.
  
## 1.14.1
- Fixed incorrect handling for service, persistent and alternative indexes.
  
## 1.14.0
- Added support for apply Maximo object configurations including placing the server in Admin Mode and running Database Configuration
  
## 1.13.9
- Minor fix for Launch Point variable overrides to ensure the override checkbox is checked and the value updated.
  
## 1.13.8
- Fixed issue with LITERAL script variables. Thanks to Jared Schrag [https://github.com/jaredschrag](https://github.com/jaredschrag) for helping trouble shoot this issue.

## 1.13.7
- Emergency rollback of incompatible axios version.
  
## 1.13.6
- Added fallback support for importing screens where the PresentationLoader is not available.
  
## 1.13.5
- Added support for Maximo Manage stand alone development instance.
- Fixed bug with the MaxAuth Only option being ignored.
- Fixed bug that required deploying the selected script again if an install or upgrade was required.
  
## 1.13.3
- Added support for naming a deployment script with a `.deploy` in addition to `-deploy` for naming consistency.
  
## 1.13.3
- Added support for MAS 8.11

## 1.13.2
- Added support for JDOM2 as JDOM was removed from 8.6 for screen extracting.

## 1.13.1
- Script deploy fix
- MAS / 7.6 inspection form compatibility fix.

## 1.13.0
- Add support for JSON deployment object definitions.
- Minor fixes to the Inspection form handling for differences between versions of Maximo.
- Minor snippet fixes.

## 1.12.0
- Add snippets support.

## 1.11.0
- Add the ability to extract single scripts, screens and forms.
- Removed dependency on DigestUtils which was not available in all versions and patch levels.
- Fixed bug with importing inspection forms with more than one file upload questions.
  
## 1.10.1
- Remove the deploy script by default after the deployment completes.
  
## 1.10.0
- Add support for .devools-config.json local configuration file.
- Fixed issue with cookie handling with the latest release of MAS8
  
## 1.9.0
- Add support for onDeployScript and automatic use of .DEPLOY extension scripts.
- Add support for automatically deploying scripts with the same name as the primary script, with a `-deploy` suffix.

## 1.8.5
- Fixed script version numbering.

## 1.8.4
- Add the `request` implicit variable to the `onDeploy` context.

## 1.8.3
- Fixed issue with extracting inspection forms with names that include path characters.
- Fixed issue with support for missing AUDIOCACHE attributes.
- Fixed incorrect messages for exporting forms.

## 1.8.2
- Fixed issue where inspection form null integer values were being exported as zeros instead of null.
  
## 1.8.1
- Add support for extracting and deploying inspection domains and signatures.
  
## 1.8.0
- Add support for extracting and deploying inspection forms.
  
## 1.7.0
- Fixed bug in python scriptConfig parser that would find the scriptConfig even if it was commented out.
- Add support for specifying maxvar, properties and maxmessages values in the scriptConfig.
  
## 1.6.4
- Fixed typo in documentation.
- Removed debug console.log and System.out statements.

## 1.6.3
- Compatibility fixes for Maximo Manage 8.5.
- Fixed log header issue that caused log streaming to fail prematurely.

## 1.6.2 
- Updated dependencies to address security bulletins.
  
## 1.6.1
- Fixed error that could occur when applying the log level as part of the initial install.
  
## 1.6.0
- Added support for exporting screen definition conditional properties.
- Added support for Log4j 2, for Maximo environments that have been patched for Log4Shell.
  
## 1.5.1 
- Added support for systemlib presentation XML.
  
## 1.5.0
- Added support for screen extract and deploy.
- Added tag Id generation shortcut.
- Updated documentation and screen shots.
  
## 1.4.0 
- Added log streaming to local file.
- Bug fixes

## 1.3.0
- Added api/script context support.  
  
## 1.2.0
- Added support for API Key authentication.
  
## 1.1.1 
- Fixed missing check for action
  
## 1.1.0
- Add source comparison with the server.
- Fix action name missing from extract.
    
## 1.0.26
- Replace Filbert Python/Jython parsing library with regex to extract the config string.

## 1.0.25
- Allow for only sending the Maxauth header.
  
## 1.0.24
- Change to dark theme.
  
## 1.0.23
- Documentation edits.
- Updated icon.
- Updated banner theme.
- Move change log to CHANGELOG.md

## 1.0.22
- Add feature for defining an `onDeploy` function that will be called when the script is deployed.

## 1.0.21
- Fixed error when extracting scripts with spaces in the name.

## 1.0.20
- Documentation update.
  
## 1.0.19
- Documentation updates.
- Prettier configuration details for preserving property quotes.
  
## 1.0.18
- Replaced Authentication Type setting with automatic detection of the authentication type.
  
## 1.0.16 / 17
- Fixed formatting of the Automation Scripts table.
- Fixed untrusted SSL handling.
- Added custom CA setting and handling.

## 1.0.15 
- Documentation fixes.  

## 1.0.14
- Documentation updates and build pipeline testing.

## 1.0.13
- Documentation updates.
  
## 1.0.12
- MAS 8 with OIDC login support.
- Fixes for Form based login.
  
## 1.0.11
- Updated documentation with Python / Jython example.
  
## 1.0.10
- Fixed Windows path handling.

## 1.0.9
- Fixed paging size
- Fixed extract script naming issue.
  
## 1.0.8
- Moved the version dependency back to 1.46.

## 1.0.7
- Added extract script functionality.

## 1.0.6

- Fixed checks for attribute launch points.
- Added setting for network timeout.
- Fixed try / catch / finally Python parsing support.
  
## 1.0.4

- Added Python support.
- Added deployment tracking.
  
## 1.0.3

- Added context support.
- Added automatic upgrade path support.

## 1.0.2

- Removed check for Java version due to permission issues checking Maximo JVM information.

## 1.0.1

- Add checks for supported versions of Maximo and Java.
- Improve deployment progress feedback.
- Fixed compatibility issue with Maximo versions prior to 7.6.1.2.

## 1.0.0

- Initial release of the Sharptree VS Code Automation Script Deployment Utility.
