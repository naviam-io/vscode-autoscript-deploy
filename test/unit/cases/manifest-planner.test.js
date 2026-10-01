/*
 * Unit tests for the deployment manifest planner.
 *
 *   npm run test:unit
 *
 * The planner turns a manifest file into either an ordered list of deployment steps or a list of
 * validation errors. It runs in plain Node with no VS Code host and no Maximo server, against
 * hermetic fixtures created under a temporary directory.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    planManifest,
    isManifestDocument,
    isInspectionFormDocument,
    supportedKinds,
    extensionsForKinds
} = require('../../../src/deploy/manifest-planner');

/** @type {string[]} */
const createdDirectories = [];

after(() => {
    for (const directory of createdDirectories) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

/*
 * Writes the given files under a fresh temporary directory and returns its path. A file's value is
 * written verbatim when it is a string and serialised as JSON otherwise.
 */
function createProject(files) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-planner-'));
    createdDirectories.push(projectRoot);

    for (const [relativePath, contents] of Object.entries(files)) {
        const filePath = path.join(projectRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
    }

    return projectRoot;
}

function codesOf(result) {
    return result.errors.map((error) => error.code);
}

describe('planManifest', () => {
    it('plans explicit entries in the order they are listed', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': {
                manifest: [
                    { kind: 'configuration', path: './config/objects.json' },
                    { kind: 'databaseConfiguration' },
                    { kind: 'automationScript', path: './scripts/matcher.js' }
                ]
            },
            'config/objects.json': { objects: [] },
            'scripts/matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(
            result.steps.map((step) => step.kind),
            ['configuration', 'databaseConfiguration', 'automationScript']
        );
    });

    it('resolves entry paths against the directory of the manifest that declares them', () => {
        const projectRoot = createProject({
            'deployment/deploy.manifest.json': { manifest: [{ kind: 'automationScript', path: '../scripts/matcher.js' }] },
            'scripts/matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deployment', 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].path, path.join(projectRoot, 'scripts', 'matcher.js'));
    });

    it('plans a databaseConfiguration entry with no path', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'databaseConfiguration' }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(result.steps, [
            { kind: 'databaseConfiguration', path: null, sidecars: false, manifestPath: path.join(projectRoot, 'deploy.manifest.json') }
        ]);
    });

    it('does not discover sidecars for an entry that declares a kind', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js' }] },
            'matcher.js': '// matcher',
            'matcher.predeploy.json': { objects: [] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.strictEqual(result.steps[0].sidecars, false);
    });
});

describe('planManifest validation', () => {
    it('rejects an unknown kind', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'databaseConfigurations', path: './thing.json' }] },
            'thing.json': {}
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['unknownKind']);
    });

    it('plans nothing when any entry is invalid', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': {
                manifest: [{ kind: 'automationScript', path: './matcher.js' }, { kind: 'nonsense', path: './matcher.js' }]
            },
            'matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.steps, []);
    });

    it('reports every invalid entry rather than stopping at the first', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'nonsense', path: './a.js' }, { kind: 'configuration', path: './missing.json' }] },
            'a.js': '// a'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['unknownKind', 'fileNotFound']);
    });

    it('rejects an entry whose file does not exist', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'automationScript', path: './missing.js' }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['fileNotFound']);
    });

    it('rejects a file extension that does not match the declared kind', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'configuration', path: './matcher.js' }] },
            'matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['extensionMismatch']);
    });

    it('accepts every script extension for the script kinds', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': {
                manifest: [
                    { kind: 'automationScript', path: './a.ts' },
                    { kind: 'automationScript', path: './b.js' },
                    { kind: 'deployScript', path: './c.py' },
                    { kind: 'deployScript', path: './d.jy' }
                ]
            },
            'a.ts': '// a',
            'b.js': '// b',
            'c.py': '# c',
            'd.jy': '# d'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
    });

    it('rejects an entry that declares a kind but no path', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'configuration' }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['missingPath']);
    });

    it('rejects a databaseConfiguration entry that declares a path', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'databaseConfiguration', path: './config.json' }] },
            'config.json': {}
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['unexpectedPath']);
    });

    it('rejects a databaseConfiguration entry that carries any other property', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'databaseConfiguration', noAdminMode: true }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['unexpectedProperty']);
    });

    it('rejects an entry that is neither a path string nor an object with a path', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [42] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidEntry']);
    });

    it('rejects the same file listed twice', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': {
                manifest: [{ kind: 'automationScript', path: './matcher.js' }, { kind: 'automationScript', path: './scripts/../matcher.js' }]
            },
            'matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['duplicatePath']);
    });

    it('allows databaseConfiguration to appear more than once', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'databaseConfiguration' }, { kind: 'databaseConfiguration' }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps.length, 2);
    });

    it('rejects a manifest that is not valid JSON', () => {
        const projectRoot = createProject({ 'deploy.manifest.json': '{ not json' });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidManifest']);
    });

    it('rejects a manifest with no manifest array', () => {
        const projectRoot = createProject({ 'deploy.manifest.json': { manifest: 'everything' } });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidManifest']);
    });

    it('names the offending manifest and entry position in every error', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: [{ kind: 'automationScript', path: './missing.js' }] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.strictEqual(result.errors[0].manifestPath, path.join(projectRoot, 'deploy.manifest.json'));
        assert.strictEqual(result.errors[0].index, 0);
        assert.match(result.errors[0].message, /missing\.js/);
    });
});


