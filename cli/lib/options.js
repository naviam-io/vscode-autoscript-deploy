/*
 * The command line grammar. Every option maps onto a settings file entry, see cli/README.md.
 */
import yargs from 'yargs';

import { DBC_TYPES } from '../../src/core/extract/extract-dbc.js';
import { RETAINED_SNAPSHOT_ANSWERS } from './configuration.js';

export const COMMANDS = Object.freeze(['deploy', 'encrypt', 'extract', 'log']);

const deploy = {
    command: 'deploy',
    desc: 'Deploy a single file, or every script, screen, report, inspection form, manifest and JSON configuration file in a directory.',
    builder: (command) =>
        command
            .option('allowAdminMode', {
                desc: 'Allow the deployment to place the server in Admin Mode to apply database configuration. This may cause a system disruption, the default is false.',
                type: 'boolean'
            })
            .option('allowEsigDisable', {
                desc: 'Allow the deployment to turn off electronic signatures for the database configuration while it is applied, the default is false.',
                type: 'boolean'
            })
            .option('retainedSnapshots', {
                desc: 'What to do with a retained snapshot from an earlier failed deployment: restore it or discard it. Without it, such a deployment stops.',
                type: 'string',
                choices: [...RETAINED_SNAPSHOT_ANSWERS]
            })
            .option('config-timeout', {
                desc: 'The number of minutes to wait for a database configuration to complete, the default is 5.',
                type: 'number'
            })
            .option('deleteAll', {
                desc: 'Delete every script on the server that was not deployed from the directory. This is destructive and is refused if any file fails to deploy, the default is false.',
                type: 'boolean'
            })
            .option('deleteList', {
                desc: 'Path to a JSON array of script names to delete from the server if they exist, relative to the current directory, the default is delete.json.',
                type: 'string'
            })
            .option('directory', {
                desc: 'The directory containing the files to deploy, the default is the current directory.',
                type: 'string',
                alias: 'd'
            })
            .option('file', {
                desc: 'A single file to deploy. A relative path is relative to the --directory path.',
                type: 'string',
                alias: 'f'
            })
            .option('recursive', {
                desc: 'Include subdirectories when deploying a directory, the default is true.',
                type: 'boolean',
                alias: 'r'
            })
};

const encrypt = {
    command: 'encrypt',
    desc: 'Encrypt the password and API key in the settings file.'
};

const extract = {
    command: 'extract',
    desc: 'Extract scripts, screens, inspection forms, reports, JSON configuration or DBC from Maximo to a local directory.',
    builder: (command) =>
        command
            .option('directory', {
                desc: 'The directory to extract to, the default is the current directory.',
                type: 'string',
                alias: 'd'
            })
            .option('overwrite', {
                desc: 'Overwrite existing files that differ from the server, the default is true.',
                type: 'boolean',
                alias: 'o'
            })
            .option('type', {
                desc: 'What to extract: script, screen, form, report, dbc, or a JSON configuration type such as messages or cronTasks. The default is script.',
                type: 'string'
            })
            .option('name', {
                desc: 'The name of an item to extract; repeat for several. Without it, every item of the type is extracted.',
                type: 'string',
                array: true,
                alias: 'n'
            })
            .option('file', {
                desc: 'The file to write, relative to --directory. Required for dbc; for JSON configuration the default is <type>.json.',
                type: 'string',
                alias: 'f'
            })
            .option('dbcType', {
                desc: 'The kind of DBC to extract when --type is dbc.',
                type: 'string',
                choices: DBC_TYPES.map((type) => type.group)
            })
            .option('where', {
                desc: 'The condition selecting the rows for a table or byos DBC extract.',
                type: 'string'
            })
            .option('object', {
                desc: 'The object whose attributes an attribute DBC extract lists.',
                type: 'string'
            })
};

const streamLog = {
    command: 'log',
    desc: 'Stream the Maximo log to the console until interrupted.',
    builder: (command) =>
        command.option('log-timeout', {
            desc: 'Number of seconds between logging requests, the default is 30.',
            type: 'number'
        })
};

/**
 * The parser for the arguments. A usage error is thrown rather than ending the process.
 */
export function buildParser(argv, version = 'unknown') {
    return yargs(argv)
        .version(version)
        .scriptName('maximo-dev-tools')
        .usage('Usage: $0 <command> [options]')
        .option('allow-untrusted-certs', { desc: 'Allow untrusted SSL certificates.', type: 'boolean' })
        .option('apikey', {
            desc: 'The Maximo API key used to access Maximo. When provided, the user name and password are ignored.',
            type: 'string',
            alias: 'a'
        })
        .option('ca', { desc: 'Path to the Maximo server certificate authority (CA) if it is not part of the system CA chain.', type: 'string' })
        .option('context', { desc: 'The part of the URL that follows the host name, the default is maximo.', type: 'string', alias: 'c' })
        .option('host', { desc: 'The Maximo host name or IP address *without* the http/s protocol prefix.', type: 'string', alias: 'h' })
        .option('install', { desc: 'Install and upgrade the utility scripts automatically, the default is true.', type: 'boolean', alias: 'i' })
        .option('key', {
            desc: 'The path to the key for the encrypted settings values, the default is .settings.json.key. A relative path is relative to the settings file directory.',
            type: 'string',
            alias: 'k'
        })
        .option('maxauth', { desc: 'Force native Maximo authentication, the default is false.', type: 'boolean' })
        .option('password', { desc: 'The Maximo user password.', type: 'string', alias: 'passwd' })
        .option('port', { desc: 'The Maximo server port, the default is 443 with --ssl and 80 without.', type: 'number', alias: 'p' })
        .option('settings', { desc: 'The path to the settings file, the default is settings.json.', type: 'string', alias: 's' })
        .option('ssl', { desc: 'Use SSL, the default is true.', type: 'boolean' })
        .option('timeout', { desc: 'The connection timeout in seconds, the default is 30.', type: 'number', alias: 't' })
        .option('username', { desc: 'The Maximo user name.', type: 'string', alias: 'u' })
        .option('verbose', { desc: 'Write the diagnostic log to stderr.', type: 'boolean', alias: 'v' })
        .command(deploy)
        .command(encrypt)
        .command(extract)
        .command(streamLog)
        .demandCommand(1, 1, `One of the commands ${COMMANDS.join(', ')} must be provided.`, `Only one command can be provided, one of ${COMMANDS.join(', ')}.`)
        .fail((message, error) => {
            if (message === 'Unknown argument: l') {
                throw new Error(message + ', did you use -ssl instead of --ssl?');
            }
            throw error || new Error(message);
        })
        .help()
        .strict();
}
