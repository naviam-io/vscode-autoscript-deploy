/*
 * Unit tests for the webpack project helpers used when deploying TypeScript automation scripts.
 *
 *   npm run test:unit
 *
 * These tests run in plain Node (no VS Code host) against hermetic fixtures created under a
 * temporary directory. A fake "npm" and a fake local "webpack" binary are put on the PATH so that
 * no network access is required and the test cannot touch the real project.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const webpackProject = require('../../../src/webpack/webpack-project');

const IS_WINDOWS = process.platform === 'win32';

/** @type {string[]} */
const createdDirectories = [];

function createTempDirectory(prefix) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    createdDirectories.push(directory);
    return directory;
}

function writeFile(filePath, contents) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
}

/**
 * Creates a project whose webpack.config.js requires a module that only exists once dependencies
 * have been installed. Loading the configuration before the install therefore fails, which is the
 * defect this suite guards against.
 */
function createUninitializedProject() {
    const projectRoot = createTempDirectory('webpack-project-');

    writeFile(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '1.0.0', devDependencies: { webpack: '5.0.0', 'fixture-plugin': '1.0.0' } }, null, 2)
    );

    writeFile(
        path.join(projectRoot, 'webpack.config.js'),
        [
            "const path = require('path');",
            // Only resolvable after the dependencies have been installed.
            "require('fixture-plugin');",
            'module.exports = {',
            "    entry: { bundle: './src/index.ts' },",
            '    output: {',
            "        path: path.resolve(__dirname, 'dist'),",
            "        filename: 'bundle.js'",
            '    }',
            '};',
            ''
        ].join('\n')
    );

    writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n');

    return projectRoot;
}

/**
 * Puts a fake npm on the PATH. It installs "fixture-plugin" and a fake local webpack binary that
 * writes the bundle and reports it in the build statistics, so the whole flow runs offline and in
 * milliseconds.
 */
