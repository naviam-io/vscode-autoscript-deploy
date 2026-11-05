/*
 * Unit tests for the vscode-free MCP helpers.
 *
 *   npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    getBaseUrl,
    hasStoredCredentials,
    getMcpScriptName,
    getScriptCheckKey,
    getConnectionKey,
    describeScriptStatus,
    isSessionRejected,
    createSessionRenewer
} from '../../../src/mcp-core.js';

describe('hasStoredCredentials', () => {
    it('accepts a stored API key, or a user name with a stored password', () => {
        assert.strictEqual(hasStoredCredentials({ apiKey: 'secret-api-key-123' }), true);
        assert.strictEqual(hasStoredCredentials({ username: 'wilson', password: 'secretpassword' }), true);
    });

    it('rejects values that are still encrypted', () => {
        assert.strictEqual(hasStoredCredentials({ apiKey: '{encrypted}1234567890abcdef' }), false);
        assert.strictEqual(hasStoredCredentials({ username: 'wilson', password: '{encrypted}1234567890abcdef' }), false);
    });

    it('rejects a missing password or a password without a user name', () => {
        assert.strictEqual(hasStoredCredentials({ username: 'wilson' }), false);
        assert.strictEqual(hasStoredCredentials({ password: 'secretpassword' }), false);
        assert.strictEqual(hasStoredCredentials({ apiKey: '' }), false);
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

describe('getConnectionKey', () => {
    const env = { host: 'maximo.example.com', port: 443, useSSL: true, context: 'maximo', username: 'wilson', password: 'secret-1' };

    it('is the same for an unchanged environment, so a refresh keeps the session', () => {
        assert.strictEqual(getConnectionKey({ ...env }), getConnectionKey(env));
    });

    it('differs when the target, user or stored credentials change', () => {
        const key = getConnectionKey(env);
        assert.notStrictEqual(getConnectionKey({ ...env, host: 'other.example.com' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, username: 'maxadmin' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, password: 'secret-2' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, apiKey: 'key-1' }), key);
    });

    it('differs when TLS, proxy or maxauth options change, so the client is rebuilt with them', () => {
        const key = getConnectionKey(env);
        assert.notStrictEqual(getConnectionKey({ ...env, allowUntrustedCerts: true }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, ca: '-----BEGIN CERTIFICATE-----' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, maxauthOnly: true }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, proxyHost: '192.0.2.1' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, proxyHost: '192.0.2.1', proxyPort: 8080 }), getConnectionKey({ ...env, proxyHost: '192.0.2.1' }));
        assert.notStrictEqual(getConnectionKey({ ...env, proxyUsername: 'proxy' }), key);
        assert.notStrictEqual(getConnectionKey({ ...env, proxyPassword: 'proxy-secret' }), key);
    });

    it('does not contain the credentials', () => {
        const key = getConnectionKey({ ...env, apiKey: 'key-1', proxyPassword: 'proxy-secret' });
        assert.ok(!key.includes('secret-1'));
        assert.ok(!key.includes('key-1'));
        assert.ok(!key.includes('proxy-secret'));
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

describe('isSessionRejected', () => {
    it('treats a 401 and a redirect to the login page as a rejected session', () => {
        for (const status of [401, 302, 303, 307]) {
            assert.strictEqual(isSessionRejected(status), true, `status ${status}`);
        }
    });

    it('passes every other answer through, including Maximo errors', () => {
        for (const status of [200, 202, 400, 403, 404, 500]) {
            assert.strictEqual(isSessionRejected(status), false, `status ${status}`);
        }
    });
});

describe('createSessionRenewer', () => {
    function deferred() {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    }

    it('logs in once for parallel requests rejected on the same session', async () => {
        const renewer = createSessionRenewer();
        const client = {};
        const login = deferred();
        let logins = 0;
        const start = () => {
            logins++;
            return login.promise;
        };

        const sent = renewer.session(client);
        const first = renewer.renew(client, sent, start);
        const second = renewer.renew(client, sent, start);
        login.resolve();
        await Promise.all([first, second]);

        assert.strictEqual(logins, 1);
        assert.strictEqual(renewer.session(client), sent + 1);
    });

    it('does not log in again for a request sent on a session already replaced', async () => {
        const renewer = createSessionRenewer();
        const client = {};
        let logins = 0;
        const start = async () => {
            logins++;
        };

        const late = renewer.session(client);
        await renewer.renew(client, renewer.session(client), start);
        await renewer.renew(client, late, start);

        assert.strictEqual(logins, 1);
    });

    it('keeps the session after a failed login, so the next rejection tries again', async () => {
        const renewer = createSessionRenewer();
        const client = {};
        let logins = 0;

        await assert.rejects(
            renewer.renew(client, 0, async () => {
                logins++;
                throw new Error('login failed');
            }),
            /login failed/
        );
        await renewer.renew(client, 0, async () => {
            logins++;
        });

        assert.strictEqual(logins, 2);
        assert.strictEqual(renewer.session(client), 1);
    });

    it('tracks each client separately', async () => {
        const renewer = createSessionRenewer();
        const a = {};
        const b = {};
        let logins = 0;
        const start = async () => {
            logins++;
        };

        await renewer.renew(a, 0, start);
        await renewer.renew(b, 0, start);

        assert.strictEqual(logins, 2);
    });
});

