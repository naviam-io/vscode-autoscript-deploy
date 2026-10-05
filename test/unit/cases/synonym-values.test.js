/*
 * Unit tests for fields based on a Maximo synonym domain, such as a domain type or a cron task access
 * level. A plain value is the localized value of the target Maximo and deploys unchanged; a value
 * written as !VALUE! is an internal value that deploy resolves to the server's default localized
 * value. The ! prefix is reserved for that syntax.
 *
 *   npm run test:unit
 *
 * The library helpers run from the built bundle with a stubbed Maximo translator; the integration
 * tests cover the real translator.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const { loadScriptFunctions, REPO_ROOT } = require('../harness');

const vm = require('node:vm');

const LIBRARY_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'resources', 'naviam.autoscript.library.js'), 'utf8');
const { parseInternalValue } = loadScriptFunctions('resources/naviam.autoscript.library.js', ['parseInternalValue']);

/** Runs the library bundle as Maximo would, with the given translator, and returns what it shares. */
function runLibrary(translator) {
    const MXServer = { getMXServer: () => ({ getMaximoDD: () => ({ getTranslator: () => translator }) }) };
    const sandbox = { Java: { type: (name) => (name === 'psdi.server.MXServer' ? MXServer : function () {}) } };
    vm.createContext(sandbox);
    vm.runInContext(LIBRARY_SOURCE, sandbox);
    return sandbox.NaviamAutoscriptLibrary;
}

const SECURE_LEVELS = { PUBLIC: 'OPENBAAR', SECURE: 'VEILIG' };
const translator = {
    toExternalDefaultValue: (domainId, internal) => (domainId === 'PROPSECURELEVEL' && SECURE_LEVELS[internal]) || null,
    toInternalString: (domainId, external) => Object.keys(SECURE_LEVELS).find((internal) => SECURE_LEVELS[internal] === external) || external
};

function readSchema(name) {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', name), 'utf8'));
}

const deploySchema = readSchema('deploy-schema.json');

const SYNONYM_FIELDS = {
    'deploy-schema.json': [
        '/definitions/action/properties/type',
        '/definitions/action/properties/useWith',
        '/definitions/escalation/properties/escRefPoint/items/properties/intervalUom',
        '/definitions/integrationObject/properties/useWith',
        '/definitions/domain/properties/domainType',
        '/definitions/cronTask/properties/accessLevel',
        '/definitions/maximo_properties/properties/secureLevel'
    ],
    'predeploy-schema.json': ['/definitions/maximo_object/properties/level', '/definitions/maximo_object/properties/relationships/items/properties/cardinality'],
    'script-config-schema.json': ['/definitions/property/properties/secureLevel']
};

function synonymFieldsOf(schema) {
    const found = {};
    (function walk(node, pointer) {
        if (Array.isArray(node)) {
            node.forEach((child, i) => walk(child, pointer + '/' + i));
        } else if (node && typeof node === 'object') {
            if (typeof node.patternErrorMessage === 'string' && node.patternErrorMessage.includes('!VALUE!')) {
                found[pointer] = node;
            }
            Object.keys(node).forEach((key) => walk(node[key], pointer + '/' + key));
        }
    })(schema, '');
    return found;
}

