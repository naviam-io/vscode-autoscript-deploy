/*
 * Unit tests for resolving the companion files of an automation script.
 *
 *   npm run test:unit
 *
 * An automation script may be accompanied by a deploy script and by predeploy/deploy configuration
 * documents. They are always named after the script's source and live beside it. TypeScript is why
 * the source path is needed as well as the deployed path: the file deployed to Maximo is the webpack
 * bundle under the project's output directory, not the source the companions sit next to.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolveScriptCompanions } = require('../../../src/deploy/script-companions');

const BUNDLE = path.join('/project', 'deployment', 'install', 'scripts', 'naviam.example.js');
const SOURCE = path.join('/project', 'scripts', 'naviam.example', 'index.ts');

describe('resolveScriptCompanions', () => {
    it('names the companions after a plain script file', () => {
        const companions = resolveScriptCompanions(path.join('/project', 'scripts', 'naviam.example.js'));

        assert.strictEqual(companions.deployFileName, path.join('/project', 'scripts', 'naviam.example-deploy.js'));
        assert.strictEqual(companions.deployDotFileName, path.join('/project', 'scripts', 'naviam.example.deploy.js'));
        assert.strictEqual(companions.deployJSONFileName, path.join('/project', 'scripts', 'naviam.example.json'));
        assert.strictEqual(companions.preDeployJSONFileName, path.join('/project', 'scripts', 'naviam.example.predeploy.json'));
    });

    it('returns no companions when sidecars are switched off', () => {
        const companions = resolveScriptCompanions(path.join('/project', 'scripts', 'naviam.example.js'), { sidecars: false });

        assert.strictEqual(companions.deployFileName, null);
        assert.strictEqual(companions.deployDotFileName, null);
        assert.strictEqual(companions.deployJSONFileName, null);
        assert.strictEqual(companions.preDeployJSONFileName, null);
    });

    it('resolves every companion of a TypeScript script beside its source, not beside the bundle', () => {
        const companions = resolveScriptCompanions(BUNDLE, { companionPath: SOURCE });

        assert.strictEqual(companions.deployJSONFileName, path.join('/project', 'scripts', 'naviam.example', 'index.json'));
        assert.strictEqual(companions.preDeployJSONFileName, path.join('/project', 'scripts', 'naviam.example', 'index.predeploy.json'));
        assert.strictEqual(companions.deployFileName, path.join('/project', 'scripts', 'naviam.example', 'index-deploy.ts'));
        assert.strictEqual(companions.deployDotFileName, path.join('/project', 'scripts', 'naviam.example', 'index.deploy.ts'));
    });

    it('resolves the companions beside the source for any language, not only TypeScript', () => {
        const source = path.join('/project', 'scripts', 'other.py');
        const companions = resolveScriptCompanions(BUNDLE, { companionPath: source });

        assert.strictEqual(companions.deployJSONFileName, path.join('/project', 'scripts', 'other.json'));
        assert.strictEqual(companions.deployFileName, path.join('/project', 'scripts', 'other-deploy.py'));
    });

    it('still switches everything off for a TypeScript script when sidecars are off', () => {
        const companions = resolveScriptCompanions(BUNDLE, { companionPath: SOURCE, sidecars: false });

        assert.strictEqual(companions.deployJSONFileName, null);
        assert.strictEqual(companions.preDeployJSONFileName, null);
        assert.strictEqual(companions.deployFileName, null);
        assert.strictEqual(companions.deployDotFileName, null);
    });
});
