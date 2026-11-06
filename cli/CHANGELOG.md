# Release Notes
## 1.31.1
- Changes in the core logic: see the [Maximo Developer Tools release notes](https://github.com/naviam-io/vscode-autoscript-deploy/blob/main/CHANGELOG.md#1311).
- The product is now named Maximo Developer Tools everywhere, including in the CLI output, instead of Maximo Development Tools or Naviam Developer Tools in some places.

## 1.31.0
- Changes in the core logic: see the [Maximo Developer Tools release notes](https://github.com/naviam-io/vscode-autoscript-deploy/blob/main/CHANGELOG.md#1310).
- The CLI is now published as `@naviam/maximo-dev-tools`. The unscoped `maximo-dev-tools` package is deprecated; run `npm uninstall -g maximo-dev-tools && npm install -g @naviam/maximo-dev-tools`. The command is still `maximo-dev-tools`.
- The CLI is now developed in the Maximo Development Tools repository and released together with the VS Code extension, so its version jumps from 1.22.1 to match the extension's.
- The published package now includes the generated Nashorn library, which 1.22.1 omitted, and installs the same server scripts as the extension.
- Fixed logging in with an API key and no user name and password, which Maximo rejected because the CLI also sent empty Maximo and basic credentials.
- The CLI now runs on the same client code as the VS Code extension, so it deploys and extracts the same way.
- Deploy supports TypeScript, JSON configuration files, and manifests with `kind`, `disabled` and validation before anything is deployed.
- Extract supports JSON configuration types and DBC, and selects items with `--name`.
- New deploy options: `--allowEsigDisable` and `--retainedSnapshots restore|discard`. New global option: `--verbose`.
- The exit code is `1` when any file fails to deploy, a deletion fails, or a decision such as admin mode was needed but not allowed.
- `--deleteAll` is refused when any file fails to deploy.
- Fixed `--ca`, which failed before connecting.
- Fixed `--key`, which was ignored. A settings file encrypted with the old key beside it still decrypts, with a warning.
- Fixed `--deleteList`, which did not accept a file path.
- Fixed a `deploy`, `extract` or `log` object in the settings file replacing that command's defaults instead of merging with them.
- Fixed server errors while applying configuration not being shown.
- `log` stops cleanly on Ctrl+C.

## 1.22.1
- Aligned with latest release of the VS Code tools. Migrated to Naviam.
  
## 1.19.2
- Fixed minor issue with an incorrect error message when deploying a configuration json.

## 1.19.1
- Added support for .jy files, updated version to match VS Code.
  
## 1.18.0
- Fixes to log handling.
- Progress handling for long running deployment objects.
  
## 1.17.1 
- Add better error response handling.
  
## 1.17.0
- Add support for configuration time outs.
- Add support for CSRF
  
## 1.15.8
- Allow for timeouts greater than 300 seconds.

## 1.15.7
- Jump to 1.15.7 to match VS Code, add better support for detecting language.
  
## 1.15.4
- Add support for report extract and deploy.  All fixes from the VS Code extensions included.
  
## 1.14.3
- Updated security to ensure only users with SHARPTREE_UTILS : DEPLOYSCRIPT can perform deploy actions.
  
## 1.14.2
- Added support for deploying Maximo database objects with a script.
  
## 1.13.9
- Fixed deployment issues with script and launch point variables.
  
## 1.13.7
- Added fallback support for importing screens where the PresentationLoader is not available.
  
## 1.13.2
- Aligned version number to match VS Code extension version.
- Fixed screen integration with MAS 8.6

## 1.4.1
- Bug fixes.

## 1.4.0
- Add support for JSON companion objects to match VS Code extension 1.13

## 1.3.1
- Automatically delete deploy script unless explicitly stated otherwise.

## 1.3.0
- Updated with Inspection form publishing and support for automatic deploy script invocation.

## 1.2.0
- Updated with Form and Screen extract and publishing. Compatible with version 1.8.2 of the VS Code plugin.

## 1.1.0
- Updated to be compatible with version 1.7.0 of the VS Code plugin.
  
## 1.0.5 
- Fixed bug that required the default settings.json file to be present.

## 1.0.1 - 1.0.4 
- Documentation and deployment pipeline fixes.

## 1.0.0
- Initial release of the Sharptree VS Code Automation Script Deployment Utility.