describe('synonym domain fields in the schemas', () => {
    Object.keys(SYNONYM_FIELDS).forEach((file) => {
        const fields = synonymFieldsOf(readSchema(file));

        it(file + ' declares the synonym domain fields', () => {
            assert.deepStrictEqual(Object.keys(fields).sort(), SYNONYM_FIELDS[file].slice().sort());
        });

        Object.keys(fields).forEach((pointer) => {
            const field = fields[pointer];
            const validate = new Ajv({ strict: false }).compile(field);

            it(pointer + ' suggests the EN values and accepts them', () => {
                assert.ok(Array.isArray(field.examples) && field.examples.length > 0, 'examples are listed for autocompletion');
                assert.strictEqual(field.enum, undefined, 'any localized value is accepted, so the values are not an enum');
                field.examples.forEach((value) => assert.strictEqual(validate(value), true, value));
            });

            it(pointer + ' accepts a localized and an internal value', () => {
                ['TABLENL', 'ALLEEN WIJZIGEN', 'ORGTOEP.FILTER', '!MAXTABLE!', '!SOME VALUE!'].forEach((value) => assert.strictEqual(validate(value), true, value));
            });

            it(pointer + ' has no default, or a default in the internal form the library applies', () => {
                if (field.default !== undefined) {
                    assert.match(field.default, /^![^!]+!$/);
                }
            });

            it(pointer + ' rejects a value that starts with ! but is not !VALUE!', () => {
                ['!', '!!', '!MAXTABLE', '!MAX!TABLE!', '!MAXTABLE!!'].forEach((value) => assert.strictEqual(validate(value), false, value));
            });
        });
    });

    it('suggests TABLE, not MAXTABLE, as the table domain type', () => {
        const examples = deploySchema.definitions.domain.properties.domainType.examples;
        assert.ok(examples.includes('TABLE'));
        assert.ok(!examples.includes('MAXTABLE'));
    });

    it('validates a table domain declared as TABLE, as localized and as !MAXTABLE!', () => {
        const validate = new Ajv({ strict: false, allErrors: true }).compile(deploySchema);
        ['TABLE', 'TABLENL', '!MAXTABLE!'].forEach((domainType) => {
            const payload = { domains: [{ domainId: 'TEST_TABLEDOM', domainType: domainType, tableDomain: [{ objectName: 'MAXUSER', errorResourceBundle: 'system' }] }] };
            assert.strictEqual(validate(payload), true, domainType + ': ' + JSON.stringify(validate.errors));
        });
        assert.strictEqual(validate({ domains: [{ domainId: 'TEST_TABLEDOM', domainType: '!MAXTABLE' }] }), false);
    });

    it('declares only the defaults the library applies', () => {
        const definitions = deploySchema.definitions;
        assert.strictEqual(definitions.action.properties.type.default, undefined);
        assert.strictEqual(definitions.action.properties.useWith.default, undefined);
        assert.strictEqual(definitions.cronTask.properties.accessLevel.default, '!FULL!');
        assert.strictEqual(definitions.integrationObject.properties.useWith.default, '!INTEGRATION!');
        assert.strictEqual(definitions.maximo_properties.properties.secureLevel.default, '!PUBLIC!');
        assert.strictEqual(readSchema('predeploy-schema.json').definitions.maximo_object.properties.level.default, undefined);
    });

    it('keeps the errorResourceBundle and sortByOn corrections', () => {
        const definitions = deploySchema.definitions;
        ['tableDomain', 'crossoverDomain'].forEach((collection) => {
            const properties = definitions.domain.properties[collection].items.properties;
            assert.ok(properties.errorResourceBundle, collection + '.errorResourceBundle');
            assert.strictEqual(properties.errorResourcBundle, undefined, collection + '.errorResourcBundle');
        });
        const attribute = definitions.integrationObject.properties.queryTemplate.items.properties.queryTemplateAttr.items.properties;
        assert.strictEqual(attribute.sortByOn.type, 'boolean');
    });
});

describe('parseInternalValue', () => {
    it('returns null for a plain value, which deploys unchanged', () => {
        ['TABLE', 'TABLENL', 'MAXTABLE', 'MAX!TABLE', '', null, undefined, 12, true].forEach((value) => assert.strictEqual(parseInternalValue(value), null, String(value)));
    });

    it('returns the internal value of !VALUE!', () => {
        assert.strictEqual(parseInternalValue('!MAXTABLE!'), 'MAXTABLE');
        assert.strictEqual(parseInternalValue('!MODIFY ONLY!'), 'MODIFY ONLY');
    });

    it('rejects a value that starts with ! but is not !VALUE!, naming the value', () => {
        ['!', '!!', '!MAXTABLE', '!MAX!TABLE!'].forEach((value) => {
            assert.throws(
                () => parseInternalValue(value),
                (error) => error.message.includes('"' + value + '"') && error.message.includes('!VALUE!'),
                value
            );
        });
    });
});

