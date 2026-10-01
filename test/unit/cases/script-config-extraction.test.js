/*
 * Unit tests for getConfigFromScript in resources/naviam.autoscript.deploy.js, which locates the
 * scriptConfig declaration in an automation script and converts it.
 *
 * A script may bind the name scriptConfig more than once: this script holds the result of a
 * function call in a local of that name, and the extract script builds one up from an empty
 * object. Picking one of those up made the deploy script itself undeployable with "The auto
 * script name (autoscript) is required in the script configuration".
 */
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const acorn = require('acorn');
const { loadScriptFunctions, REPO_ROOT } = require('../harness');

const DEPLOY_SCRIPT = 'resources/naviam.autoscript.deploy.js';
const RESOURCES_DIR = path.join(REPO_ROOT, 'resources');

function ScriptError(reason, message) {
    this.reason = reason;
    this.message = message;
}

const { getConfigFromScript } = loadScriptFunctions(DEPLOY_SCRIPT, ['getConfigFromScript', 'findScriptConfigNode', 'scriptConfigObjectOf', 'isScriptConfigName', 'astToJavaScript', 'astPropertyKeyName'], {
    parse: (source) => acorn.parse(source, { ecmaVersion: 5 }),
    ScriptError,
    log_error: () => {},
    getConfigFromPythonScript: () => {
        throw new ScriptError('config_not_found', 'Configuration variable scriptConfig was not found in the script.');
    },
});

const shippedScripts = fs.readdirSync(RESOURCES_DIR).filter((file) => /^naviam\.autoscript\..*\.js$/.test(file));

describe('getConfigFromScript', () => {
    it('ignores a local scriptConfig holding a function call', () => {
        const config = getConfigFromScript(
            'function deployScript(source) {' +
                '    var scriptConfig = getConfigFromScript(source);' +
                '    return scriptConfig;' +
                '}' +
                'var scriptConfig = { autoscript: "NAVIAM.AUTOSCRIPT.DEPLOY", version: "1.0.0" };',
            'javascript'
        );

        assert.deepStrictEqual(config, { autoscript: 'NAVIAM.AUTOSCRIPT.DEPLOY', version: '1.0.0' });
    });

    it('ignores a local scriptConfig built up from an empty object', () => {
        const config = getConfigFromScript(
            'function extractConfig(autoScript) {' +
                '    var scriptConfig = {};' +
                '    scriptConfig.autoscript = autoScript.getString("AUTOSCRIPT");' +
                '    return scriptConfig;' +
                '}' +
                'var scriptConfig = { autoscript: "NAVIAM.AUTOSCRIPT.EXTRACT", version: "1.0.0" };',
            'javascript'
        );

        assert.deepStrictEqual(config, { autoscript: 'NAVIAM.AUTOSCRIPT.EXTRACT', version: '1.0.0' });
    });

    it('reads a configuration assigned rather than declared', () => {
        const config = getConfigFromScript('function run() { var scriptConfig = load(); }\nscriptConfig = { autoscript: "A" };', 'javascript');

        assert.deepStrictEqual(config, { autoscript: 'A' });
    });

    it('reads a configuration assigned to a property', () => {
        const config = getConfigFromScript('this.scriptConfig = { autoscript: "A" };', 'javascript');

        assert.deepStrictEqual(config, { autoscript: 'A' });
    });

    it('finds a configuration wrapped in a function, as the generated library script is', () => {
        const config = getConfigFromScript('(function () { var scriptConfig = { autoscript: "A" }; })();', 'javascript');

        assert.deepStrictEqual(config, { autoscript: 'A' });
    });

    it('throws when the only configuration is an empty object', () => {
        assert.throws(() => getConfigFromScript('var scriptConfig = {};', 'javascript'), { reason: 'config_not_found' });
    });

    it('throws when the script has no configuration', () => {
        assert.throws(() => getConfigFromScript('var somethingElse = { autoscript: "A" };', 'javascript'), { reason: 'config_not_found' });
    });

    shippedScripts.forEach((file) => {
        it('reads the configuration of ' + file, () => {
            const config = getConfigFromScript(fs.readFileSync(path.join(RESOURCES_DIR, file), 'utf8'), 'javascript');

            assert.match(config.autoscript, /^NAVIAM\.AUTOSCRIPT\./);
        });
    });
});
