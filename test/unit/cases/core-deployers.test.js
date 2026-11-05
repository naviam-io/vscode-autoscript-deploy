/*
 * Unit tests for the core script and screen deployers, against a stubbed MaximoClient.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecordingUi } from '../support/recording-ui.js';
import { deployScript } from '../../../src/core/deploy/deploy-script.js';
import { deployScreen } from '../../../src/core/deploy/deploy-screen.js';
import { deployForm } from '../../../src/core/deploy/deploy-form.js';
import { deployReport } from '../../../src/core/deploy/deploy-report.js';
import { SKIPPED } from '../../../src/core/deploy/create-only.js';
import MaximoClient from '../../../src/core/maximo/maximo-client.js';
import MaximoConfig from '../../../src/core/maximo/maximo-config.js';

function client(overrides) {
    const instance = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() }));
    return Object.assign(instance, overrides);
}

function tempFile(name, content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-deploy-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

describe('deployScreen', () => {
    it('reports a parse error without contacting Maximo', async () => {
        const file = tempFile('broken.xml', '<presentation');
        const { ui, calls } = createRecordingUi();
        const maximo = client({ postScreen: async () => assert.fail('should not post') });

        assert.strictEqual(await deployScreen(maximo, ui, file, ''), false);
        assert.match(calls.find((call) => call.method === 'error').message, /^Error parsing broken\.xml/);
    });

    it('posts a valid screen and reports success', async () => {
        const file = tempFile('coretest.xml', '<presentation id="CORETEST"></presentation>');
        const { ui } = createRecordingUi();
        let posted;
        const maximo = client({
            postScreen: async (screen) => {
                posted = screen;
                return { status: 'success' };
            }
        });

        assert.strictEqual(await deployScreen(maximo, ui, file, ''), true);
        assert.match(posted, /CORETEST/);
    });
});

describe('deployScript', () => {
    it('shows the server message when Maximo rejects the script', async () => {
        const file = tempFile('coretest.js', 'main();');
        const { ui, calls } = createRecordingUi();
        const maximo = client({ postScript: async () => ({ status: 'error', message: 'BMXAA0002E bad script' }) });

        assert.strictEqual(await deployScript(maximo, ui, file, ''), false);
        assert.deepStrictEqual(
            calls.filter((call) => call.method === 'error').map((call) => call.message),
            ['BMXAA0002E bad script']
        );
    });

    it('applies the predeploy configuration before the script', async () => {
        const file = tempFile('coretest.js', 'main();');
        fs.writeFileSync(file.replace(/\.js$/, '.predeploy.json'), JSON.stringify({ properties: [] }));
        const order = [];
        const { ui } = createRecordingUi();
        const maximo = client({
            postConfig: async () => order.push('config'),
            postScript: async () => {
                order.push('script');
                return { status: 'success' };
            }
        });

        assert.strictEqual(await deployScript(maximo, ui, file, ''), true);
        assert.deepStrictEqual(order, ['config', 'script']);
    });

    it('reports the deployed script to onDeployed', async () => {
        const file = tempFile('coretest.js', 'main();');
        const { ui } = createRecordingUi();
        const maximo = client({ postScript: async () => ({ status: 'success', scriptName: 'CORETEST' }) });
        const seen = [];

        assert.strictEqual(await deployScript(maximo, ui, file, '', { onDeployed: (result) => seen.push(result.scriptName) }), true);
        assert.deepStrictEqual(seen, ['CORETEST']);
    });

    it('does not report a script Maximo rejects', async () => {
        const file = tempFile('coretest.js', 'main();');
        const { ui } = createRecordingUi();
        const maximo = client({ postScript: async () => ({ status: 'error', message: 'rejected' }) });

        assert.strictEqual(await deployScript(maximo, ui, file, '', { onDeployed: () => assert.fail('should not report') }), false);
    });
});

describe('create-only deployers', () => {
    it('deployScreen passes createOnly and returns SKIPPED when Maximo kept the screen', async () => {
        const file = tempFile('coretest.xml', '<presentation id="CORETEST"></presentation>');
        const { ui } = createRecordingUi();
        let seen;
        const maximo = client({
            postScreen: async (screen, progress, fileName, options) => {
                seen = options;
                return { status: 'success', outcome: 'skipped' };
            }
        });

        assert.strictEqual(await deployScreen(maximo, ui, file, '', { createOnly: true }), SKIPPED);
        assert.deepStrictEqual(seen, { createOnly: true });
    });

    it('deployScreen returns true when a create-only screen was created', async () => {
        const file = tempFile('coretest.xml', '<presentation id="CORETEST"></presentation>');
        const { ui } = createRecordingUi();
        const maximo = client({ postScreen: async () => ({ status: 'success', outcome: 'created' }) });

        assert.strictEqual(await deployScreen(maximo, ui, file, '', { createOnly: true }), true);
    });

    it('deployForm passes createOnly and returns SKIPPED', async () => {
        const file = tempFile('form.json', JSON.stringify({ name: 'CORETEST', inspformnum: '1' }));
        const { ui } = createRecordingUi();
        let seen;
        const maximo = client({
            postForm: async (form, progress, options) => {
                seen = options;
                return { status: 'success', outcome: 'skipped' };
            }
        });

        assert.strictEqual(await deployForm(maximo, ui, file, '', { createOnly: true }), SKIPPED);
        assert.deepStrictEqual(seen, { createOnly: true });
    });

    it('deployReport passes createOnly and returns SKIPPED', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-report-'));
        const appDir = path.join(dir, 'WOTRACK');
        fs.mkdirSync(appDir);
        const file = path.join(appDir, 'coretest.rptdesign');
        fs.writeFileSync(file, '<report/>');
        fs.writeFileSync(
            path.join(appDir, 'reports.xml'),
            '<reports><report name="coretest.rptdesign"><attribute name="description">Core test</attribute></report></reports>'
        );
        const { ui } = createRecordingUi();
        let seen;
        const maximo = client({
            postReport: async (report, progress, fileName, options) => {
                seen = options;
                return { status: 'success', outcome: 'skipped' };
            }
        });

        assert.strictEqual(await deployReport(maximo, ui, file, '', { createOnly: true }), SKIPPED);
        assert.deepStrictEqual(seen, { createOnly: true });
    });

    it('deployScript returns SKIPPED, still reports the script, and applies no configuration', async () => {
        const file = tempFile('coretest.js', 'main();');
        fs.writeFileSync(file.replace(/\.js$/, '.json'), JSON.stringify({ properties: [] }));
        const { ui } = createRecordingUi();
        const reported = [];
        let seen;
        const maximo = client({
            postScript: async (script, progress, fileName, deployScriptSource, token, options) => {
                seen = options;
                return { status: 'success', outcome: 'skipped', scriptName: 'CORETEST' };
            },
            postConfig: async () => assert.fail('a skipped script must not apply configuration')
        });

        const result = await deployScript(maximo, ui, file, '', {
            sidecars: false,
            createOnly: true,
            onDeployed: (deployed) => reported.push(deployed.scriptName)
        });

        assert.strictEqual(result, SKIPPED);
        assert.deepStrictEqual(seen, { createOnly: true });
        assert.deepStrictEqual(reported, ['CORETEST']);
    });

    it('deployScript returns true for an ordinary deploy even if the server reports an outcome', async () => {
        const file = tempFile('coretest.js', 'main();');
        const { ui } = createRecordingUi();
        const maximo = client({ postScript: async () => ({ status: 'success', outcome: 'updated' }) });

        assert.strictEqual(await deployScript(maximo, ui, file, ''), true);
    });
});
