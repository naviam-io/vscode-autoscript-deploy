/*
 * Unit tests for the deployment manifest JSON schema.
 *
 *   npm run test:unit
 *
 * The schema is what an editor uses to complete and validate a manifest, so it also carries the
 * deprecation of entries that declare no "kind". Every entry form has to match exactly one branch
 * of the top level oneOf, or the editor reports a spurious error.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import Ajv from 'ajv';

import { createOnlyKinds } from '../../../src/core/deploy/manifest-planner.js';

const schema = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'schemas', 'manifest-schema.json'), 'utf8'));

/** @type {import('ajv').ValidateFunction} */
let validate;

before(() => {
    validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
});

function validateManifest(entries) {
    return validate({ manifest: entries });
}

/*
 * Which branch of the entry oneOf an entry matches, by name.
 */
function matchedBranch(entry) {
    const ajv = new Ajv({ strict: false });
    const branches = {
        string: { type: 'string' },
        databaseConfigurationEntry: schema.definitions.databaseConfigurationEntry,
        fileEntry: Object.assign({ definitions: schema.definitions }, schema.definitions.fileEntry),
        legacyFileEntry: schema.definitions.legacyFileEntry
    };

    return Object.keys(branches).filter((name) => ajv.compile(branches[name])(entry));
}

describe('manifest schema', () => {
    it('accepts an entry that declares a kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts', kind: 'automationScript' }]), true, JSON.stringify(validate.errors));
    });

    it('accepts an object entry that declares no kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts' }]), true, JSON.stringify(validate.errors));
    });

    it('accepts a bare path entry', () => {
        assert.strictEqual(validateManifest(['scripts/example/index.ts']), true, JSON.stringify(validate.errors));
    });

    it('accepts a database configuration entry', () => {
        assert.strictEqual(validateManifest([{ kind: 'databaseConfiguration' }]), true, JSON.stringify(validate.errors));
    });

    it('marks an object entry without a kind as deprecated', () => {
        const branches = matchedBranch({ path: 'scripts/example/index.ts' });

        assert.deepStrictEqual(branches, ['legacyFileEntry']);
        assert.strictEqual(schema.definitions.legacyFileEntry.deprecated, true);
    });

    it('does not mark an entry that declares a kind as deprecated', () => {
        const branches = matchedBranch({ path: 'scripts/example/index.ts', kind: 'automationScript' });

        assert.deepStrictEqual(branches, ['fileEntry']);
        assert.notStrictEqual(schema.definitions.fileEntry.deprecated, true);
    });

    it('accepts disabled on an entry that declares a kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts', kind: 'automationScript', disabled: true }]), true, JSON.stringify(validate.errors));
    });

    it('accepts disabled on an entry that declares no kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts', disabled: true }]), true, JSON.stringify(validate.errors));
    });

    it('accepts disabled on a database configuration entry', () => {
        assert.strictEqual(validateManifest([{ kind: 'databaseConfiguration', disabled: false }]), true, JSON.stringify(validate.errors));
    });

    it('rejects a disabled value that is not a boolean', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts', kind: 'automationScript', disabled: 'yes' }]), false);
    });

    it('rejects an unknown kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/example/index.ts', kind: 'nonsense' }]), false);
    });
});

describe('manifest schema createOnly', () => {
    const accepting = [
        ['automationScript', 'scripts/a.js'],
        ['inspectionForm', 'forms/a.json'],
        ['screen', 'screens/a.xml'],
        ['report', 'WOTRACK/a.rptdesign']
    ];

    for (const [kind, entryPath] of accepting) {
        it(`accepts createOnly on a ${kind} entry`, () => {
            assert.strictEqual(validateManifest([{ kind, path: entryPath, createOnly: true }]), true, JSON.stringify(validate.errors));
        });
    }

    for (const [kind, entryPath] of [
        ['configuration', 'config/a.json'],
        ['deployScript', 'scripts/a.js'],
        ['manifest', 'nested.manifest.json']
    ]) {
        it(`rejects createOnly on a ${kind} entry`, () => {
            assert.strictEqual(validateManifest([{ kind, path: entryPath, createOnly: true }]), false);
        });
    }

    it('rejects createOnly on an entry without a kind', () => {
        assert.strictEqual(validateManifest([{ path: 'scripts/a.js', createOnly: true }]), false);
    });

    it('rejects createOnly on a database configuration entry', () => {
        assert.strictEqual(validateManifest([{ kind: 'databaseConfiguration', createOnly: true }]), false);
    });

    it('rejects a createOnly value that is not a boolean', () => {
        assert.strictEqual(validateManifest([{ kind: 'screen', path: 'a.xml', createOnly: 'yes' }]), false);
    });

    it('accepts createOnly false on any file kind', () => {
        assert.strictEqual(validateManifest([{ kind: 'configuration', path: 'a.json', createOnly: false }]), true, JSON.stringify(validate.errors));
    });

    it('accepts createOnly for exactly the kinds the planner accepts', () => {
        const paths = { configuration: 'a.json', automationScript: 'a.js', deployScript: 'a.js', inspectionForm: 'a.json', screen: 'a.xml', report: 'a.rptdesign', manifest: 'a.json' };
        const accepted = Object.keys(paths).filter((kind) => validateManifest([{ kind, path: paths[kind], createOnly: true }]));
        assert.deepStrictEqual(accepted.sort(), createOnlyKinds().sort());
    });
});
