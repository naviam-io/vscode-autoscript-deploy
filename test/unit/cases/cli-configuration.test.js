/*
 * Unit tests for how the CLI resolves and validates its configuration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings } from '../../../cli/lib/settings.js';
import { findConfigurationType, resolveConfiguration, validateConfiguration } from '../../../cli/lib/configuration.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-config-'));

function configure(command, args = {}, settings = {}) {
    return resolveConfiguration(command, args, mergeSettings(DEFAULT_SETTINGS, { host: 'maximo.example.com', apikey: 'key', ...settings }), undefined);
}

describe('CLI configuration', () => {
    it('prefers the command line over the settings file', () => {
        assert.strictEqual(configure('log', { host: 'cli.example.com' }).host, 'cli.example.com');
        assert.strictEqual(configure('log', {}).host, 'maximo.example.com');
    });

    it('defaults the port from ssl', () => {
        assert.strictEqual(configure('log', { ssl: false }).port, 80);
        assert.strictEqual(configure('log', {}).port, 443);
        assert.strictEqual(configure('log', { port: 9080 }).port, 9080);
    });

    it('reads the deploy section for deploy', () => {
        const config = configure('deploy', { allowEsigDisable: true }, { deploy: { retainedSnapshots: 'discard', directory: 'scripts' } });

        assert.strictEqual(config.directory, 'scripts');
        assert.strictEqual(config.allowEsigDisable, true);
        assert.strictEqual(config.retainedSnapshots, 'discard');
        assert.strictEqual(config.recursive, true);
        assert.strictEqual(config.configurationTimeout, 5);
    });

    it('reads extract names as a list', () => {
        assert.deepStrictEqual(configure('extract', { name: 'one' }).name, ['one']);
        assert.deepStrictEqual(configure('extract', { name: ['one', 'two'] }).name, ['one', 'two']);
        assert.deepStrictEqual(configure('extract', {}).name, []);
    });

    it('accepts a deploy of an existing directory', () => {
        assert.doesNotThrow(() => validateConfiguration(configure('deploy', { directory: tempDir() })));
    });

    it('requires credentials and a valid host', () => {
        assert.throws(() => validateConfiguration(configure('log', {}, { apikey: undefined })), /apikey or username and password/);
        assert.throws(() => validateConfiguration(configure('log', { host: 'bad host!' })), /not a valid host name/);
    });

    it('rejects a CA file that cannot be read', () => {
        assert.throws(() => validateConfiguration(configure('log', { ca: path.join(tempDir(), 'missing.pem') })), /CA file .* cannot be read/);
    });

    it('rejects a connection timeout out of range', () => {
        assert.throws(() => validateConfiguration(configure('log', { timeout: 0 })), /between 1 and 600/);
    });

    it('rejects a file without a deployable extension', () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'notes.txt'), '');

        assert.throws(() => validateConfiguration(configure('deploy', { directory: dir, file: 'notes.txt' })), /notes\.txt does not meet/);
    });

    it('accepts a TypeScript file relative to the directory', () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'script.ts'), '');

        assert.doesNotThrow(() => validateConfiguration(configure('deploy', { directory: dir, file: 'script.ts' })));
    });

    it('rejects a relative file without a directory and a missing directory', () => {
        assert.throws(() => validateConfiguration(configure('deploy', { directory: '', file: 'script.js' })), /relative but a directory/);
        assert.throws(() => validateConfiguration(configure('deploy', { directory: path.join(tempDir(), 'missing') })), /does not exist/);
    });

    it('rejects an unknown retained snapshots answer', () => {
        assert.throws(() => validateConfiguration(configure('deploy', { directory: tempDir(), retainedSnapshots: 'keep' })), /restore or discard/);
    });

    it('accepts configuration groups as extract types, case-insensitively', () => {
        assert.strictEqual(findConfigurationType('cronTasks').group, 'cronTasks');
        assert.strictEqual(findConfigurationType('CRONTASKS').group, 'cronTasks');
        assert.doesNotThrow(() => validateConfiguration(configure('extract', { directory: tempDir(), type: 'Properties' })));
    });

    it('rejects an unknown extract type', () => {
        assert.throws(() => validateConfiguration(configure('extract', { directory: tempDir(), type: 'widgets' })), /widgets is not supported/);
    });

    it('requires one name, a file and a where clause for a table DBC extract', () => {
        const dbc = (args) => validateConfiguration(configure('extract', { directory: tempDir(), type: 'dbc', dbcType: 'table', ...args }));

        assert.throws(() => dbc({}), /at least one --name/);
        assert.throws(() => dbc({ name: ['ASSET'] }), /--file/);
        assert.throws(() => dbc({ name: ['ASSET', 'WORKORDER'], file: 'a.dbc' }), /exactly one --name/);
        assert.throws(() => dbc({ name: ['ASSET'], file: 'a.dbc' }), /--where/);
        assert.doesNotThrow(() => dbc({ name: ['ASSET'], file: 'a.dbc', where: "assetnum = 'X'" }));
    });

    it('requires a known DBC type and an object for attributes', () => {
        const dbc = (args) => validateConfiguration(configure('extract', { directory: tempDir(), type: 'dbc', name: ['DESCRIPTION'], file: 'a.dbc', ...args }));

        assert.throws(() => dbc({ dbcType: 'nope' }), /--dbcType/);
        assert.throws(() => dbc({ dbcType: 'attribute' }), /--object/);
        assert.doesNotThrow(() => dbc({ dbcType: 'attribute', object: 'ASSET' }));
    });

    it('rejects a log timeout out of range', () => {
        assert.throws(() => validateConfiguration(configure('log', { 'log-timeout': 10 })), /between 30 and 300/);
    });

    it('needs a settings file to encrypt', () => {
        assert.throws(() => validateConfiguration(configure('encrypt')), /settings file must be provided/);
    });
});