describe('planManifest nesting', () => {
    it('expands a nested manifest in place', () => {
        const projectRoot = createProject({
            'install.manifest.json': {
                manifest: [
                    { kind: 'configuration', path: './base.json' },
                    { kind: 'manifest', path: './features/matching.manifest.json' },
                    { kind: 'automationScript', path: './last.js' }
                ]
            },
            'base.json': {},
            'last.js': '// last',
            'features/matching.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js' }] },
            'features/matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'install.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(
            result.steps.map((step) => step.path),
            [
                path.join(projectRoot, 'base.json'),
                path.join(projectRoot, 'features', 'matcher.js'),
                path.join(projectRoot, 'last.js')
            ]
        );
    });

    it('attributes a nested step to the manifest that declares it', () => {
        const projectRoot = createProject({
            'install.manifest.json': { manifest: [{ kind: 'manifest', path: './features/matching.manifest.json' }] },
            'features/matching.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js' }] },
            'features/matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'install.manifest.json'));

        assert.strictEqual(result.steps[0].manifestPath, path.join(projectRoot, 'features', 'matching.manifest.json'));
    });

    it('rejects a manifest that includes itself', () => {
        const projectRoot = createProject({
            'install.manifest.json': { manifest: [{ kind: 'manifest', path: './install.manifest.json' }] }
        });

        const result = planManifest(path.join(projectRoot, 'install.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['manifestCycle']);
    });

    it('rejects manifests that include each other', () => {
        const projectRoot = createProject({
            'a.manifest.json': { manifest: [{ kind: 'manifest', path: './b.manifest.json' }] },
            'b.manifest.json': { manifest: [{ kind: 'manifest', path: './a.manifest.json' }] }
        });

        const result = planManifest(path.join(projectRoot, 'a.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['manifestCycle']);
    });

    it('rejects nesting deeper than ten manifests', () => {
        const files = {};
        for (let level = 0; level <= 10; level++) {
            files[`m${level}.manifest.json`] = { manifest: [{ kind: 'manifest', path: `./m${level + 1}.manifest.json` }] };
        }
        files['m11.manifest.json'] = { manifest: [] };
        const projectRoot = createProject(files);

        const result = planManifest(path.join(projectRoot, 'm0.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['manifestTooDeep']);
    });

    it('rejects the same file deployed by two different manifests in one run', () => {
        const projectRoot = createProject({
            'install.manifest.json': {
                manifest: [
                    { kind: 'manifest', path: './one.manifest.json' },
                    { kind: 'manifest', path: './two.manifest.json' }
                ]
            },
            'one.manifest.json': { manifest: [{ kind: 'configuration', path: './shared.json' }] },
            'two.manifest.json': { manifest: [{ kind: 'configuration', path: './shared.json' }] },
            'shared.json': {}
        });

        const result = planManifest(path.join(projectRoot, 'install.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['duplicatePath']);
    });

    it('reports an unreadable nested manifest against the nested file', () => {
        const projectRoot = createProject({
            'install.manifest.json': { manifest: [{ kind: 'manifest', path: './broken.manifest.json' }] },
            'broken.manifest.json': '{ not json'
        });

        const result = planManifest(path.join(projectRoot, 'install.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidManifest']);
        assert.strictEqual(result.errors[0].manifestPath, path.join(projectRoot, 'broken.manifest.json'));
    });
});

describe('planManifest entries without a kind', () => {
    it('treats a bare string as a path', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./matcher.js'] },
            'matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].path, path.join(projectRoot, 'matcher.js'));
    });

    it('routes script files to automationScript and keeps their sidecars', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./a.js', './b.py', './c.jy', './d.ts'] },
            'a.js': '// a',
            'b.py': '# b',
            'c.jy': '# c',
            'd.ts': '// d'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(
            result.steps.map((step) => step.kind),
            ['automationScript', 'automationScript', 'automationScript', 'automationScript']
        );
        assert.ok(result.steps.every((step) => step.sidecars === true));
    });

    it('routes a screen definition and a report by extension', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./screen.xml', './report.rptdesign'] },
            'screen.xml': '<presentation/>',
            'report.rptdesign': '<report/>'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(
            result.steps.map((step) => step.kind),
            ['screen', 'report']
        );
        assert.ok(result.steps.every((step) => step.sidecars === false));
    });

    it('routes a JSON file with inspformnum to inspectionForm', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./form.json'] },
            'form.json': { inspformnum: 'FORM1' }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].kind, 'inspectionForm');
    });

    it('routes a JSON file with configuration properties to configuration', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./cron.json'] },
            'cron.json': { cronTasks: [] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].kind, 'configuration');
    });

    it('routes a JSON file with neither manifest nor inspformnum to configuration', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./custom.json'] },
            'custom.json': { somethingElse: [] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].kind, 'configuration');
    });

    it('routes a JSON file with inspformnum to inspectionForm even when it carries configuration properties', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./form.json'] },
            'form.json': { inspformnum: 'FORM1', cronTasks: [] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].kind, 'inspectionForm');
    });

    it('routes an object structure JSON file to configuration', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./objects.json'] },
            'objects.json': { objects: [] }
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(result.steps[0].kind, 'configuration');
    });

    it('expands a JSON file that is itself a manifest', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./nested.manifest.json'] },
            'nested.manifest.json': { manifest: ['./matcher.js'] },
            'matcher.js': '// matcher'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(
            result.steps.map((step) => step.kind),
            ['automationScript']
        );
    });

    it('rejects a file extension it cannot route rather than skipping it', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./notes.md'] },
            'notes.md': '# notes'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['unsupportedExtension']);
    });

    it('rejects a JSON file it cannot parse', () => {
        const projectRoot = createProject({
            'deploy.manifest.json': { manifest: ['./broken.json'] },
            'broken.json': '{ not json'
        });

        const result = planManifest(path.join(projectRoot, 'deploy.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidJson']);
    });
});

