/*
 * Unit tests for how the CLI extract command selects by name and hands the selection to the core extractors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecordingUi } from '../support/recording-ui.js';
import { runExtract, selectByName } from '../../../cli/lib/extract.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-extract-'));

function run(client, config, answers) {
    const { ui, calls } = createRecordingUi({ answers });
    const lines = [];
    return runExtract(client, ui, { overwrite: true, name: [], ...config }, { out: (line) => lines.push(line) }).then((result) => ({ ...result, calls, lines }));
}

describe('CLI extract selection', () => {
    it('selects every item when no names are given', () => {
        const items = [{ label: 'a' }, { label: 'b' }];
        assert.deepStrictEqual(selectByName(items, []), { selected: items, missing: [] });
    });

    it('matches labels, report names and names case-insensitively and reports the missing ones', () => {
        const items = [{ label: 'ONE' }, { label: 'Work order list', reportName: 'wolist.rptdesign' }, { label: 'x', name: 'Named' }];
        const { selected, missing } = selectByName(items, ['one', 'WOLIST.rptdesign', 'named', 'absent']);
        assert.deepStrictEqual(selected, items);
        assert.deepStrictEqual(missing, ['absent']);
    });
});

describe('CLI extract command', () => {
    it('extracts the named scripts and fails for a name Maximo does not have', async () => {
        const dir = tempDir();
        const client = {
            getAllScriptNames: async () => [{ label: 'test.one' }, { label: 'test.two' }],
            getScript: async (name) => ({ script: `// ${name}`, scriptLanguage: 'nashorn' })
        };

        const { failed, calls, lines } = await run(client, { type: 'script', directory: dir, name: ['TEST.ONE', 'missing'] });

        assert.strictEqual(failed, 1);
        assert.deepStrictEqual(fs.readdirSync(dir), ['test.one.js']);
        assert.ok(calls.some((call) => call.method === 'error' && call.message.includes('missing')));
        assert.ok(lines.some((line) => line.startsWith('1 of 1 automation script extracted')));
    });

    it('counts each script that could not be extracted', async () => {
        const client = {
            getAllScriptNames: async () => [{ label: 'bad' }],
            getScript: async () => {
                throw new Error('server said no');
            }
        };

        const { failed, calls } = await run(client, { type: 'script', directory: tempDir() });

        assert.strictEqual(failed, 1);
        assert.ok(calls.some((call) => call.method === 'error' && call.detail === 'server said no'));
    });

    it('succeeds with a message when Maximo has nothing of the type', async () => {
        const { failed, lines } = await run({ getFormNames: async () => [] }, { type: 'form', directory: tempDir() });

        assert.strictEqual(failed, 0);
        assert.deepStrictEqual(lines, ['No inspection forms were found.']);
    });

    it('merges configuration into <group>.json in the directory', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify({ messages: [{ msgGroup: 'old', msgKey: 'kept', value: 'x' }] }));
        const client = {
            getObjectList: async (group) => (group === 'messages' ? [{ id: 1, label: 'test.hello' }, { id: 2, label: 'other' }] : []),
            getObjectDetail: async (group, id) => ({ msgGroup: 'test', msgKey: 'hello', id })
        };

        const { failed, lines } = await run(client, { type: 'messages', directory: dir, name: ['test.hello'] });

        assert.strictEqual(failed, 0);
        const written = JSON.parse(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'));
        assert.deepStrictEqual(written.messages.map((message) => message.msgKey).sort(), ['hello', 'kept']);
        assert.match(lines[0], /^1 messages extracted to /);
    });

    it('leaves an existing configuration file alone when overwrite is off', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'custom.json'), '{}');
        const client = { getObjectList: async () => assert.fail('should not list') };

        const { failed, lines } = await run(client, { type: 'messages', directory: dir, file: 'custom.json', overwrite: false });

        assert.strictEqual(failed, 0);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'custom.json'), 'utf8'), '{}');
        assert.match(lines[0], /--overwrite is false/);
    });

    it('refuses to merge configuration into a file that is not a configuration file', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'manifest.json'), 'not json');
        const client = { getObjectList: async () => [{ id: 1, label: 'a' }], getObjectDetail: async () => ({}) };

        const { failed, calls } = await run(client, { type: 'messages', directory: dir, file: 'manifest.json' });

        assert.strictEqual(failed, 1);
        assert.ok(calls.some((call) => call.method === 'error' && call.message.includes('is not a configuration file')));
        assert.strictEqual(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'), 'not json');
    });

    it('extracts DBC for named objects into the file relative to the directory', async () => {
        const dir = tempDir();
        const requests = [];
        const client = {
            getDBCObjectList: async (group) => (group === 'os' ? [{ id: 1, label: 'MXASSET' }, { id: 2, label: 'MXWO' }] : []),
            getDBCObject: async (...args) => {
                requests.push(args);
                return '<dbc/>';
            }
        };

        const { failed } = await run(client, { type: 'dbc', dbcType: 'os', directory: dir, file: 'out/os.dbc', name: ['mxwo'] });

        assert.strictEqual(failed, 0);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'out', 'os.dbc'), 'utf8'), '<dbc/>');
        assert.deepStrictEqual(requests[0].slice(0, 3), ['os', 'MXWO', 'os.dbc']);
    });

    it('lists attributes of the given object and passes their ids as the condition', async () => {
        const dir = tempDir();
        const requests = [];
        const client = {
            getDBCAttributeList: async (object) => (object === 'ASSET' ? [{ id: 11, label: 'NVTEST1' }, { id: 12, label: 'NVTEST2' }] : []),
            getDBCObject: async (...args) => {
                requests.push(args);
                return '<dbc/>';
            }
        };

        const { failed } = await run(client, { type: 'dbc', dbcType: 'attribute', object: 'ASSET', directory: dir, file: 'attr.dbc' });

        assert.strictEqual(failed, 0);
        assert.strictEqual(requests[0][3], '11,12');
    });

    it('reports a DBC error from Maximo as a failure', async () => {
        const client = {
            getDBCObjectList: async () => [{ id: 1, label: 'T' }],
            getDBCObject: async () => ({ status: 'error', message: 'no such table' })
        };

        const { failed, calls } = await run(client, { type: 'dbc', dbcType: 'table', directory: tempDir(), file: 't.dbc', name: ['T'], where: '1=1' });

        assert.strictEqual(failed, 1);
        assert.ok(calls.some((call) => call.method === 'error' && call.message.includes('no such table')));
    });
});
