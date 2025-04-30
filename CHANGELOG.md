# Release Notes
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