describe('JSON document classification', () => {
    it('recognises a manifest only when manifest is an array', () => {
        assert.strictEqual(isManifestDocument({ manifest: [] }), true);
        assert.strictEqual(isManifestDocument({ manifest: ['./a.js'], cronTasks: [] }), true);
        assert.strictEqual(isManifestDocument({ manifest: 'a.js' }), false);
        assert.strictEqual(isManifestDocument({ cronTasks: [] }), false);
    });

    it('recognises an inspection form by inspformnum', () => {
        assert.strictEqual(isInspectionFormDocument({ inspformnum: 'FORM1' }), true);
        assert.strictEqual(isInspectionFormDocument({ inspformnum: null }), true);
        assert.strictEqual(isInspectionFormDocument({ cronTasks: [] }), false);
    });

    it('rejects values that are not JSON objects', () => {
        for (const value of [null, undefined, 'manifest', 42]) {
            assert.strictEqual(isManifestDocument(value), false);
            assert.strictEqual(isInspectionFormDocument(value), false);
        }
    });
});

describe('the manifest schema', () => {
    const schema = require('../../../schemas/manifest-schema.json');

    it('offers exactly the kinds the planner accepts', () => {
        const fileKinds = schema.definitions.fileEntry.properties.kind.enum;
        const kinds = fileKinds.concat([schema.definitions.databaseConfigurationEntry.properties.kind.const]);

        assert.deepStrictEqual(kinds.slice().sort(), supportedKinds().slice().sort());
    });

    it('requires the same file extensions the planner does', () => {
        const extensionsByKind = {};
        for (const rule of schema.definitions.fileEntry.allOf) {
            const pattern = rule.then.properties.path.pattern;
            const extensions = pattern.replace(/^\\\.|\$$/g, '').replace(/^\(|\)$/g, '').split('|');
            for (const kind of rule.if.properties.kind.enum || [rule.if.properties.kind.const]) {
                extensionsByKind[kind] = extensions.map((extension) => `.${extension}`).sort();
            }
        }

        const plannerExtensions = extensionsForKinds();
        for (const [kind, extensions] of Object.entries(plannerExtensions)) {
            assert.deepStrictEqual(extensionsByKind[kind], extensions.slice().sort(), `extensions for ${kind}`);
        }
    });
});

