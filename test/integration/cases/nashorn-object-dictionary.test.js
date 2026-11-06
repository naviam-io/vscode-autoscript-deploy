/* eslint-disable no-undef */
/*
 * Reproduces the Nashorn defect that broke screen redeploys in 1.31.0: a plain object used as a
 * dictionary with about a thousand keys, created by the same function on every call, answers
 * lookups wrongly from the second call on. A java.util.HashMap given the same keys stays correct.
 * See docs/modules/nashorn-library.md.
 */
import { assertEquals } from '../harness.js';

const KEYS = 1021;
const CALLS = 5;

/** Per call, "missing/present": keys that were set but read as absent, and keys read as present before they were set. */
async function lookupErrors(client, dictionary) {
    const source = [
        'function check(keys) {',
        '    var seen = ' + dictionary.create + ';',
        '    var present = 0, missing = 0;',
        '    keys.forEach(function (key) {',
        '        if (' + dictionary.get + ') present++;',
        '        ' + dictionary.set + ';',
        '    });',
        '    keys.forEach(function (key) {',
        '        if (!(' + dictionary.get + ')) missing++;',
        '    });',
        '    return missing + "/" + present;',
        '}',
        'var keys = [];',
        'for (var i = 0; i < ' + KEYS + '; i++) keys.push("k" + i);',
        'var calls = [];',
        'for (var c = 0; c < ' + CALLS + '; c++) calls.push(check(keys));',
        'throw new Error("CALLS[" + calls.join(" ") + "]");',
        'var scriptConfig = { autoscript: "TEST.NASHORN.OBJECT.DICTIONARY", description: "Nashorn object dictionary test", active: true };'
    ].join('\n');

    const response = await client.runDeployScript(source, false);
    const match = /CALLS\[(.*)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('Running the dictionary check failed: ' + JSON.stringify(response));
    }
    return match[1].split(' ');
}

export default {
    name: 'nashorn-object-dictionary',
    run: async (client) => {
        const object = await lookupErrors(client, { create: '{}', get: 'seen[key]', set: 'seen[key] = true' });
        client.log('  object (missing/present per call): ' + object.join(' '));
        assertEquals(object[0], '0/0', 'The first call answers every lookup correctly');
        assertEquals(object.slice(1).some((call) => call !== '0/0'), true, 'Later calls answer some lookups wrongly: ' + object.join(' '));

        const map = await lookupErrors(client, { create: 'new java.util.HashMap()', get: 'seen.get(key)', set: 'seen.put(key, true)' });
        assertEquals(map.join(' '), Array(CALLS).fill('0/0').join(' '), 'A Java map answers every lookup correctly');
    }
};
