/*
 * Unit tests for how the CLI finds the server-side scripts it installs: beside the webpack bundle
 * (cli/dist/resources) when published, or the repository's resources/ folder when run from source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveResourcesDir } from '../../../cli/resources-dir.js';
import MaximoClient from '../../../src/core/maximo/maximo-client.js';
import MaximoConfig from '../../../src/core/maximo/maximo-config.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_DIR = path.join(REPO_ROOT, 'cli');

describe('CLI resources directory', () => {
    it('uses the resources folder beside the module when it holds the scripts', () => {
        const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bundle-'));
        fs.mkdirSync(path.join(moduleDir, 'resources'));
        fs.writeFileSync(path.join(moduleDir, 'resources', 'naviam.autoscript.install.js'), '');

        assert.strictEqual(resolveResourcesDir(moduleDir), path.join(moduleDir, 'resources'));
    });

    it('falls back to the resources folder of the parent directory', () => {
        const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-source-'));
        fs.mkdirSync(path.join(moduleDir, 'resources'));

        assert.strictEqual(resolveResourcesDir(moduleDir), path.resolve(moduleDir, '..', 'resources'));
    });

    it('resolves the repository resources folder when run from source', () => {
        const dir = resolveResourcesDir(CLI_DIR);

        assert.strictEqual(dir, path.join(REPO_ROOT, 'resources'));
        assert.ok(fs.existsSync(path.join(dir, 'naviam.autoscript.install.js')));
    });
});

describe('MaximoClient resource reading', () => {
    it('reads scripts from the configured resources directory', () => {
        const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-resources-'));
        fs.writeFileSync(path.join(resourcesDir, 'naviam.autoscript.store.js'), 'store source');

        const client = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', apiKey: 'x', resourcesDir }));

        assert.strictEqual(client._readResource('naviam.autoscript.store.js'), 'store source');
    });

    it('refuses to construct a client without a resources directory', () => {

        assert.throws(() => new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', apiKey: 'x' })), /resourcesDir/);
    });
});
