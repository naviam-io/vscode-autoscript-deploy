// @ts-nocheck
const { Buffer } = require('buffer');

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
 * Constructs the URL for the Naviam MCP server on the given Maximo environment.
 * The /api/script/${scriptName} route handles both API key and maxauth authentication,
 * and cleanly handles GET requests with 405 Method Not Allowed (unlike /oslc/).
 *
 * @param {Object} env
 * @param {string} [scriptName]
 * @returns {string}
 */
function getScriptUrl(env, scriptName) {
    const context = (env.context || 'maximo').replace(/^\/+|\/+$/g, '');
    const script = (scriptName || 'naviam.mcp').trim();
    return `${getBaseUrl(env)}/${context}/api/script/${script}`;
}

/**
 * Formats the authentication headers for the MCP server definition.
 * Returns null if no valid credentials can be constructed.
 * Validates that credentials are not still in their {encrypted} state.
 *
 * @param {Object} env
 * @param {string} [promptedPassword]
 * @returns {Record<string, string>|null}
 */
function formatMcpHeaders(env, promptedPassword) {
    const validApiKey = env.apiKey && !env.apiKey.startsWith('{encrypted}') ? env.apiKey : null;
    const rawPassword = env.password && !env.password.startsWith('{encrypted}') ? env.password : null;
    const password = rawPassword || (promptedPassword && !promptedPassword.startsWith('{encrypted}') ? promptedPassword : null);

    if (validApiKey && !env.maxauthOnly) {
        return { apikey: validApiKey };
    }
    if (env.username && password) {
        const auth = Buffer.from(`${env.username}:${password}`).toString('base64');
        return { maxauth: auth };
    }
    if (validApiKey) {
        return { apikey: validApiKey };
    }
    return null;
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

module.exports = {
    getBaseUrl,
    getScriptUrl,
    formatMcpHeaders,
    getMcpScriptName,
    getScriptCheckKey,
    describeScriptStatus
};
