/*
 * Unit tests for the entry discovery used by the scaffolded webpack configuration.
 *
 *   npm run test:unit
 *
 * The module under test is a template file: it is copied into a user's workspace rather than
 * bundled into the extension, so it is deliberately free of webpack dependencies and can be
 * required directly here.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const webpackEntries = require('../../../templates/webpack-entries');

/** @type {string[]} */
const createdDirectories = [];

function createProject(files) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webpack-entries-'));
    createdDirectories.push(projectRoot);

    for (const [relativePath, contents] of Object.entries(files)) {
        const filePath = path.join(projectRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, contents, 'utf8');
    }

    return projectRoot;
}

/** A script declaring the scriptConfig block that makes it deployable. */
function script(autoscript) {
    return [
        '/** @maximoGlobal */', //
        'export const scriptConfig = {',
        `    autoscript: '${autoscript}',`,
        "    description: 'A script'",
        '};',
        ''
    ].join('\n');
}

/** A file with no scriptConfig: a helper that a script imports. */
const HELPER = 'export const help = () => 1;\n';

describe('webpack-entries', function () {
    after(function () {
        for (const directory of createdDirectories) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    describe('discoverScriptEntries', function () {
        it('treats a TypeScript file declaring scriptConfig as an entry', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch') });

            const entries = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entries.length, 1);
            assert.strictEqual(entries[0].autoscript, 'nv.automatch.rematch');
            assert.strictEqual(entries[0].sourcePath, path.join(projectRoot, 'rematch.ts'));
        });

        it('names the bundle after the autoscript rather than the file', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.filename, 'nv.automatch.rematch.js');
        });

        it('accepts any file name, not just index.ts', function () {
            const projectRoot = createProject({
                'first.ts': script('nv.first'),
                'second.ts': script('nv.second')
            });

            const names = webpackEntries
                .discoverScriptEntries(projectRoot)
                .map((entry) => entry.autoscript)
                .sort();

            assert.deepStrictEqual(names, ['nv.first', 'nv.second']);
        });

        it('ignores a file that declares no scriptConfig', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch'), 'helper.ts': HELPER });

            const entries = webpackEntries.discoverScriptEntries(projectRoot);

            assert.deepStrictEqual(
                entries.map((entry) => entry.autoscript),
                ['nv.automatch.rematch']
            );
        });

        it('ignores declaration files and dependencies', function () {
            const projectRoot = createProject({
                'rematch.ts': script('nv.automatch.rematch'),
                'globals.d.ts': script('nv.declaration'),
                'node_modules/a-package/index.ts': script('nv.dependency')
            });

            const entries = webpackEntries.discoverScriptEntries(projectRoot);

            assert.deepStrictEqual(
                entries.map((entry) => entry.autoscript),
                ['nv.automatch.rematch']
            );
        });

        it('ignores the runtime shim that every entry imports', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch'), 'runtime-globals.ts': HELPER });

            const entries = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entries.length, 1);
        });

        it('mirrors the source directory in the output path', function () {
            const projectRoot = createProject({ 'install/rematch.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.filename, path.posix.join('install', 'nv.automatch.rematch.js'));
        });

        it('drops the immediate parent directory when asked to', function () {
            // For the one folder per script layout, where the folder repeats the script identity.
            const projectRoot = createProject({ 'install/nv.automatch.rematch/index.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot, { dropParentDir: true });

            assert.strictEqual(entry.filename, path.posix.join('install', 'nv.automatch.rematch.js'));
        });

        it('keeps the parent directory by default', function () {
            const projectRoot = createProject({ 'install/nv.automatch.rematch/index.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.filename, path.posix.join('install', 'nv.automatch.rematch', 'nv.automatch.rematch.js'));
        });

        it('imports the runtime shim before the script itself', function () {
            const projectRoot = createProject({ 'install/rematch.ts': script('nv.automatch.rematch'), 'runtime-globals.ts': HELPER });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.deepStrictEqual(entry.import, ['./runtime-globals.ts', './install/rematch.ts']);
        });

        it('omits the runtime shim from the entry when the project has none', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.deepStrictEqual(entry.import, ['./rematch.ts']);
        });

        it('derives a usable JavaScript identifier for the library name', function () {
            const projectRoot = createProject({ 'rematch.ts': script('nv.automatch.rematch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.libraryName, 'nv_automatch_rematch');
        });

        it('fails naming the file when a script declares no autoscript name', function () {
            const projectRoot = createProject({ 'rematch.ts': "export const scriptConfig = { description: 'no name' };\n" });

            assert.throws(() => webpackEntries.discoverScriptEntries(projectRoot), /rematch\.ts/);
        });

        it('fails when two scripts claim the same autoscript name', function () {
            const projectRoot = createProject({ 'a.ts': script('nv.duplicate'), 'b.ts': script('nv.duplicate') });

            assert.throws(() => webpackEntries.discoverScriptEntries(projectRoot), /nv\.duplicate/);
        });

        it('fails when the project contains no script at all', function () {
            const projectRoot = createProject({ 'helper.ts': HELPER });

            assert.throws(() => webpackEntries.discoverScriptEntries(projectRoot), /scriptConfig/);
        });

        it('renames the sidecar files of a script after its autoscript name', function () {
            // They are named after the source so they stay obvious next to it, but the deploy
            // command looks for them beside the bundle, under the bundle's own name.
            const projectRoot = createProject({
                'install/rematch.ts': script('nv.automatch.rematch'),
                'install/rematch.predeploy.json': '{}',
                'install/rematch.json': '{}',
                'install/rematch-deploy.js': '',
                'install/rematch.deploy.js': ''
            });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.deepStrictEqual(
                entry.sidecars.map((sidecar) => path.basename(sidecar.to)).sort(),
                ['nv.automatch.rematch-deploy.js', 'nv.automatch.rematch.deploy.js', 'nv.automatch.rematch.json', 'nv.automatch.rematch.predeploy.json']
            );
        });

        it('places a sidecar beside its bundle', function () {
            const projectRoot = createProject({
                'install/rematch.ts': script('nv.automatch.rematch'),
                'install/rematch.predeploy.json': '{}'
            });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.sidecars[0].to, path.posix.join('install', 'nv.automatch.rematch.predeploy.json'));
            assert.strictEqual(entry.sidecars[0].from, path.join(projectRoot, 'install', 'rematch.predeploy.json'));
        });

        it('does not treat a file belonging to another script as a sidecar', function () {
            const projectRoot = createProject({
                'install/rematch.ts': script('nv.automatch.rematch'),
                'install/other.ts': script('nv.other'),
                'install/other.predeploy.json': '{}'
            });

            const [rematch] = webpackEntries.discoverScriptEntries(projectRoot).filter((entry) => entry.autoscript === 'nv.automatch.rematch');

            assert.deepStrictEqual(rematch.sidecars, []);
        });
    });

    describe('file naming', function () {
        // Extracted scripts are written under a lower cased file name, so a built bundle has to
        // agree with them or the same script ends up under two names in a workspace.
        it('lower cases the bundle name', function () {
            const projectRoot = createProject({ 'src/index.ts': script('NV.Automatch.ReMatch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.filename, path.posix.join('src', 'nv.automatch.rematch.js'));
        });

        it('lower cases a sidecar name so it still matches its bundle', function () {
            const projectRoot = createProject({
                'src/index.ts': script('NV.Automatch.ReMatch'),
                'src/index.predeploy.json': '{}'
            });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.sidecars[0].to, path.posix.join('src', 'nv.automatch.rematch.predeploy.json'));
        });

        it('keeps the autoscript name as written for deployment', function () {
            const projectRoot = createProject({ 'src/index.ts': script('NV.Automatch.ReMatch') });

            const [entry] = webpackEntries.discoverScriptEntries(projectRoot);

            assert.strictEqual(entry.autoscript, 'NV.Automatch.ReMatch');
        });

        it('rejects two scripts whose autoscript names differ only in case', function () {
            const projectRoot = createProject({
                'src/index.ts': script('nv.automatch.rematch'),
                'other/index.ts': script('NV.Automatch.ReMatch')
            });

            assert.throws(() => webpackEntries.discoverScriptEntries(projectRoot), /both declare the autoscript name/);
        });
    });
});
