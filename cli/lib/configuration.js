import fs from 'fs';
import path from 'path';
import isValidHostname from 'is-valid-hostname';

import { CONFIGURATION_TYPES } from '../../src/core/extract/extract-configuration.js';
import { DBC_TYPES } from '../../src/core/extract/extract-dbc.js';

export const DEPLOYABLE_EXTENSIONS = Object.freeze(['.js', '.py', '.jy', '.ts', '.xml', '.json', '.rptdesign']);
export const FILE_EXTRACT_TYPES = Object.freeze(['script', 'screen', 'form', 'report']);
export const RETAINED_SNAPSHOT_ANSWERS = Object.freeze(['restore', 'discard']);

const DBC_TYPES_WITH_WHERE = ['table', 'byos'];

/**
 * The configuration type for an extract type, matched case-insensitively against its group.
 */
export function findConfigurationType(type) {
    if (typeof type !== 'string') {
        return undefined;
    }
    return CONFIGURATION_TYPES.find((candidate) => candidate.group.toLowerCase() === type.toLowerCase());
}

/**
 * The value for each setting: the command line first, then the settings file, which already carries the defaults.
 */
export function resolveConfiguration(command, args, settings, settingsFile) {
    const pick = (cli, setting) => (typeof cli !== 'undefined' ? cli : setting);

    const config = {
        command,
        settingsFile,
        verbose: Boolean(args.verbose),
        allowUntrustedCerts: pick(args['allow-untrusted-certs'], settings.allowUntrustedCerts),
        apikey: pick(args.apikey, settings.apikey),
        ca: pick(args.ca, settings.ca),
        context: pick(args.context, settings.context),
        maxauth: pick(args.maxauth, settings.maxauth),
        host: pick(args.host, settings.host),
        password: pick(args.password, settings.password),
        port: pick(args.port, settings.port),
        ssl: pick(args.ssl, settings.ssl),
        timeout: pick(args.timeout, settings.timeout),
        username: pick(args.username, settings.username),
        install: pick(args.install, settings.install),
        key: pick(args.key, settings.key)
    };

    switch (command) {
    case 'deploy':
        Object.assign(config, {
            file: pick(args.file, settings.deploy.file),
            recursive: pick(args.recursive, settings.deploy.recursive),
            directory: pick(args.directory, settings.deploy.directory),
            deleteAll: pick(args.deleteAll, settings.deploy.deleteAll),
            deleteList: pick(args.deleteList, settings.deploy.deleteList),
            allowAdminMode: pick(args.allowAdminMode, settings.deploy.allowAdminMode),
            allowEsigDisable: pick(args.allowEsigDisable, settings.deploy.allowEsigDisable),
            retainedSnapshots: pick(args.retainedSnapshots, settings.deploy.retainedSnapshots),
            configurationTimeout: pick(args['config-timeout'], settings.deploy.configurationTimeout)
        });
        break;
    case 'log':
        config.logTimeout = pick(args['log-timeout'], settings.log.timeout);
        break;
    case 'extract': {
        const names = pick(args.name, settings.extract.name);
        Object.assign(config, {
            directory: pick(args.directory, settings.extract.directory),
            overwrite: pick(args.overwrite, settings.extract.overwrite),
            type: pick(args.type, settings.extract.type),
            name: typeof names === 'undefined' || names === null ? [] : [].concat(names).map(String),
            file: pick(args.file, settings.extract.file),
            dbcType: pick(args.dbcType, settings.extract.dbcType),
            where: pick(args.where, settings.extract.where),
            object: pick(args.object, settings.extract.object)
        });
        break;
    }
    }

    if (typeof config.port === 'undefined' || config.port === null) {
        config.port = config.ssl ? 443 : 80;
    }

    return config;
}

/**
 * Throws an Error with the message to show when the configuration cannot run the command.
 * The encrypt command only needs the settings file and is checked when it runs.
 */
export function validateConfiguration(config) {
    if (config.command === 'encrypt') {
        if (!config.settingsFile) {
            throw new Error('The settings file must be provided to encrypt the password.');
        }
        return;
    }

    validateConnection(config);

    switch (config.command) {
    case 'deploy':
        validateDeploy(config);
        break;
    case 'extract':
        validateExtract(config);
        break;
    case 'log':
        if (!Number.isInteger(config.logTimeout) || config.logTimeout < 30 || config.logTimeout > 300) {
            throw new Error(`The logging timeout is ${config.logTimeout}, it must be a positive integer between 30 and 300.`);
        }
        break;
    }
}

