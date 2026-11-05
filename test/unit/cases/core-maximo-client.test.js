/*
 * Unit tests for how the core MaximoClient finds the server-side scripts it installs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import MaximoConfig from '../../../src/core/maximo/maximo-config.js';
import MaximoClient from '../../../src/core/maximo/maximo-client.js';
import { LoginFailedError, MaximoError, isLoginRejection } from '../../../src/core/maximo/errors.js';
import { OUTDATED_SERVER_MESSAGE } from '../../../src/core/deploy/create-only.js';

async function load() {
    return { MaximoConfig, MaximoClient };
}

describe('core MaximoClient resources', () => {
    it('refuses a configuration without a resources directory', async () => {
        const { MaximoConfig, MaximoClient } = await load();
        assert.throws(() => new MaximoClient(new MaximoConfig({ host: 'maximo.example.com' })), /resourcesDir is required/);
    });

    it('reads the scripts it installs from the injected directory', async () => {
        const { MaximoConfig, MaximoClient } = await load();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-resources-'));
        fs.writeFileSync(path.join(dir, 'naviam.autoscript.store.js'), '// store');

        const client = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: dir }));

        assert.strictEqual(client._readResource('naviam.autoscript.store.js'), '// store');
    });
});

describe('core MaximoClient TLS options', () => {
    it('keeps them on its own agent, so one client cannot change another\'s certificate checks', () => {
        const before = { ...https.globalAgent.options };
        const untrusted = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', allowUntrustedCerts: true, ca: 'custom-ca', resourcesDir: os.tmpdir() }));
        const trusted = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() }));

        assert.strictEqual(untrusted.client.defaults.httpsAgent.options.rejectUnauthorized, false);
        assert.strictEqual(untrusted.client.defaults.httpsAgent.options.ca, 'custom-ca');
        assert.strictEqual(trusted.client.defaults.httpsAgent.options.rejectUnauthorized, true);
        assert.deepStrictEqual({ ...https.globalAgent.options }, before);
    });

    it('closes its idle connections on disconnect and leaves those in use', async () => {
        const client = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() }));
        const socket = () => ({ destroyed: false, destroy() { this.destroyed = true; } });
        const idle = socket();
        const inUse = socket();
        client.httpsAgent.freeSockets['maximo.example.com:443:'] = [idle];
        client.httpsAgent.sockets['maximo.example.com:443:'] = [inUse];

        await client.disconnect();

        assert.strictEqual(idle.destroyed, true);
        assert.strictEqual(inUse.destroyed, false);
        delete client.httpsAgent.freeSockets['maximo.example.com:443:'];
        delete client.httpsAgent.sockets['maximo.example.com:443:'];
    });
});

describe('isLoginRejection', () => {
    it('recognises Maximo refusing the credentials', () => {
        assert.strictEqual(isLoginRejection(new LoginFailedError('Login failed')), true);
        assert.strictEqual(isLoginRejection(new MaximoError('Invalid user', 'BMXAA0021E', 401)), true);
        assert.strictEqual(isLoginRejection({ response: { status: 401 } }), true);
    });

    it('does not treat a connection or server failure as rejected credentials', () => {
        assert.strictEqual(isLoginRejection(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), false);
        assert.strictEqual(isLoginRejection(new Error('self-signed certificate')), false);
        assert.strictEqual(isLoginRejection({ response: { status: 500 } }), false);
        assert.strictEqual(isLoginRejection(undefined), false);
    });
});

function connectedClient(overrides) {
    const client = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() }));
    return Object.assign(client, { _isConnected: true }, overrides);
}

describe('core MaximoClient installOrUpgrade', () => {
    it('fails when the log streaming security cannot be initialized', async () => {
        const installed = [];
        const client = connectedClient({
            _readResource: () => '',
            _installOrUpdateScript: async (script) => installed.push(script),
            _initLogStreamSecurity: async () => false
        });

        await assert.rejects(client.installOrUpgrade({ report() {} }), /log streaming security/);
        assert.deepStrictEqual(installed, ['naviam.autoscript.store', 'naviam.autoscript.extract', 'naviam.autoscript.logging']);
    });

    it('reads the server status of the log streaming security initialization', async () => {
        const answer = (status) => connectedClient({ client: { request: async () => ({ data: { status } }) } });

        assert.strictEqual(await answer('success')._initLogStreamSecurity(), true);
        assert.strictEqual(await answer('error')._initLogStreamSecurity(), false);
    });
});

describe('core MaximoClient deleteScriptIfExists', () => {
    it('deletes the script found by name', async () => {
        const requests = [];
        const client = connectedClient({
            client: {
                request: async (options) => {
                    requests.push(options);
                    return requests.length === 1
                        ? { data: { member: [{ href: 'http://maximo.example.com/api/os/mxscript/_TlZURVNU' }] } }
                        : { status: 200, data: {} };
                }
            }
        });

        assert.strictEqual(await client.deleteScriptIfExists('NVTEST.CLI'), true);
        assert.match(requests[0].url, /oslc\.where=autoscript="NVTEST\.CLI"/);
        assert.strictEqual(requests[1].url, 'os/mxscript/_TlZURVNU');
        assert.strictEqual(requests[1].headers.common['x-method-override'], 'PATCH');
        assert.deepStrictEqual(requests[1].data, { _action: 'Delete' });
    });

    it('returns false when there is no such script', async () => {
        const client = connectedClient({ client: { request: async () => ({ data: { member: [] } }) } });

        assert.strictEqual(await client.deleteScriptIfExists('NVTEST.NONE'), false);
    });
});

describe('core MaximoClient login authentication', () => {
    function client(options) {
        return new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir(), ...options }));
    }

    it('sends the API key and no maxauth or basic credentials when an API key is configured', () => {
        const request = { headers: {} };

        client({ apiKey: 'x' })._addAuthHeaders(request);

        assert.strictEqual(request.headers.apikey, 'x');
        assert.strictEqual(request.headers.maxauth, undefined);
        assert.strictEqual(request.auth, undefined);
    });

    it('sends maxauth and basic credentials for a user name and password', () => {
        const request = { headers: {} };

        client({ username: 'user', password: 'secret' })._addAuthHeaders(request);

        assert.strictEqual(request.headers.maxauth, Buffer.from('user:secret').toString('base64'));
        assert.deepStrictEqual(request.auth, { username: 'user', password: 'secret' });
    });
});

const progress = { report() {} };

describe('core MaximoClient create-only requests', () => {
    for (const [method, call] of [
        ['postScreen', (client, options) => client.postScreen('<presentation id="X"/>', progress, 'x.xml', options)],
        ['postReport', (client, options) => client.postReport({ reportName: 'x.rptdesign' }, progress, 'x.rptdesign', options)],
        ['postForm', (client, options) => client.postForm({ name: 'X' }, progress, options)],
        ['postScript', (client, options) => client.postScript('main();', progress, 'x.js', undefined, undefined, options)]
    ]) {
        it(`${method} sends createOnly and returns the outcome`, async () => {
            const requests = [];
            const client = connectedClient({
                client: {
                    request: async (options) => {
                        requests.push(options);
                        return { data: { status: 'success', outcome: 'skipped' } };
                    }
                }
            });

            const result = await call(client, { createOnly: true });

            assert.deepStrictEqual(requests[0].params, { createOnly: 'true' });
            assert.strictEqual(result.outcome, 'skipped');
        });

        it(`${method} sends no flag for an ordinary deploy`, async () => {
            const requests = [];
            const client = connectedClient({
                client: {
                    request: async (options) => {
                        requests.push(options);
                        return { data: { status: 'success' } };
                    }
                }
            });

            await call(client, undefined);

            assert.strictEqual(requests[0].params, undefined);
        });

        it(`${method} refuses a create-only answer without an outcome`, async () => {
            const client = connectedClient({ client: { request: async () => ({ data: { status: 'success' } }) } });

            await assert.rejects(call(client, { createOnly: true }), { message: OUTDATED_SERVER_MESSAGE });
        });
    }

    it('requires the server scripts that understand createOnly', () => {
        const client = connectedClient({});
        assert.deepStrictEqual([client.requiredScriptVersion, client.currentScriptVersion], ['1.70.0', '1.70.0']);
    });
});
