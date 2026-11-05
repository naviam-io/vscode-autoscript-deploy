/*
 * Unit tests for how the CLI connects: connection error messages, and installing the server scripts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { describeConnectError, openSession } from '../../../cli/lib/session.js';

const config = { host: 'h', port: 1, install: true };

function client({ installed = true, upgradeRequired = false, connect = async () => {}, result } = {}) {
    const calls = [];
    return {
        calls,
        connect,
        installed: async () => installed,
        upgradeRequired: async () => upgradeRequired,
        installOrUpgrade: async (progress, bootstrap) => {
            calls.push(Boolean(bootstrap));
            return result;
        }
    };
}

describe('CLI session', () => {
    it('explains a refused connection', () => {
        assert.strictEqual(describeConnectError(new Error('connect ECONNREFUSED 127.0.0.1:1'), config), 'Connection refused to host h on port 1.');
    });

    it('explains an unknown host', () => {
        assert.strictEqual(describeConnectError(new Error('getaddrinfo ENOTFOUND h'), config), 'The host name "h" cannot be found.');
    });

    it('explains rejected credentials and a rejected API key', () => {
        const rejected = (status) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status } });

        assert.strictEqual(describeConnectError(rejected(401), config), 'User name and password combination are not valid.');
        assert.strictEqual(describeConnectError(rejected(400), { ...config, apikey: 'k' }), 'The provided API key is invalid.');
        assert.strictEqual(describeConnectError(rejected(400), config), 'Request failed');
    });

    it('reports a failed login with the explained message', async () => {
        const failing = client({ connect: async () => { throw new Error('connect ECONNREFUSED'); } });

        await assert.rejects(openSession(failing, config), /Connection refused to host h on port 1/);
    });

    it('installs, then checks for an upgrade', async () => {
        const fresh = client({ installed: false });

        await openSession(fresh, config);

        assert.deepStrictEqual(fresh.calls, [true]);
    });

    it('upgrades out of date scripts', async () => {
        const stale = client({ upgradeRequired: true });

        await openSession(stale, config);

        assert.deepStrictEqual(stale.calls, [false]);
    });

    it('refuses to install or upgrade when --install is false', async () => {
        await assert.rejects(openSession(client({ installed: false }), { ...config, install: false }), /does not have the required scripts installed and automatic install is turned off/);
        await assert.rejects(openSession(client({ upgradeRequired: true }), { ...config, install: false }), /out of date and automatic install is turned off/);
    });

    it('fails when the install reports an error', async () => {
        await assert.rejects(openSession(client({ installed: false, result: { status: 'error', message: 'no permission' } }), config), /no permission/);
    });
});
