/*
 * Connecting to Maximo from the CLI: the client configuration, connection errors a person can act on, and the
 * install or upgrade of the server scripts.
 */
import fs from 'fs';

import MaximoConfig from '../../src/core/maximo/maximo-config.js';

/**
 * @param {object} config the resolved CLI configuration
 * @param {string} resourcesDir the server scripts to install
 */
export function createMaximoConfig(config, resourcesDir) {
    return new MaximoConfig({
        username: config.username,
        password: config.password,
        useSSL: config.ssl,
        host: config.host,
        port: config.port,
        context: config.context,
        connectTimeout: config.timeout * 1000,
        responseTimeout: config.timeout * 1000,
        allowUntrustedCerts: config.allowUntrustedCerts,
        configurationTimeout: (typeof config.configurationTimeout === 'number' ? config.configurationTimeout : 5) * 60000,
        ca: config.ca ? fs.readFileSync(config.ca, 'utf8') : undefined,
        maxauthOnly: config.maxauth,
        apiKey: config.apikey,
        resourcesDir
    });
}

/**
 * The message for a failed login, worded as the extension words it.
 *
 * @returns {string}
 */
export function describeConnectError(error, config) {
    const message = error && error.message ? String(error.message) : String(error);
    const status = error && error.response ? error.response.status : undefined;

    if (message.includes('ENOTFOUND')) {
        return `The host name "${config.host}" cannot be found.`;
    }
    if (error && error.code === 'ECONNRESET') {
        return message;
    }
    if (message.includes('ECONNREFUSED')) {
        return `Connection refused to host ${config.host} on port ${config.port}.`;
    }
    if (message.includes('EPROTO')) {
        return `Connection refused to host ${config.host} on port ${config.port} because of an SSL connection error. Is the server using SSL, or is the port a non-SSL port?`;
    }
    if (status === 401) {
        return 'User name and password combination are not valid.';
    }
    if (config.apikey && status === 400) {
        return 'The provided API key is invalid.';
    }
    return message;
}

/**
 * Logs in, then installs or upgrades the server scripts unless that is turned off.
 *
 * @param {{ install: boolean, host: string, port: number, apikey?: string }} config
 * @param {(message: string) => void} out
 */
export async function openSession(client, config, out = () => {}) {
    try {
        await client.connect();
    } catch (error) {
        throw new Error(describeConnectError(error, config));
    }

    const progress = { report: () => {} };

    if (!(await client.installed())) {
        if (!config.install) {
            throw new Error(`The server ${config.host} does not have the required scripts installed and automatic install is turned off.`);
        }
        out(`Installing the Maximo Development Tools scripts on ${config.host}.`);
        await installOrUpgrade(client, progress, true);
    }

    if (await client.upgradeRequired()) {
        if (!config.install) {
            throw new Error(`The server ${config.host} has the required scripts but they are out of date and automatic install is turned off.`);
        }
        out(`Upgrading the Maximo Development Tools scripts on ${config.host}.`);
        await installOrUpgrade(client, progress, false);
    }
}

async function installOrUpgrade(client, progress, bootstrap) {
    const result = await client.installOrUpgrade(progress, bootstrap);
    if (result && result.status === 'error') {
        throw new Error(result.message);
    }
}
