/* eslint-disable no-undef */
/*
 * Shared deploy/extract round trip used by the configuration type test cases.
 */
const fs = require('fs');
const path = require('path');
const { assertEquals, assertNotNull } = require('./harness');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(fixtureName) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, fixtureName + '.json'), 'utf8'));
}

/**
 * Asserts every field of `expected` is present in `actual` with the same value. Fields the fixture
 * does not name are not compared, so defaults Maximo fills in do not fail the test. An expected array
 * item may match any actual item, because Maximo returns children, such as the attributes of an
 * object including the ones it generates, in its own order. `ignore` lists dotted paths, with array
 * indexes removed, for fields the extraction does not report.
 */
function assertSubset(expected, actual, ignore, path = '') {
    if (expected === null || expected === undefined || ignore.includes(path.replace(/\[\d+\]/g, ''))) {
        return;
    }
    if (typeof expected !== 'object') {
        assertEquals(actual, expected, 'Mismatch at ' + (path || 'root'));
        return;
    }

    assertNotNull(actual, 'Expected a value at ' + (path || 'root'));

    if (Array.isArray(expected)) {
        expected.forEach((item, i) => {
            const itemPath = path + '[' + i + ']';
            const errors = [];
            const match = (Array.isArray(actual) ? actual : []).some((candidate) => {
                try {
                    assertSubset(item, candidate, ignore, itemPath);
                    return true;
                } catch (error) {
                    errors.push(error.message);
                    return false;
                }
            });
            if (!match) {
                throw new Error('No extracted item matches ' + itemPath + ' ' + JSON.stringify(item) + ': ' + errors.join('; '));
            }
        });
        return;
    }

    Object.keys(expected)
        .filter((key) => !key.startsWith('_'))
        .forEach((key) => assertSubset(expected[key], actual[key], ignore, path ? path + '.' + key : key));
}

/**
 * Runs the extract-deploy lifecycle contract for the configuration objects of a fixture: create them,
 * verify each, then delete them and verify the deletion. The objects are always removed, even when an
 * assertion fails, so a failing run does not leave state behind for the next one.
 *
 * @param {object} client the MaximoTestClient
 * @param {object} options.fixture fixture file name without the extension
 * @param {string} options.payloadKey plural key the deploy payload uses for this configuration type
 * @param {string} options.objectType type name the extraction script uses for this configuration type
 * @param {string|string[]} options.identityProperty property, or properties, identifying an object
 * @param {Function} [options.extractLabel] item => label the extraction list reports, when it is not the identifier
 * @param {Function} [options.extract] async (client, item) => extracted, for types the extraction script does not cover
 * @param {boolean} [options.compareFixture] assert each extracted object contains its whole fixture item
 * @param {string[]} [options.ignore] dotted paths compareFixture skips
 * @param {object} [options.expect] top level fields the first extracted object must match exactly
 * @param {Function} [options.verify] callback (extracted, describe, warnings, infos) for the first object, for assertions the flat expectations cannot express
 */
async function roundTrip(client, options) {
    const fixture = loadFixture(options.fixture);
    const items = fixture[options.payloadKey].map((item) => {
        const identity = {};
        [].concat(options.identityProperty).forEach((property) => (identity[property] = item[property]));
        const label = options.extractLabel ? options.extractLabel(item) : Object.values(identity).join(':');
        return { item, identity, label, describe: options.objectType + ' "' + label + '"' };
    });
    const extract = (entry) => (options.extract ? options.extract(client, entry.item) : client.extract(options.objectType, entry.label));
    let deleted = false;

    try {
        const { warnings, infos } = await client.deployConfig(fixture);

        const extracted = [];
        for (const entry of items) {
            const result = await extract(entry);
            assertNotNull(result, 'Extract of ' + entry.describe + ' returned nothing');
            if (options.compareFixture) {
                assertSubset(entry.item, result, options.ignore || []);
            }
            extracted.push(result);
        }

        Object.keys(options.expect || {}).forEach((field) => {
            assertEquals(extracted[0][field], options.expect[field], 'Extracted ' + items[0].describe + ' field ' + field);
        });

        if (options.verify) {
            options.verify(extracted[0], items[0].describe, warnings, infos);
        }

        await deleteObjects(client, options, items);
        deleted = true;

        for (const entry of items) {
            assertEquals(await extract(entry), null, 'Extract of ' + entry.describe + ' after delete');
        }

        return extracted[0];
    } finally {
        if (!deleted) {
            await deleteObjects(client, options, items);
        }
    }
}

// Reverse order, so an object is deleted before the objects the fixture declared it after, and may reference.
async function deleteObjects(client, options, items) {
    const payload = {};
    payload[options.payloadKey] = items.map((entry) => Object.assign({ _delete: true }, entry.identity)).reverse();
    await client.deployConfig(payload);
}

module.exports = { loadFixture, roundTrip };
