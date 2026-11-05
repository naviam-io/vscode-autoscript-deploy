// @ts-nocheck
const crypto = require('crypto');

/**
 * Builds the scheme, host and port portion of a Maximo URL, omitting the port when it is the
 * default for the scheme.
 *
 * @param {Object} env
 * @returns {string}
 */
function getBaseUrl(env) {
    const protocol = env.useSSL ? 'https' : 'http';
    const defaultPort = env.useSSL ? 443 : 80;
    const port = Number(env.port);
    const includePort = Number.isFinite(port) && port > 0 && port !== defaultPort;
    return `${protocol}://${includePort ? `${env.host}:${port}` : env.host}`;
}

/**
 * Whether the environment has a usable stored API key or password, so connecting needs no prompt.
 * A value that failed to decrypt keeps its {encrypted} prefix and does not count.
 *
 * @param {Object} env
 * @returns {boolean}
 */
function hasStoredCredentials(env) {
    const usable = (value) => typeof value === 'string' && value !== '' && !value.startsWith('{encrypted}');
    return usable(env.apiKey) || Boolean(env.username && usable(env.password));
}

/**
 * Returns the configured MCP script name, falling back to the default when the setting is blank.
 *
 * @param {*} setting the naviam.mcp.script setting value.
 * @returns {string}
 */
function getMcpScriptName(setting) {
    const name = setting ? String(setting).trim() : '';
    return name !== '' ? name : 'naviam.mcp';
}

/**
 * Identifies one MCP script on one Maximo environment and user, so a script check is remembered
 * per target and not reused for another.
 *
 * @param {Object} env
 * @param {string} scriptName
 * @returns {string}
 */
function getScriptCheckKey(env, scriptName) {
    const context = (env.context || 'maximo').replace(/^\/+|\/+$/g, '');
    return [getBaseUrl(env), context, env.username || '', scriptName].join('|').toLowerCase();
}

/**
 * Identifies the Maximo session the relay can reuse: the same target, user, stored credentials and
 * connection options. The credentials and CA are hashed so the key never holds them in clear.
 *
 * @param {Object} env
 * @returns {string}
 */
function getConnectionKey(env) {
    const secret = crypto
        .createHash('sha256')
        .update(JSON.stringify([env.apiKey || '', env.password || '', env.proxyPassword || '', env.ca || '']))
        .digest('hex');
    return JSON.stringify([
        env.host,
        env.port,
        env.useSSL,
        env.context,
        env.username,
        Boolean(env.allowUntrustedCerts),
        Boolean(env.maxauthOnly),
        env.proxyHost || '',
        env.proxyPort || '',
        env.proxyUsername || '',
        secret
    ]);
}

/**
 * Explains why the MCP server cannot be used for a script lookup result, or returns null when the
 * script is installed and active.
 *
 * @param {{installed: boolean, active: boolean}|null|undefined} status
 * @param {string} scriptName
 * @param {string} environmentLabel
 * @returns {string|null}
 */
function describeScriptStatus(status, scriptName, environmentLabel) {
    const script = scriptName.toUpperCase();
    if (!status || !status.installed) {
        return `The Maximo MCP server is not available for ${environmentLabel} because the ${script} automation script is not installed. The script is provided separately.`;
    }
    if (!status.active) {
        return `The Maximo MCP server is not available for ${environmentLabel} because the ${script} automation script is not active. Activate it in Maximo, then run "Refresh Maximo MCP Server".`;
    }
    return null;
}

/**
 * Whether Maximo turned a relayed request away because its session is no longer valid: a 401, or a
 * redirect to the login page.
 *
 * @param {number} status
 * @returns {boolean}
 */
function isSessionRejected(status) {
    return status === 401 || (status >= 300 && status < 400);
}

/**
 * Logs clients in again when Maximo rejects their session, once per session. A request notes the
 * session it was sent on with session(); renew() then shares a login already in progress, and
 * skips the login when another request has already replaced that session.
 *
 * @returns {{session: (client: Object) => number, renew: (client: Object, session: number, login: () => Promise<*>) => Promise<void>}}
 */
function createSessionRenewer() {
    const sessions = new WeakMap();
    const renewing = new WeakMap();
    const session = (client) => sessions.get(client) || 0;

    return {
        session,
        renew(client, sent, login) {
            const pending = renewing.get(client);
            if (pending) {
                return pending;
            }
            if (session(client) !== sent) {
                return Promise.resolve();
            }
            const renewal = Promise.resolve()
                .then(login)
                .then(() => {
                    sessions.set(client, sent + 1);
                })
                .finally(() => renewing.delete(client));
            renewing.set(client, renewal);
            return renewal;
        }
    };
}

module.exports = {
    getBaseUrl,
    hasStoredCredentials,
    getMcpScriptName,
    getScriptCheckKey,
    getConnectionKey,
    describeScriptStatus,
    isSessionRejected,
    createSessionRenewer
};
