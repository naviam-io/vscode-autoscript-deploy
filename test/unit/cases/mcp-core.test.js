/*
 * Unit tests for MCP server definition URL generation and credential injection.
 *
 *   npm run test:unit
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
    getBaseUrl,
    getScriptUrl,
    formatMcpHeaders,
    getMcpScriptName,
    getScriptCheckKey,
    describeScriptStatus
} = require('../../../src/mcp-core');

describe('getScriptUrl', () => {
    it('generates an /api/ URL when apiKey is present and maxauthOnly is false', () => {
        const env = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            context: 'maximo',
            hasApiKey: true,
            maxauthOnly: false
        };
        const url = getScriptUrl(env, 'naviam.mcp');
        assert.strictEqual(url, 'https://maximo.example.com/maximo/api/script/naviam.mcp');
    });

    it('generates an /api/ URL even when maxauthOnly is true', () => {
        const env = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            context: 'maximo',
            hasApiKey: true,
            maxauthOnly: true
        };
        const url = getScriptUrl(env, 'naviam.mcp');
        assert.strictEqual(url, 'https://maximo.example.com/maximo/api/script/naviam.mcp');
    });

    it('generates an /api/ URL when apiKey is not present (password environment)', () => {
        const env = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            context: 'maximo',
            hasApiKey: false,
            maxauthOnly: false
        };
        const url = getScriptUrl(env, 'naviam.mcp');
        assert.strictEqual(url, 'https://maximo.example.com/maximo/api/script/naviam.mcp');
    });

    it('includes non-default port in the URL', () => {
        const env = {
            host: 'localhost',
            port: 9080,
            useSSL: false,
            context: 'maximo',
            hasApiKey: true,
            maxauthOnly: false
        };
        const url = getScriptUrl(env, 'naviam.mcp');
        assert.strictEqual(url, 'http://localhost:9080/maximo/api/script/naviam.mcp');
    });

    it('omits standard default ports (443 for https, 80 for http)', () => {
        const httpsEnv = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            hasApiKey: true
        };
        assert.strictEqual(getScriptUrl(httpsEnv), 'https://maximo.example.com/maximo/api/script/naviam.mcp');

        const httpEnv = {
            host: 'maximo.example.com',
            port: 80,
            useSSL: false,
            hasApiKey: true
        };
        assert.strictEqual(getScriptUrl(httpEnv), 'http://maximo.example.com/maximo/api/script/naviam.mcp');
    });

    it('uses a custom script name setting if provided', () => {
        const env = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            context: 'maximo',
            hasApiKey: true
        };
        const url = getScriptUrl(env, 'custom.mcp.script');
        assert.strictEqual(url, 'https://maximo.example.com/maximo/api/script/custom.mcp.script');
    });

    it('handles custom URL context paths', () => {
        const env = {
            host: 'maximo.example.com',
            port: 443,
            useSSL: true,
            context: '/custom/manage/',
            hasApiKey: true
        };
        const url = getScriptUrl(env);
        assert.strictEqual(url, 'https://maximo.example.com/custom/manage/api/script/naviam.mcp');
    });
});

describe('formatMcpHeaders', () => {
    it('injects apikey header when apiKey is present and maxauthOnly is false', () => {
        const env = {
            apiKey: 'secret-api-key-123',
            maxauthOnly: false,
            username: 'wilson'
        };
        const headers = formatMcpHeaders(env);
        assert.deepStrictEqual(headers, { apikey: 'secret-api-key-123' });
    });

    it('injects the maxauth header when maxauthOnly is true even if apiKey is present', () => {
        const env = {
            apiKey: 'secret-api-key-123',
            maxauthOnly: true,
            username: 'wilson',
            password: 'secretpassword'
        };
        const headers = formatMcpHeaders(env);
        const expectedMaxauth = Buffer.from('wilson:secretpassword').toString('base64');
        assert.deepStrictEqual(headers, { maxauth: expectedMaxauth });
    });

    it('injects the maxauth header when only username and password are provided', () => {
        const env = {
            username: 'wilson',
            password: 'secretpassword'
        };
        const headers = formatMcpHeaders(env);
        const expectedMaxauth = Buffer.from('wilson:secretpassword').toString('base64');
        assert.deepStrictEqual(headers, { maxauth: expectedMaxauth });
    });

    it('uses prompted password for the maxauth header when password was not pre-configured', () => {
        const env = {
            username: 'wilson'
        };
        const headers = formatMcpHeaders(env, 'prompted-pwd');
        const expectedMaxauth = Buffer.from('wilson:prompted-pwd').toString('base64');
        assert.deepStrictEqual(headers, { maxauth: expectedMaxauth });
    });

    it('rejects passwords or API keys that are still encrypted strings', () => {
        const env = {
            username: 'wilson',
            password: '{encrypted}1234567890abcdef'
        };
        assert.strictEqual(formatMcpHeaders(env), null);

        const envApi = {
            apiKey: '{encrypted}1234567890abcdef'
        };
        assert.strictEqual(formatMcpHeaders(envApi), null);
    });

    it('returns null if neither apiKey nor password (or prompt) is available', () => {
        const env = {
            username: 'wilson'
        };
        assert.strictEqual(formatMcpHeaders(env), null);
    });
});

describe('getBaseUrl', () => {
    it('omits the default port for each scheme', () => {
        assert.strictEqual(getBaseUrl({ host: 'maximo.example.com', port: 443, useSSL: true }), 'https://maximo.example.com');
        assert.strictEqual(getBaseUrl({ host: 'maximo.example.com', port: 80, useSSL: false }), 'http://maximo.example.com');
    });

    it('includes a non-default port', () => {
        assert.strictEqual(getBaseUrl({ host: 'localhost', port: 9080, useSSL: false }), 'http://localhost:9080');
    });

    it('falls back to the default port when none is configured', () => {
        assert.strictEqual(getBaseUrl({ host: 'maximo.example.com', useSSL: true }), 'https://maximo.example.com');
        assert.strictEqual(getBaseUrl({ host: 'maximo.example.com', port: null, useSSL: false }), 'http://maximo.example.com');
    });

    it('accepts a port configured as a string', () => {
        assert.strictEqual(getBaseUrl({ host: 'localhost', port: '9080', useSSL: false }), 'http://localhost:9080');
        assert.strictEqual(getBaseUrl({ host: 'localhost', port: '443', useSSL: true }), 'https://localhost');
    });
});

describe('getMcpScriptName', () => {
    it('uses the configured name, trimmed', () => {
        assert.strictEqual(getMcpScriptName('  custom.mcp '), 'custom.mcp');
    });

    it('falls back to naviam.mcp when the setting is blank or missing', () => {
        assert.strictEqual(getMcpScriptName(''), 'naviam.mcp');
        assert.strictEqual(getMcpScriptName('   '), 'naviam.mcp');
        assert.strictEqual(getMcpScriptName(null), 'naviam.mcp');
        assert.strictEqual(getMcpScriptName(undefined), 'naviam.mcp');
    });
});

describe('getScriptCheckKey', () => {
    const env = { host: 'maximo.example.com', port: 443, useSSL: true, context: 'maximo', username: 'wilson' };

    it('is the same for spellings of the same target', () => {
        const other = { ...env, port: '443', context: '/maximo/', username: 'WILSON' };
        assert.strictEqual(getScriptCheckKey(env, 'naviam.mcp'), getScriptCheckKey(other, 'NAVIAM.MCP'));
    });

    it('differs when the host, port, context, user or script differs', () => {
        const key = getScriptCheckKey(env, 'naviam.mcp');
        assert.notStrictEqual(getScriptCheckKey({ ...env, host: 'other.example.com' }, 'naviam.mcp'), key);
        assert.notStrictEqual(getScriptCheckKey({ ...env, port: 9443 }, 'naviam.mcp'), key);
        assert.notStrictEqual(getScriptCheckKey({ ...env, context: 'manage' }, 'naviam.mcp'), key);
        assert.notStrictEqual(getScriptCheckKey({ ...env, username: 'maxadmin' }, 'naviam.mcp'), key);
        assert.notStrictEqual(getScriptCheckKey(env, 'custom.mcp'), key);
    });
});

describe('describeScriptStatus', () => {
    it('returns null when the script is installed and active', () => {
        assert.strictEqual(describeScriptStatus({ installed: true, active: true }, 'naviam.mcp', 'Dev'), null);
    });

    it('explains a missing script, naming the upper cased script and the environment', () => {
        const message = describeScriptStatus({ installed: false, active: false }, 'naviam.mcp', 'Dev');
        assert.match(message, /NAVIAM\.MCP automation script is not installed/);
        assert.match(message, /for Dev/);
    });

    it('treats a missing lookup result as not installed', () => {
        assert.match(describeScriptStatus(null, 'naviam.mcp', 'Dev'), /is not installed/);
    });

    it('explains an inactive script and how to recover', () => {
        const message = describeScriptStatus({ installed: true, active: false }, 'naviam.mcp', 'Dev');
        assert.match(message, /is not active/);
        assert.match(message, /Refresh Maximo MCP Server/);
    });
});
