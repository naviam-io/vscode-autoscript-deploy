# Introduction

These scripts are common between the VS Code Maximo Developer Tools extension and the NPM Maximo Developer Command Line Tools. The two projects reference them via a sub-repository.

# Scripts

The following is a description of the scripts.

| Script                    | Description                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| naviam.autoscript.admin   | Handles putting the server in Admin Mode and managing administrative functions                                                      |
| naviam.autoscript.deploy  | Primary script that handles deploying various object types.                                                                         |
| naviam.autoscript.extract | Extracts objects from the Maximo system in a format applicable for the Maximo Developer Tools, often adding the required meta-data. |
| naviam.autoscript.form    | Handles operations involving the Maximo Inspection Forms.                                                                           |
| naviam.autoscript.install | The bootstrap script that creates in initial Maximo objects needed by the Maximo Developer Tools.                                   |
| naviam.autoscript.library | A library of functions for installing various Maximo objects.                                                                       |
| naviam.autoscript.logging | Provides support for streaming the Maximo log to the either VS Code of command line tools.                                          |
| naviam.autoscript.migrate | Migrates legacy Sharptree configurations and scripts to the new Naviam scripts.                                                     |
| naviam.autoscript.report  | Handles operations involving extracting and publish BIRT reports.                                                                   |
| naviam.autoscript.screens | Handles operations involving extracting and publishing the Maximo XML screen definitions                                            |