describe('the synonym domain helpers the library shares', () => {
    it('are the default export, assigned to NaviamAutoscriptLibrary', () => {
        assert.deepStrictEqual(Object.keys(runLibrary(translator)).sort(), ['handleSnapshotRequest', 'toExternalSynonymValue', 'toInternalSynonymValue']);
    });

    it('toExternalSynonymValue leaves a plain value unchanged', () => {
        const library = runLibrary({ toExternalDefaultValue: () => assert.fail('a plain value is not translated') });
        assert.strictEqual(library.toExternalSynonymValue('PROPSECURELEVEL', 'PUBLIC'), 'PUBLIC');
        assert.strictEqual(library.toExternalSynonymValue('PROPSECURELEVEL', 'OPENBAAR'), 'OPENBAAR');
    });

    it('toExternalSynonymValue resolves an internal value to the default localized value', () => {
        assert.strictEqual(runLibrary(translator).toExternalSynonymValue('PROPSECURELEVEL', '!PUBLIC!'), 'OPENBAAR');
    });

    it('toExternalSynonymValue fails for an unknown internal value, naming the value and the synonym domain', () => {
        const throwing = { toExternalDefaultValue: () => { throw new Error('BMXAA0000E'); } };
        [runLibrary(translator), runLibrary(throwing)].forEach((library) => {
            assert.throws(
                () => library.toExternalSynonymValue('PROPSECURELEVEL', '!OPEN!'),
                (error) => error.message.includes('"!OPEN!"') && error.message.includes('PROPSECURELEVEL synonym domain')
            );
        });
    });

    it('toInternalSynonymValue returns the internal value of either form', () => {
        const library = runLibrary(translator);
        assert.strictEqual(library.toInternalSynonymValue('PROPSECURELEVEL', '!SECURE!'), 'SECURE');
        assert.strictEqual(library.toInternalSynonymValue('PROPSECURELEVEL', 'VEILIG'), 'SECURE');
        assert.strictEqual(library.toInternalSynonymValue('PROPSECURELEVEL', 'UNKNOWN'), 'UNKNOWN');
    });
});

describe('toExternalSynonymValue in the deploy script', () => {
    function ScriptError(reason, message) {
        this.reason = reason;
        this.message = message;
    }

    function load(installed) {
        const ScriptCache = { getInstance: () => ({ getScriptInfo: (name) => (installed && name === 'NAVIAM.AUTOSCRIPT.LIBRARY' ? {} : null) }) };
        const ScriptDriverFactory = {
            getInstance: () => ({
                getScriptDriver: () => ({ runScript: (name, context) => context.put('NaviamAutoscriptLibrary', runLibrary(translator)) })
            })
        };
        const HashMap = function () {
            const map = new Map();
            this.put = (key, value) => map.set(key, value);
            this.get = (key) => map.get(key);
        };
        return loadScriptFunctions('resources/naviam.autoscript.deploy.js', ['runLibrary', 'library', 'toExternalSynonymValue'], {
            HashMap,
            LIBRARY_SCRIPT: 'NAVIAM.AUTOSCRIPT.LIBRARY',
            ScriptCache,
            ScriptDriverFactory,
            ScriptError,
            libraryExports: null
        }).toExternalSynonymValue;
    }

    it('resolves through the library', () => {
        const toExternalSynonymValue = load(true);
        assert.strictEqual(toExternalSynonymValue('PROPSECURELEVEL', '!PUBLIC!', {}), 'OPENBAAR');
        assert.strictEqual(toExternalSynonymValue('PROPSECURELEVEL', 'PUBLIC', {}), 'PUBLIC');
    });

    it('reports a value the library rejects as a ScriptError with the library message', () => {
        ['!OPEN!', '!PUBLIC'].forEach((value) => {
            assert.throws(
                () => load(true)('PROPSECURELEVEL', value, {}),
                (error) => error instanceof ScriptError && error.reason === 'invalid_synonym_value' && error.message.startsWith('The value "' + value + '" is not valid.')
            );
        });
    });

    it('fails clearly when the library script is not installed', () => {
        assert.throws(
            () => load(false)('PROPSECURELEVEL', '!PUBLIC!', {}),
            (error) => error instanceof ScriptError && error.reason === 'no_library_script'
        );
    });
});
