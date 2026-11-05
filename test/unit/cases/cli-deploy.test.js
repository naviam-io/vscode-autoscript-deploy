/*
 * Unit tests for how the CLI deploy command routes files to the core deployers, against a stubbed MaximoClient.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecordingUi } from '../support/recording-ui.js';
import MaximoClient from '../../../src/core/maximo/maximo-client.js';
import MaximoConfig from '../../../src/core/maximo/maximo-config.js';
import { classifyFile, collectFiles, deployFile, runDeploy } from '../../../cli/lib/deploy.js';

function client(overrides) {
    const instance = new MaximoClient(new MaximoConfig({ host: 'maximo.example.com', resourcesDir: os.tmpdir() }));
    return Object.assign(instance, { dbConfigRequired: async () => false, getRetainedSnapshots: async () => [] }, overrides);
}

function directory(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-deploy-'));
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
}

const noBuild = async () => assert.fail('should not build');
const quiet = () => {};

describe('CLI deploy routing', () => {
    it('classifies companions and metadata as not deployable on their own', () => {
        const dir = directory({ 'a.js': '', 'a.json': '{}', 'a.predeploy.json': '{}', 'a-deploy.js': '', 'reports.xml': '', 'b.ts': '', 'b.json': '{}', 'form.json': '{}', 'types.d.ts': '' });
        const kind = (name) => classifyFile(path.join(dir, name));

        assert.strictEqual(kind('a.js'), 'script');
        assert.strictEqual(kind('a.json'), null);
        assert.strictEqual(kind('a.predeploy.json'), null);
        assert.strictEqual(kind('a-deploy.js'), null);
        assert.strictEqual(kind('reports.xml'), null);
        assert.strictEqual(kind('b.ts'), 'typescript');
        assert.strictEqual(kind('b.json'), null);
        assert.strictEqual(kind('types.d.ts'), null);
        assert.strictEqual(kind('form.json'), 'json');
        assert.strictEqual(kind('screen.xml'), 'screen');
        assert.strictEqual(kind('report.rptdesign'), 'report');
        assert.strictEqual(kind('notes.txt'), null);
    });

    it('walks a directory without node_modules, hidden folders, tooling JSON or TypeScript', () => {
        const dir = directory({
            'a.js': '',
            'sub/b.py': '',
            'src/c.ts': '',
            'node_modules/d.js': '',
            '.vscode/settings.json': '{}',
            'package.json': '{}',
            'tsconfig.json': '{}',
            'config.json': '{}'
        });

        assert.deepStrictEqual(collectFiles(dir, true).map((file) => path.relative(dir, file)).sort(), ['a.js', 'config.json', path.join('sub', 'b.py')]);
        assert.deepStrictEqual(collectFiles(dir, false).map((file) => path.relative(dir, file)).sort(), ['a.js', 'config.json']);
    });

    it('deploys configuration JSON as configuration, not as an inspection form', async () => {
        const dir = directory({ 'properties.json': JSON.stringify({ properties: [{ propName: 'NVTEST.PROP' }] }) });
        const posted = [];
        const maximo = client({ postConfig: async (config) => posted.push(config), postForm: async () => assert.fail('not a form') });
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployFile(maximo, ui, path.join(dir, 'properties.json'), { buildTypeScript: noBuild }), true);
        assert.deepStrictEqual(posted, [{ properties: [{ propName: 'NVTEST.PROP' }] }]);
    });

    it('deploys an inspection form as a form', async () => {
        const dir = directory({ 'form.json': JSON.stringify({ inspformnum: '1001', name: 'NVTEST' }) });
        let posted;
        const maximo = client({ postForm: async (form) => { posted = form; return { status: 'success' }; } });
        const { ui } = createRecordingUi();

        assert.strictEqual(await deployFile(maximo, ui, path.join(dir, 'form.json'), { buildTypeScript: noBuild }), true);
        assert.strictEqual(posted.name, 'NVTEST');
    });

    it('builds TypeScript and deploys it with the source companions', async () => {
        const dir = directory({ 'src/nvtest.ts': 'export {}', 'src/nvtest.predeploy.json': JSON.stringify({ properties: [] }), 'dist/nvtest.js': 'main();' });
        const order = [];
        const maximo = client({
            postConfig: async () => order.push('predeploy'),
            postScript: async (script) => { order.push(script); return { status: 'success', scriptName: 'NVTEST' }; }
        });
        const { ui } = createRecordingUi();
        const build = async (file) => { order.push(path.basename(file)); return { outputFilePath: path.join(dir, 'dist', 'nvtest.js'), sourceText: 'main();' }; };

        assert.strictEqual(await deployFile(maximo, ui, path.join(dir, 'src', 'nvtest.ts'), { buildTypeScript: build }), true);
        assert.deepStrictEqual(order, ['nvtest.ts', 'predeploy', 'main();']);
    });

    it('shows a thrown error and reports the file as failed', async () => {
        const dir = directory({ 'broken.json': JSON.stringify({ properties: [] }) });
        const maximo = client({ postConfig: async () => { throw new Error('BMXAA0001E rejected'); } });
        const { ui, calls } = createRecordingUi();

        assert.strictEqual(await deployFile(maximo, ui, path.join(dir, 'broken.json'), { buildTypeScript: noBuild }), false);
        assert.match(calls.find((call) => call.method === 'error').message, /BMXAA0001E rejected/);
    });

    it('reports JSON that does not parse', async () => {
        const dir = directory({ 'bad.json': '{ properties' });
        const { ui, calls } = createRecordingUi();

        assert.strictEqual(await deployFile(client({}), ui, path.join(dir, 'bad.json'), { buildTypeScript: noBuild }), false);
        assert.match(calls.find((call) => call.method === 'error').message, /not valid JSON/);
    });
});

describe('CLI deploy command', () => {
    it('counts a failed file and carries on', async () => {
        const dir = directory({ 'a.js': 'bad();', 'b.xml': '<presentation id="NVTEST"></presentation>' });
        let screens = 0;
        const maximo = client({
            postScript: async () => ({ status: 'error', message: 'rejected' }),
            postScreen: async () => { screens++; return { status: 'success' }; }
        });
        const { ui } = createRecordingUi();

        const { failed } = await runDeploy(maximo, ui, { directory: dir, recursive: true }, { buildTypeScript: noBuild, out: quiet });

        assert.strictEqual(failed, 1);
        assert.strictEqual(screens, 1);
    });

    it('deploys a single file relative to the directory', async () => {
        const dir = directory({ 'a.js': 'main();', 'b.js': 'main();' });
        const deployed = [];
        const maximo = client({ postScript: async (script, progress, fileName) => { deployed.push(fileName); return { status: 'success', scriptName: 'A' }; } });
        const { ui } = createRecordingUi();

        assert.deepStrictEqual(await runDeploy(maximo, ui, { directory: dir, file: 'a.js' }, { buildTypeScript: noBuild, out: quiet }), { failed: 0 });
        assert.deepStrictEqual(deployed, ['a.js']);
    });

    it('deletes the scripts in the delete list after a directory deploy', async () => {
        const dir = directory({ 'a.js': 'main();' });
        const list = path.join(dir, 'delete.json');
        fs.writeFileSync(list, JSON.stringify(['NVTEST.OLD', 'NVTEST.GONE']));
        const deleted = [];
        const maximo = client({
            postScript: async () => ({ status: 'success', scriptName: 'A' }),
            deleteScriptIfExists: async (name) => { deleted.push(name); return name === 'NVTEST.OLD'; }
        });
        const { ui } = createRecordingUi();
        const lines = [];

        const { failed } = await runDeploy(maximo, ui, { directory: dir, recursive: true, deleteList: list }, { buildTypeScript: noBuild, out: (line) => lines.push(line) });

        assert.strictEqual(failed, 0);
        assert.deepStrictEqual(deleted, ['NVTEST.OLD', 'NVTEST.GONE']);
        assert.ok(lines.includes('Deleted script NVTEST.OLD'));
        assert.ok(lines.includes('Script NVTEST.GONE does not exist'));
    });

    it('deletes every other script with deleteAll', async () => {
        const dir = directory({ 'a.js': 'main();' });
        const deleted = [];
        const maximo = client({
            postScript: async () => ({ status: 'success', scriptName: 'NVTEST.A' }),
            getAllScriptNames: async () => [{ label: 'nvtest.a' }, { label: 'nvtest.b' }],
            deleteScriptIfExists: async (name) => { deleted.push(name); return true; }
        });
        const { ui } = createRecordingUi();

        assert.deepStrictEqual(await runDeploy(maximo, ui, { directory: dir, recursive: true, deleteAll: true }, { buildTypeScript: noBuild, out: quiet }), { failed: 0 });
        assert.deepStrictEqual(deleted, ['nvtest.b']);
    });

    it('refuses deleteAll when a deployed script returned no name or a file failed', async () => {
        const dir = directory({ 'a.js': 'main();' });
        const forbidden = { getAllScriptNames: async () => assert.fail('should not list'), deleteScriptIfExists: async () => assert.fail('should not delete') };

        const unnamed = createRecordingUi();
        await runDeploy(client({ ...forbidden, postScript: async () => ({ status: 'success' }) }), unnamed.ui, { directory: dir, recursive: true, deleteAll: true }, { buildTypeScript: noBuild, out: quiet });
        assert.match(unnamed.calls.find((call) => call.method === 'error').message, /did not return the name/);

        const failing = createRecordingUi();
        const result = await runDeploy(client({ ...forbidden, postScript: async () => ({ status: 'error', message: 'rejected' }) }), failing.ui, { directory: dir, recursive: true, deleteAll: true }, { buildTypeScript: noBuild, out: quiet });
        assert.strictEqual(result.failed, 2);
        assert.ok(failing.calls.some((call) => call.method === 'error' && /No scripts were deleted/.test(call.message)));
    });
});
