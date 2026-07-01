# Release Notes
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