function validateConnection(config) {
    if (!config.host) {
        throw new Error('A host name or IP address is required.');
    }
    if (!isValidHostname(config.host)) {
        throw new Error(`${config.host} is not a valid host name or IP address.`);
    }
    if (!config.apikey && (!config.username || !config.password)) {
        throw new Error('An apikey or username and password are required to connect to Maximo.');
    }
    if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
        throw new Error(`The port number ${config.port} must be a positive integer between 1 and 65535.`);
    }
    if (config.ca && !isReadableFile(config.ca)) {
        throw new Error(`The CA file ${config.ca} cannot be read.`);
    }
    if (!Number.isInteger(config.timeout) || config.timeout < 1 || config.timeout > 600) {
        throw new Error(`The connection timeout is ${config.timeout}, it must be a positive integer between 1 and 600.`);
    }
}

function validateDeploy(config) {
    if (typeof config.configurationTimeout !== 'number' || !(config.configurationTimeout > 0)) {
        throw new Error(`The configuration timeout is ${config.configurationTimeout}, it must be a positive number of minutes.`);
    }

    if (typeof config.retainedSnapshots !== 'undefined' && config.retainedSnapshots !== null && !RETAINED_SNAPSHOT_ANSWERS.includes(config.retainedSnapshots)) {
        throw new Error(`The retained snapshots answer ${config.retainedSnapshots} must be either restore or discard.`);
    }

    if (!config.file && !config.directory) {
        throw new Error('Neither a directory nor a file was provided to deploy. Either a directory or a file is required.');
    }

    if (config.file) {
        if (!path.isAbsolute(config.file) && !config.directory) {
            throw new Error(`The file ${config.file} is relative but a directory has not been provided. A directory is required for files with a relative path.`);
        }

        const file = resolveDeployFile(config);
        if (!isReadableFile(file)) {
            throw new Error(`The file ${file} does not exist.`);
        }
        if (!DEPLOYABLE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
            throw new Error(`Only ${DEPLOYABLE_EXTENSIONS.join(', ')} files can be deployed. The file ${file} does not meet this requirement.`);
        }
        return;
    }

    if (!isDirectory(config.directory)) {
        throw new Error(`The deploy directory ${config.directory} does not exist.`);
    }
}

function validateExtract(config) {
    if (!isDirectory(config.directory)) {
        throw new Error(`The extract directory ${config.directory} does not exist.`);
    }

    const type = typeof config.type === 'string' ? config.type.toLowerCase() : config.type;
    if (FILE_EXTRACT_TYPES.includes(type) || findConfigurationType(type)) {
        return;
    }

    if (type !== 'dbc') {
        const types = [...FILE_EXTRACT_TYPES, ...CONFIGURATION_TYPES.map((candidate) => candidate.group), 'dbc'];
        throw new Error(`The extract type ${config.type} is not supported, it must be one of ${types.join(', ')}.`);
    }

    const dbcType = DBC_TYPES.find((candidate) => candidate.group === config.dbcType);
    if (!dbcType) {
        throw new Error(`A DBC extract needs --dbcType, one of ${DBC_TYPES.map((candidate) => candidate.group).join(', ')}.`);
    }
    if (config.name.length === 0) {
        throw new Error(`A DBC extract needs at least one --name of the ${dbcType.plural.toLowerCase()} to extract.`);
    }
    if (!config.file) {
        throw new Error('A DBC extract needs --file, the DBC file to write.');
    }
    if (DBC_TYPES_WITH_WHERE.includes(dbcType.group)) {
        if (config.name.length !== 1) {
            throw new Error(`A ${dbcType.label} DBC extract takes exactly one --name.`);
        }
        if (!config.where) {
            throw new Error(`A ${dbcType.label} DBC extract needs --where, the where clause for the records to extract.`);
        }
    }
    if (dbcType.group === 'attribute' && !config.object) {
        throw new Error('An Attribute DBC extract needs --object, the object the attributes belong to.');
    }
}

/**
 * The absolute path of the deploy file: a relative file is relative to the deploy directory.
 */
export function resolveDeployFile(config) {
    return path.isAbsolute(config.file) ? path.resolve(config.file) : path.resolve(config.directory, config.file);
}

function isReadableFile(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function isDirectory(directory) {
    try {
        return fs.statSync(directory).isDirectory();
    } catch {
        return false;
    }
}