function withFakeNpmOnPath(callback) {
    const binDirectory = createTempDirectory('webpack-project-bin-');
    const npmPath = path.join(binDirectory, 'npm');

    fs.writeFileSync(
        npmPath,
        [
            '#!/bin/sh',
            'set -e',
            'mkdir -p node_modules/fixture-plugin node_modules/.bin',
            'printf \'{"name":"fixture-plugin","version":"1.0.0","main":"index.js"}\' > node_modules/fixture-plugin/package.json',
            'printf \'module.exports = {};\' > node_modules/fixture-plugin/index.js',
            "cat > node_modules/.bin/webpack <<'WEBPACK'",
            ...FAKE_WEBPACK_SCRIPT,
            'WEBPACK',
            'chmod +x node_modules/.bin/webpack',
            ''
        ].join('\n'),
        { mode: 0o755 }
    );

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDirectory}${path.delimiter}${originalPath}`;

    return Promise.resolve()
        .then(callback)
        .finally(() => {
            process.env.PATH = originalPath;
        });
}

/**
 * A stand-in for the webpack 5 command line: it emits dist/bundle.js from src/index.ts and reports
 * that in the statistics requested through --json, the way the real command line does.
 */
const FAKE_WEBPACK_SCRIPT = [
    '#!/bin/sh',
    'root=$(pwd -P)',
    '/bin/mkdir -p dist',
    'printf "bundled" > dist/bundle.js',
    'for argument in "$@"; do',
    '    case "$argument" in --json=*) statsPath="${argument#--json=}" ;; esac',
    'done',
    '[ -z "$statsPath" ] && exit 0',
    '/bin/cat > "$statsPath" <<STATS',
    '{"outputPath":"$root/dist",',
    ' "modules":[{"nameForCondition":"$root/src/index.ts","depth":0,"chunks":[1]}],',
    ' "entrypoints":{"bundle":{"chunks":[1],"assets":[{"name":"bundle.js"}]}}}',
    'STATS'
];

describe('webpack-project', function () {
    after(function () {
        for (const directory of createdDirectories) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    describe('findNearestWebpackProject', function () {
        it('returns the closest directory containing webpack.config.js', function () {
            const workspaceRoot = createTempDirectory('webpack-nearest-');
            const projectRoot = path.join(workspaceRoot, 'scripts');
            writeFile(path.join(workspaceRoot, 'webpack.config.js'), 'module.exports = {};\n');
            writeFile(path.join(projectRoot, 'webpack.config.js'), 'module.exports = {};\n');
            fs.mkdirSync(path.join(projectRoot, 'install', 'nv.example'), { recursive: true });

            const found = webpackProject.findNearestWebpackProject(path.join(projectRoot, 'install', 'nv.example'), workspaceRoot);

            assert.ok(found, 'expected a webpack project to be found');
            assert.strictEqual(fs.realpathSync(found.projectRoot), fs.realpathSync(projectRoot));
        });

        it('returns undefined when no webpack.config.js exists inside the workspace', function () {
            const workspaceRoot = createTempDirectory('webpack-none-');
            fs.mkdirSync(path.join(workspaceRoot, 'scripts'), { recursive: true });

            assert.strictEqual(webpackProject.findNearestWebpackProject(path.join(workspaceRoot, 'scripts'), workspaceRoot), undefined);
        });
    });

    describe('prepareWebpackBuild', function () {
        it('installs dependencies before loading the webpack configuration', { skip: IS_WINDOWS }, function () {
            const projectRoot = createUninitializedProject();
            const sourceFilePath = path.join(projectRoot, 'src', 'index.ts');

            return withFakeNpmOnPath(async () => {
                const result = await webpackProject.prepareWebpackBuild(sourceFilePath, projectRoot);

                assert.strictEqual(fs.realpathSync(result.outputFilePath), fs.realpathSync(path.join(projectRoot, 'dist', 'bundle.js')));
                assert.ok(fs.existsSync(result.outputFilePath), 'expected the webpack output file to exist');
            });
        });

        it('reports an unresolvable output instead of failing silently', async function () {
            const projectRoot = createTempDirectory('webpack-nodep-');
            writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', devDependencies: { webpack: '5.0.0' } }, null, 2));
            writeFile(path.join(projectRoot, 'webpack.config.js'), 'module.exports = {};\n');
            writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n');

            await withFakeNpmOnPath(async () => {
                // The fake webpack reports src/index.ts, so ask for a file it never names.
                await assert.rejects(() => webpackProject.prepareWebpackBuild(path.join(projectRoot, 'src', 'other.ts'), projectRoot), /is not a webpack entry/);
            });
        });

        it('builds with a globally installed webpack when the project declares no local webpack', { skip: IS_WINDOWS }, function () {
            const projectRoot = createTempDirectory('webpack-global-');
            writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
            writeFile(path.join(projectRoot, 'webpack.config.js'), 'module.exports = {};\n');
            writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n');

            const binDirectory = createTempDirectory('webpack-global-bin-');
            fs.writeFileSync(path.join(binDirectory, 'webpack'), `${FAKE_WEBPACK_SCRIPT.join('\n')}\n`, { mode: 0o755 });

            const originalPath = process.env.PATH;
            process.env.PATH = binDirectory;

            return webpackProject
                .prepareWebpackBuild(path.join(projectRoot, 'src', 'index.ts'), projectRoot)
                .then((result) => {
                    assert.strictEqual(fs.realpathSync(result.outputFilePath), fs.realpathSync(path.join(projectRoot, 'dist', 'bundle.js')));
                })
                .finally(() => {
                    process.env.PATH = originalPath;
                });
        });

        it('reports the dependency problem when neither a local nor a global webpack can be run', { skip: IS_WINDOWS }, function () {
            const projectRoot = createTempDirectory('webpack-nowebpack-');
            writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
            writeFile(
                path.join(projectRoot, 'webpack.config.js'),
                [
                    "const path = require('path');",
                    'module.exports = {',
                    "    entry: './src/index.ts',",
                    "    output: { path: path.resolve(__dirname, 'dist'), filename: 'bundle.js' }",
                    '};',
                    ''
                ].join('\n')
            );
            writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n');

            const emptyBinDirectory = createTempDirectory('webpack-empty-bin-');
            const originalPath = process.env.PATH;
            process.env.PATH = emptyBinDirectory;

            return assert
                .rejects(() => webpackProject.prepareWebpackBuild(path.join(projectRoot, 'src', 'index.ts'), projectRoot), /Webpack is not defined in package.json/)
                .finally(() => {
                    process.env.PATH = originalPath;
                });
        });

        it('returns undefined when the file is not inside a webpack project', async function () {
            const workspaceRoot = createTempDirectory('webpack-outside-');
            writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export const value = 1;\n');

            assert.strictEqual(await webpackProject.prepareWebpackBuild(path.join(workspaceRoot, 'src', 'index.ts'), workspaceRoot), undefined);
        });
    });

    describe('prepareWebpackBuild with a stats reporting webpack', function () {
        /**
         * Creates a project whose local webpack records how it was invoked, writes the supplied
         * statistics to the file given by --json, and emits the listed bundles.
         */
        function createStatsProject({ stats, emits = [] }) {
            const projectRoot = fs.realpathSync(createTempDirectory('webpack-stats-'));
            writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', devDependencies: { webpack: '5.0.0' } }, null, 2));
            writeFile(path.join(projectRoot, 'webpack.config.js'), 'module.exports = {};\n');
            writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n');
            writeFile(path.join(projectRoot, 'fixture-stats.json'), JSON.stringify(typeof stats === 'function' ? stats(projectRoot) : stats));

            const argumentsPath = path.join(projectRoot, 'webpack-arguments.txt');
            writeFile(
                path.join(projectRoot, 'node_modules', '.bin', 'webpack'),
                [
                    '#!/bin/sh',
                    `printf '%s\\n' "$@" > "${argumentsPath}"`,
                    'for argument in "$@"; do',
                    '    case "$argument" in --json=*) statsPath="${argument#--json=}" ;; esac',
                    'done',
                    `[ -n "$statsPath" ] && cp "${path.join(projectRoot, 'fixture-stats.json')}" "$statsPath"`,
                    ...emits.map((emitted) => `mkdir -p "$(dirname "${path.join(projectRoot, emitted)}")" && printf 'bundled' > "${path.join(projectRoot, emitted)}"`),
                    'exit 0',
                    ''
                ].join('\n')
            );
            fs.chmodSync(path.join(projectRoot, 'node_modules', '.bin', 'webpack'), 0o755);

            return {
                projectRoot,
                sourceFilePath: path.join(projectRoot, 'src', 'index.ts'),
                webpackArguments: () => fs.readFileSync(argumentsPath, 'utf8').trim().split('\n')
            };
        }

        /** Statistics mapping src/index.ts onto dist/nv.example.js. */
        function singleBundleStats(projectRoot) {
            return {
                outputPath: path.join(projectRoot, 'dist'),
                modules: [{ nameForCondition: path.join(projectRoot, 'src', 'index.ts'), depth: 0, chunks: [1] }],
                entrypoints: { 'nv.example': { chunks: [1], assets: [{ name: 'nv.example.js' }] } }
            };
        }

        it('deploys the bundle that webpack reported for the source file', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            const result = await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot);

            assert.strictEqual(result.outputFilePath, path.join(project.projectRoot, 'dist', 'nv.example.js'));
            assert.ok(fs.existsSync(result.outputFilePath), 'expected the reported bundle to exist');
        });

        it('builds in development mode by default', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot);

            assert.ok(project.webpackArguments().includes('--mode'), 'expected a mode to be passed');
            assert.ok(project.webpackArguments().includes('development'), `expected a development build, got ${project.webpackArguments().join(' ')}`);
        });

        it('builds in the requested mode', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot, undefined, 'production');

            assert.ok(project.webpackArguments().includes('production'), `expected a production build, got ${project.webpackArguments().join(' ')}`);
        });

        it('tells the configuration which source file is being deployed', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot);

            assert.ok(
                project.webpackArguments().includes(`mdtSourceFile=${project.sourceFilePath}`),
                `expected the source file to be passed as an env value, got ${project.webpackArguments().join(' ')}`
            );
        });

        it('requests the statistics it needs, overriding the ones the configuration asks for', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot);

            const webpackArguments = project.webpackArguments();
            assert.ok(webpackArguments.includes('--stats'), `expected an explicit stats preset, got ${webpackArguments.join(' ')}`);
            assert.ok(webpackArguments.includes('normal'), `expected the normal stats preset, got ${webpackArguments.join(' ')}`);
            assert.ok(
                webpackArguments.some((argument) => argument.startsWith('--json=')),
                `expected the statistics to be written to a file, got ${webpackArguments.join(' ')}`
            );
        });

        it('removes the statistics file once the build has been resolved', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({ stats: singleBundleStats, emits: ['dist/nv.example.js'] });

            await webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot);

            const statsPath = project
                .webpackArguments()
                .find((argument) => argument.startsWith('--json='))
                .substring('--json='.length);
            assert.strictEqual(fs.existsSync(statsPath), false, `expected ${statsPath} to be cleaned up`);
        });

        it('reports that a source file outside every bundle cannot be deployed', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({
                stats: (projectRoot) => ({
                    outputPath: path.join(projectRoot, 'dist'),
                    modules: [{ nameForCondition: path.join(projectRoot, 'src', 'other.ts'), depth: 0, chunks: [1] }],
                    entrypoints: { other: { chunks: [1], assets: [{ name: 'other.js' }] } }
                }),
                emits: ['dist/other.js']
            });

            await assert.rejects(() => webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot), /is not a webpack entry/);
        });

        it('tells the user to deploy the script itself when given a file it merely imports', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({
                stats: (projectRoot) => ({
                    outputPath: path.join(projectRoot, 'dist'),
                    modules: [
                        { nameForCondition: path.join(projectRoot, 'src', 'entry.ts'), depth: 0, chunks: [1] },
                        { nameForCondition: path.join(projectRoot, 'src', 'index.ts'), depth: 1, chunks: [1] }
                    ],
                    entrypoints: { 'nv.example': { chunks: [1], assets: [{ name: 'nv.example.js' }] } }
                }),
                emits: ['dist/nv.example.js']
            });

            await assert.rejects(() => webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot), /scriptConfig/);
        });

        it('refuses to guess when the source file is shared by several bundles', { skip: IS_WINDOWS }, async function () {
            const project = createStatsProject({
                stats: (projectRoot) => ({
                    outputPath: path.join(projectRoot, 'dist'),
                    modules: [{ nameForCondition: path.join(projectRoot, 'src', 'index.ts'), depth: 0, chunks: [1, 2] }],
                    entrypoints: {
                        first: { chunks: [1], assets: [{ name: 'first.js' }] },
                        second: { chunks: [2], assets: [{ name: 'second.js' }] }
                    }
                }),
                emits: ['dist/first.js', 'dist/second.js']
            });

            await assert.rejects(() => webpackProject.prepareWebpackBuild(project.sourceFilePath, project.projectRoot), /first\.js.*second\.js|several bundles/s);
        });
    });

    describe('resolveOutputFilesFromStats', function () {
        const projectRoot = path.resolve('/tmp/example-project');

        /** Builds the shape that "webpack --json --stats normal" produces for one compiler. */
        function stats({ outputPath = path.join(projectRoot, 'dist'), modules = [], entrypoints = {} }) {
            return { outputPath, modules, entrypoints };
        }

        /** An entry module: webpack reports depth 0 for the files an entry names directly. */
        function entryModule(filePath, chunks) {
            return { nameForCondition: filePath, depth: 0, chunks };
        }

        /** An imported module: anything an entry reaches through an import has a depth above 0. */
        function importedModule(filePath, chunks) {
            return { nameForCondition: filePath, depth: 1, chunks };
        }

        function entrypoint(chunks, assetNames) {
            return { chunks, assets: assetNames.map((name) => ({ name })) };
        }

        it('resolves an entry source file to the JavaScript asset of its entrypoint', function () {
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'install', 'rematch.ts'), [179])],
                    entrypoints: { 'nv.automatch.rematch': entrypoint([179], ['install/nv.automatch.rematch.js']) }
                }),
                path.join(projectRoot, 'install', 'rematch.ts')
            );

            assert.deepStrictEqual(resolved, [path.join(projectRoot, 'dist', 'install', 'nv.automatch.rematch.js')]);
        });

        it('resolves a source file whose bundle file name contains a content hash', function () {
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'src', 'index.ts'), [1])],
                    entrypoints: { main: entrypoint([1], ['main.81ffc998.js']) }
                }),
                path.join(projectRoot, 'src', 'index.ts')
            );

            assert.deepStrictEqual(resolved, [path.join(projectRoot, 'dist', 'main.81ffc998.js')]);
        });

        it('ignores emitted assets that are not JavaScript', function () {
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'src', 'index.ts'), [1])],
                    entrypoints: { main: entrypoint([1], ['main.js.LICENSE.txt', 'main.js', 'main.js.map']) }
                }),
                path.join(projectRoot, 'src', 'index.ts')
            );

            assert.deepStrictEqual(resolved, [path.join(projectRoot, 'dist', 'main.js')]);
        });

        it('resolves each compiler of an array configuration independently', function () {
            const arrayStats = {
                children: [
                    stats({
                        modules: [entryModule(path.join(projectRoot, 'foo', 'main.ts'), [1])],
                        entrypoints: { foo: entrypoint([1], ['foo.js']) }
                    }),
                    stats({
                        modules: [entryModule(path.join(projectRoot, 'bar', 'main.ts'), [1])],
                        entrypoints: { bar: entrypoint([1], ['bar.js']) }
                    })
                ]
            };

            const resolved = webpackProject.resolveOutputFilesFromStats(arrayStats, path.join(projectRoot, 'bar', 'main.ts'));

            assert.deepStrictEqual(resolved, [path.join(projectRoot, 'dist', 'bar.js')]);
        });

        it('returns nothing for a file that is only imported by an entry', function () {
            // Only the script declaring scriptConfig is deployable. A library file belongs to a
            // bundle but is not one, so resolving it would deploy the wrong thing under its name.
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'src', 'index.ts'), [1]), importedModule(path.join(projectRoot, 'src', 'helper.ts'), [1])],
                    entrypoints: { main: entrypoint([1], ['main.js']) }
                }),
                path.join(projectRoot, 'src', 'helper.ts')
            );

            assert.deepStrictEqual(resolved, []);
        });

        it('returns nothing for an imported file that webpack concatenated into its entry', function () {
            // Production mode nests the concatenated modules and empties their chunk ids. The file
            // must stay undeployable there too, or the same file would behave differently per mode.
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [
                        {
                            name: './src/index.ts + 1 modules',
                            nameForCondition: path.join(projectRoot, 'src', 'index.ts'),
                            depth: 0,
                            chunks: [885],
                            modules: [
                                { nameForCondition: path.join(projectRoot, 'src', 'index.ts'), depth: 0, chunks: [] },
                                { nameForCondition: path.join(projectRoot, 'src', 'helper.ts'), depth: 1, chunks: [] }
                            ]
                        },
                        importedModule(path.join(projectRoot, 'src', 'helper.ts'), [])
                    ],
                    entrypoints: { main: entrypoint([885], ['main.js']) }
                }),
                path.join(projectRoot, 'src', 'helper.ts')
            );

            assert.deepStrictEqual(resolved, []);
        });

        it('returns nothing for a file that no entry reaches at all', function () {
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'src', 'index.ts'), [1])],
                    entrypoints: { main: entrypoint([1], ['main.js']) }
                }),
                path.join(projectRoot, 'src', 'orphan.ts')
            );

            assert.deepStrictEqual(resolved, []);
        });

        it('returns every bundle when one entry file is shared by several entrypoints', function () {
            // The template's runtime shim is named by every entry, so it resolves ambiguously.
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'runtime-globals.ts'), [1, 2])],
                    entrypoints: { foo: entrypoint([1], ['foo.js']), bar: entrypoint([2], ['bar.js']) }
                }),
                path.join(projectRoot, 'runtime-globals.ts')
            );

            assert.deepStrictEqual(resolved.sort(), [path.join(projectRoot, 'dist', 'bar.js'), path.join(projectRoot, 'dist', 'foo.js')]);
        });

        it('does not confuse a source file with one whose path ends in the same characters', function () {
            const resolved = webpackProject.resolveOutputFilesFromStats(
                stats({
                    modules: [entryModule(path.join(projectRoot, 'src', 'rematch.ts'), [1])],
                    entrypoints: { main: entrypoint([1], ['main.js']) }
                }),
                path.join(projectRoot, 'src', 'match.ts')
            );

            assert.deepStrictEqual(resolved, []);
        });
    });
});
