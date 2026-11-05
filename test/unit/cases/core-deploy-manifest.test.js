/*
 * Unit tests for manifest deployment in the core.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecordingUi } from '../support/recording-ui.js';
import { deployManifest } from '../../../src/core/deploy/deploy-manifest.js';
import MaximoClient from '../../../src/core/maximo/maximo-client.js';
import MaximoConfig from '../../../src/core/maximo/maximo-config.js';
import { OUTDATED_SERVER_MESSAGE } from '../../../src/core/deploy/create-only.js';

function manifest(entries) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-manifest-'));
    const file = path.join(dir, 'release.manifest.json');
    fs.writeFileSync(file, JSON.stringify({ manifest: entries }));
    return { dir, file };
}

describe('deployManifest', () => {
    it('deploys nothing and reports every problem when the plan has errors', async () => {
        const { file } = manifest([{ kind: 'configuration', path: 'missing.json' }]);
        const client = { postConfig: async () => assert.fail('should not deploy') };
        const { ui, calls } = createRecordingUi();

        const result = await deployManifest(client, ui, file, {});

        assert.strictEqual(result.deployed, false);
        assert.match(calls.find((call) => call.method === 'error').message, /Nothing has been deployed/);
    });

    it('stops at the first failing step and says which', async () => {
        const { dir, file } = manifest([
            { kind: 'configuration', path: 'a.json' },
            { kind: 'configuration', path: 'b.json' }
        ]);
        fs.writeFileSync(path.join(dir, 'a.json'), '{"properties":[]}');
        fs.writeFileSync(path.join(dir, 'b.json'), '{"properties":[]}');
        let posts = 0;
        const client = {
            postConfig: async () => {
                posts++;
                throw new Error('rejected');
            }
        };
        const { ui, calls } = createRecordingUi();

        const result = await deployManifest(client, ui, file, {});

        assert.deepStrictEqual([result.deployed, result.completed, posts], [false, 0, 1]);
        assert.ok(calls.some((call) => call.method === 'error' && /Deployment stopped after 0 of 2/.test(call.message)));
    });

    it('passes entries without a kind to onDeprecations', async () => {
        const { dir, file } = manifest(['a.json']);
        fs.writeFileSync(path.join(dir, 'a.json'), '{"properties":[]}');
        const seen = [];
        const client = { postConfig: async () => {} };
        const { ui } = createRecordingUi();

        const result = await deployManifest(client, ui, file, { onDeprecations: (manifestPath, deprecations) => seen.push(deprecations.length) });

        assert.strictEqual(result.deployed, true);
        assert.deepStrictEqual(seen, [1]);
    });
});

function maximoClient(overrides) {
    return Object.assign(new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() })), overrides);
}

describe('deployManifest create-only entries', () => {
    it('refuses to start on outdated server scripts and deploys nothing', async () => {
        const { dir, file } = manifest([{ kind: 'screen', path: 'a.xml', createOnly: true }]);
        fs.writeFileSync(path.join(dir, 'a.xml'), '<presentation id="A"/>');
        const client = maximoClient({ upgradeRequired: async () => true, postScreen: async () => assert.fail('should not deploy') });
        const { ui, calls } = createRecordingUi();

        const result = await deployManifest(client, ui, file, {});

        assert.strictEqual(result.deployed, false);
        assert.ok(calls.some((call) => call.method === 'error' && call.message.includes(OUTDATED_SERVER_MESSAGE)));
    });

    it('does not ask about the server version when no entry is create-only', async () => {
        const { dir, file } = manifest([{ kind: 'screen', path: 'a.xml' }]);
        fs.writeFileSync(path.join(dir, 'a.xml'), '<presentation id="A"/>');
        const client = maximoClient({ upgradeRequired: async () => assert.fail('should not check'), postScreen: async () => ({ status: 'success' }) });
        const { ui } = createRecordingUi();

        assert.strictEqual((await deployManifest(client, ui, file, {})).deployed, true);
    });

    it('passes createOnly to the deployer and reports the entries left unchanged', async () => {
        const { dir, file } = manifest([
            { kind: 'screen', path: 'a.xml', createOnly: true },
            { kind: 'screen', path: 'b.xml' }
        ]);
        fs.writeFileSync(path.join(dir, 'a.xml'), '<presentation id="A"/>');
        fs.writeFileSync(path.join(dir, 'b.xml'), '<presentation id="B"/>');
        const seen = [];
        const client = maximoClient({
            upgradeRequired: async () => false,
            postScreen: async (screen, progress, fileName, options) => {
                seen.push([fileName, options.createOnly]);
                return options.createOnly ? { status: 'success', outcome: 'skipped' } : { status: 'success' };
            }
        });
        const { ui, calls } = createRecordingUi();

        const result = await deployManifest(client, ui, file, {});

        assert.deepStrictEqual(seen, [
            ['a.xml', true],
            ['b.xml', false]
        ]);
        assert.deepStrictEqual([result.deployed, result.completed, result.skipped], [true, 2, 1]);
        assert.strictEqual(
            calls.find((call) => call.method === 'info').message,
            'The manifest deployed successfully: 2 step(s), 1 create-only entry(s) left unchanged.'
        );
    });
});
