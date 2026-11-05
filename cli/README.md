> The CLI is developed in the [Maximo Development Tools repository](https://github.com/naviam-io/vscode-autoscript-deploy/tree/main/cli) and released together with the VS Code extension, so its version matches the extension's.

# Introduction

The Maximo Development Tools command line, by [Naviam](https://www.naviam.io), develops and deploys Maximo automation scripts and other customizations from a terminal or a pipeline. It is the command line companion to the Maximo Development Tools Visual Studio Code extension: [https://marketplace.visualstudio.com/items?itemName=sharptree.maximo-script-deploy](https://marketplace.visualstudio.com/items?itemName=sharptree.maximo-script-deploy).

# Install

Node.js 20 or later is required. Using npm:

```bash
$ npm install -g @naviam/maximo-dev-tools
$ maximo-dev-tools --version
```

Or run it without installing, for example in a pipeline:

```bash
$ npx @naviam/maximo-dev-tools@latest deploy --settings settings.json
```

The package installs the `maximo-dev-tools` command. The CLI installs and upgrades its own automation scripts (`naviam.autoscript.*`) in Maximo on the first connection, as the VS Code extension does. Pass `--install false` to skip that, in which case the run fails if the scripts are missing or out of date.

## Upgrading from `maximo-dev-tools`

Up to version 1.22.1 the CLI was published as the unscoped `maximo-dev-tools` package, which is deprecated. Both packages install the same `maximo-dev-tools` command, so remove the old package first:

```bash
$ npm uninstall -g maximo-dev-tools
$ npm install -g @naviam/maximo-dev-tools
```

In a pipeline, replace `npx maximo-dev-tools` with `npx @naviam/maximo-dev-tools`. The commands, options and settings file are otherwise the same.

# Authentication

The CLI authenticates with either an API key or a user name and password.

- **API key**: `--apikey`, or `apikey` in the settings file. When an API key is given, the user name and password are ignored.
- **User name and password**: `--username` and `--password`. Both Maximo native (`maxauth`) and HTTP basic credentials are sent, so it works with either authentication. Pass `--maxauth` to send only Maximo native credentials.

Prefer a settings file over passing secrets on the command line, where they remain in the shell history and the process list. Encrypt the secrets in it with the `encrypt` command:

```bash
$ maximo-dev-tools encrypt --settings settings.json
```

This replaces the plain text `password` and `apikey` in the file with encrypted values, and creates the key file `.settings.json.key` beside it (see `--key`). Keep both files out of source control.

For a server with a self-signed certificate, pass its certificate authority with `--ca`, or, for testing only, `--allow-untrusted-certs`.

# Quick start

A minimal `settings.json`:

```json
{
    "host": "maximo.example.com",
    "apikey": "<your API key>"
}
```

```bash
# Deploy every script, screen, report, form, manifest and configuration file in ./src
$ maximo-dev-tools deploy --settings settings.json --directory ./src

# Deploy a single file
$ maximo-dev-tools deploy --settings settings.json --file ./src/example.js

# Extract every automation script, or named screens
$ maximo-dev-tools extract --settings settings.json --directory ./scripts
$ maximo-dev-tools extract --settings settings.json --type screen --name WOTRACK --directory ./screens

# Stream the Maximo log to a file until Ctrl+C
$ maximo-dev-tools log --settings settings.json > maximo.log
```

Run `maximo-dev-tools <command> --help` for every option of a command. They are listed below.

# Settings

The configuration settings can be provided as command line arguments or in a settings JSON file or a combination of the two. The command line arguments override the values provided in the settings JSON file.

## Command Line Arguments

### Global

The following table provides the available global arguments.

| Argument                   | Default            | Description                                                                                                                        |
| :------------------------- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| --allow-untrusted-certs    | false              | Allow untrusted or invalid SSL certificates. Useful for testing when using self signed certificates, default is false.             |
| --apikey &#124; -a         |                    | The Maximo API key that will be used to access Maximo. If provided, the user name and password are ignored if configured.          |
| --ca                       |                    | Path to the Maximo server certificate authority (CA) if it is not part of the system CA chain.                                     |
| --context &#124; -c        | maximo             | The part of the URL that follows the hostname, default is `maximo`.                                                                |
| --host &#124; -h           |                    | The Maximo host name or IP address _without_ the http/s protocol prefix.                                                           |
| --install &#124; -i        | true               | Indicates if the utility scripts should install and upgrade automatically, default is true.                                        |
| --key &#124; -k            | .settings.json.key | The path to the encryption key for the settings encrypted values. A relative path is relative to the settings.json file directory. |
| --maxauth                  | false              | Force native Maximo authentication, default is false.                                                                              |
| --password &#124; --passwd |                    | The Maximo user password.                                                                                                          |
| --port &#124; -p           | 80 / 443           | The Maximo server port, defaults to 80 if the --ssl argument is false, 443 if the --ssl argument is true.                          |
| --settings &#124; -s       | settings.json      | The path to the settings file, default is settings.json.                                                                           |
| --ssl                      | true               | Indicates if SSL will be used, defaults to true.                                                                                   |
| --timeout &#124; -t        | 30                 | The connection timeout in seconds, default is 30 seconds.                                                                          |
| --username &#124; -u       |                    | The maximo user name.                                                                                                              |
| --verbose &#124; -v        | false              | Write the diagnostic log to stderr.                                                                                                |
| --help                     |                    | Prints the help information.                                                                                                       |
| --version                  |                    | Prints the version number.                                                                                                         |

### Encrypt

The `encrypt` command encrypts the plain text password and API key values in the settings file. There are no additional arguments for the `encrypt` command.

### Extract

The `extract` command extracts scripts, screens, inspection forms, reports, JSON configuration or DBC from the target Maximo system to a local directory.

| Argument              | Default       | Description                                                                                                                          |
| :-------------------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------------- |
| --directory &#124; -d | ./            | The directory to extract to, default is the current directory.                                                                       |
| --overwrite &#124; -o | true          | Overwrite existing files that differ from the server. With `false`, an existing configuration or DBC file is left alone.             |
| --type                | script        | `script`, `screen`, `form`, `report`, `dbc`, or a JSON configuration type such as `messages`, `properties` or `cronTasks`.           |
| --name &#124; -n      |               | The name of an item to extract; repeat for several. Without it, every item of the type is extracted.                                 |
| --file &#124; -f      | `<type>.json` | The file to write, relative to `--directory`. Required for `dbc`; for a configuration type the extracted records are merged into it. |
| --dbcType             |               | The kind of DBC to extract with `--type dbc`, such as `os`, `table`, `script`, `msg` or `attribute`.                                 |
| --where               |               | The condition selecting the rows for a `table` or `byos` DBC extract, which takes exactly one `--name`.                              |
| --object              |               | The object whose attributes an `attribute` DBC extract lists.                                                                        |

### Deploy

The `deploy` command deploys a single file, or every script, screen, report, inspection form, manifest and JSON configuration file in a directory, as the VS Code extension deploys them. TypeScript is built with the webpack project that holds it, and is deployed when named with `--file` or from a manifest.

| Argument              | Default     | Description                                                                                                                                    |
| :-------------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| --allowAdminMode      | false       | Allow the deployment to place the server in `Admin Mode` to apply a `Database Configuration`. This option may cause a system disruption.       |
| --allowEsigDisable    | false       | Allow the deployment to turn off electronic signatures for the database configuration while it is applied.                                     |
| --retainedSnapshots   |             | `restore` or `discard` a retained snapshot left by an earlier failed deployment. Without it, such a deployment stops.                          |
| --config-timeout      | 5           | The number of minutes to wait for a database configuration to complete.                                                                        |
| --deleteAll           | false       | Delete every script on the server that was not deployed from the directory. This is destructive, and is refused when any file fails to deploy. |
| --deleteList          | delete.json | Path to a JSON array of script names to delete from the server if they exist, relative to the current directory.                               |
| --directory &#124; -d | ./          | The directory to deploy from, default is the current directory.                                                                                |
| --file &#124; -f      |             | The path to a single file to deploy, if a relative path is provided it is relative to the --directory argument path.                           |
| --recursive &#124; -r | true        | Indicates if subdirectories will be included when deploying a directory, the default is true.                                                  |

The command exits with `1` when any file fails to deploy, a deletion fails, or a decision such as admin mode is needed but its option was not given.

### Log

The `log` command streams the Maximo log to the console until it is interrupted with Ctrl+C. This can then be piped to a file using the OS `> filename.log` command.

| Argument      | Default | Description                                                    |
| :------------ | :------ | :------------------------------------------------------------- |
| --log-timeout | 30      | Number of seconds between logging requests, the default is 30. |

## Settings File

A sample settings JSON file is provided below with the default values.

```json
{
    "allowUntrustedCerts": false,
    "apikey": undefined,
    "ca": undefined,
    "context": 'maximo',
    "maxauth": false,
    "host": undefined,
    "password": undefined,
    "port": 80|443,
    "ssl": true,
    "key": ".settings.json.key",
    "timeout": 30,
    "username": undefined,
    "install": true,
    "deploy": {
        "allowAdminMode": false,
        "allowEsigDisable": false,
        "retainedSnapshots": undefined,
        "configurationTimeout": 5,
        "file": undefined,
        "recursive": true,
        "directory": './',
        "deleteAll": false,
        "deleteList": "delete.json"
    },
    "extract": {
        "directory": "./",
        "overwrite": true,
        "type": "script",
        "name": undefined,
        "file": undefined,
        "dbcType": undefined,
        "where": undefined,
        "object": undefined
    },
    "log": {
        "timeout": 30
    }
}
```