describe('planManifest deprecation reporting', () => {
    it('reports nothing when every entry declares a kind', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js' }, { kind: 'databaseConfiguration' }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.deprecations, []);
    });

    it('reports an entry that declares no kind', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: ['./matcher.js'] }
        });

        const manifestPath = path.join(projectRoot, 'test.manifest.json');
        const result = planManifest(manifestPath);

        assert.deepStrictEqual(result.deprecations, [{ manifestPath, index: 0 }]);
    });

    it('reports an entry that is an object without a kind', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ path: './matcher.js' }] }
        });

        const manifestPath = path.join(projectRoot, 'test.manifest.json');
        const result = planManifest(manifestPath);

        assert.deepStrictEqual(result.deprecations, [{ manifestPath, index: 0 }]);
    });

    it('attributes a deprecated entry to the nested manifest that declares it', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ kind: 'manifest', path: './features/matching.manifest.json' }] },
            'features/matching.manifest.json': { manifest: ['../matcher.js'] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.deprecations, [{ manifestPath: path.join(projectRoot, 'features/matching.manifest.json'), index: 0 }]);
    });

    it('reports a nested manifest that is included without a kind', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: ['./features/matching.manifest.json'] },
            'features/matching.manifest.json': { manifest: [{ kind: 'automationScript', path: '../matcher.js' }] }
        });

        const manifestPath = path.join(projectRoot, 'test.manifest.json');
        const result = planManifest(manifestPath);

        assert.deepStrictEqual(result.deprecations, [{ manifestPath, index: 0 }]);
    });

    it('reports no deprecations when the manifest cannot be planned', () => {
        const projectRoot = createProject({ 'test.manifest.json': { manifest: ['./missing.js'] } });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.deprecations, []);
        assert.deepStrictEqual(codesOf(result), ['fileNotFound']);
    });
});

describe('planManifest disabled entries', () => {
    it('plans no step for a disabled entry', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'other.js': 'print("hi");',
            'test.manifest.json': {
                manifest: [
                    { kind: 'automationScript', path: './matcher.js', disabled: true },
                    { kind: 'automationScript', path: './other.js' }
                ]
            }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(
            result.steps.map((step) => step.path),
            [path.join(projectRoot, 'other.js')]
        );
    });

    it('plans the entry as usual when disabled is false', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js', disabled: false }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.strictEqual(result.steps.length, 1);
    });

    it('plans no step for a disabled database configuration entry', () => {
        const projectRoot = createProject({
            'test.manifest.json': { manifest: [{ kind: 'databaseConfiguration', disabled: true }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.steps, []);
        assert.deepStrictEqual(codesOf(result), []);
    });

    it('does not validate a disabled entry, so its file need not exist', () => {
        const projectRoot = createProject({
            'test.manifest.json': { manifest: [{ kind: 'automationScript', path: './missing.js', disabled: true }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(codesOf(result), []);
        assert.deepStrictEqual(result.steps, []);
    });

    it('skips a disabled nested manifest entirely', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ kind: 'manifest', path: './features/matching.manifest.json', disabled: true }] },
            'features/matching.manifest.json': { manifest: [{ kind: 'automationScript', path: '../matcher.js' }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.steps, []);
    });

    it('does not reserve the path of a disabled entry, so another entry may still deploy it', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': {
                manifest: [
                    { kind: 'automationScript', path: './matcher.js', disabled: true },
                    { kind: 'automationScript', path: './matcher.js' }
                ]
            }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(codesOf(result), []);
        assert.strictEqual(result.steps.length, 1);
    });

    it('does not report a disabled entry that declares no kind as deprecated', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ path: './matcher.js', disabled: true }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(result.deprecations, []);
    });

    it('reports each disabled entry so the caller can say what was skipped', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': {
                manifest: [{ kind: 'automationScript', path: './matcher.js' }, { kind: 'databaseConfiguration', disabled: true }]
            }
        });

        const manifestPath = path.join(projectRoot, 'test.manifest.json');
        const result = planManifest(manifestPath);

        assert.deepStrictEqual(result.disabled, [{ manifestPath, index: 1 }]);
    });

    it('rejects a disabled value that is not a boolean', () => {
        const projectRoot = createProject({
            'matcher.js': 'print("hi");',
            'test.manifest.json': { manifest: [{ kind: 'automationScript', path: './matcher.js', disabled: 'yes' }] }
        });

        const result = planManifest(path.join(projectRoot, 'test.manifest.json'));

        assert.deepStrictEqual(codesOf(result), ['invalidEntry']);
    });
});
