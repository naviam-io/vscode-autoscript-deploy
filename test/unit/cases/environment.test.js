/*
 * Unit tests for selecting the Maximo environment and merging it with the naviam.* settings.
 *
 *   npm run test:unit
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { findSelectedEnvironment, resolveEnvironment } = require('../../../src/environment');

function fakeSettings(map = {}) {
    return {
        get: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
    };
}

describe('findSelectedEnvironment', () => {
    it('returns null for a missing or empty configuration', () => {
        assert.strictEqual(findSelectedEnvironment(null), null);
        assert.strictEqual(findSelectedEnvironment(undefined), null);
        assert.strictEqual(findSelectedEnvironment([]), null);
        assert.strictEqual(findSelectedEnvironment({}), null);
    });

    it('returns the only entry of a list', () => {
        const single = [{ name: 'Dev', host: 'localhost' }];
        assert.deepStrictEqual(findSelectedEnvironment(single), single[0]);
    });

    it('returns the entry marked selected', () => {
        const environments = [
            { name: 'Dev', host: 'dev.example.com', selected: false },
            { name: 'Stage', host: 'stage.example.com', selected: true }
        ];
        assert.deepStrictEqual(findSelectedEnvironment(environments), environments[1]);
    });

    it('returns null when several entries exist and none is selected', () => {
        const environments = [
            { name: 'Dev', host: 'dev.example.com' },
            { name: 'Stage', host: 'stage.example.com' }
        ];
        assert.strictEqual(findSelectedEnvironment(environments), null);
    });

    it('returns a single environment object as is', () => {
        const config = { name: 'Dev', host: 'localhost' };
        assert.deepStrictEqual(findSelectedEnvironment(config), config);
    });
});

describe('resolveEnvironment', () => {
    const settings = fakeSettings({
        'maximo.host': 'settings.example.com',
        'maximo.port': 9443,
        'maximo.useSSL': true,
        'maximo.context': 'manage',
        'maximo.user': 'admin',
        'maximo.apiKey': 'settings-key',
        'maximo.customCA': 'settings-ca',
        'maximo.extractScreenLocation': 'screens',
        'maximo.proxy.user': 'proxy-user'
    });

    it('falls back to the settings when no environment is selected', () => {
        const env = resolveEnvironment(null, settings);
        assert.strictEqual(env.host, 'settings.example.com');
        assert.strictEqual(env.port, 9443);
        assert.strictEqual(env.context, 'manage');
        assert.strictEqual(env.username, 'admin');
        assert.strictEqual(env.apiKey, 'settings-key');
        assert.strictEqual(env.password, undefined);
    });

    it('maps settings whose names differ from the configuration file', () => {
        const env = resolveEnvironment(null, settings);
        assert.strictEqual(env.ca, 'settings-ca');
        assert.strictEqual(env.extractLocationScreens, 'screens');
        assert.strictEqual(env.proxyUsername, 'proxy-user');
    });

    it('prefers the selected environment over the settings', () => {
        const selected = { name: 'Local', host: 'localhost', port: 9080, useSSL: false, username: 'maxadmin', apiKey: 'local-key', ca: 'local-ca' };
        const env = resolveEnvironment(selected, settings);
        assert.strictEqual(env.name, 'Local');
        assert.strictEqual(env.host, 'localhost');
        assert.strictEqual(env.port, 9080);
        assert.strictEqual(env.useSSL, false);
        assert.strictEqual(env.username, 'maxadmin');
        assert.strictEqual(env.apiKey, 'local-key');
        assert.strictEqual(env.ca, 'local-ca');
    });

    it('keeps an explicit false from the selected environment', () => {
        const enabled = fakeSettings({ 'maximo.useSSL': true, 'maximo.maxauthOnly': true, 'maximo.allowUntrustedCerts': true });
        const env = resolveEnvironment({ host: 'localhost', useSSL: false, maxauthOnly: false, allowUntrustedCerts: false }, enabled);
        assert.strictEqual(env.useSSL, false);
        assert.strictEqual(env.maxauthOnly, false);
        assert.strictEqual(env.allowUntrustedCerts, false);
    });

    it('falls back to the settings API key when the selected environment has no credentials', () => {
        const env = resolveEnvironment({ host: 'localhost' }, settings);
        assert.strictEqual(env.apiKey, 'settings-key');
    });

    it('does not use the settings API key when the selected environment has a password', () => {
        const env = resolveEnvironment({ host: 'localhost', username: 'maxadmin', password: 'secret' }, settings);
        assert.strictEqual(env.password, 'secret');
        assert.strictEqual(env.apiKey, undefined);
    });

    it('defaults SSL, port and context when neither source supplies them', () => {
        const env = resolveEnvironment({ host: 'maximo.example.com' }, fakeSettings());
        assert.strictEqual(env.useSSL, true);
        assert.strictEqual(env.port, 443);
        assert.strictEqual(env.context, 'maximo');
        assert.strictEqual(env.maxauthOnly, false);
        assert.strictEqual(resolveEnvironment({ host: 'localhost', useSSL: false }, fakeSettings()).port, 80);
    });

    it('leaves the host empty when neither source supplies one', () => {
        assert.strictEqual(resolveEnvironment(null, fakeSettings()).host, null);
    });
});
