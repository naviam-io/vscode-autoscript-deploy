/*
 * Unit tests for DBC extraction in the core, against a stubbed MaximoClient.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DBC_TYPES, extractDbc, sanitizeFileName } from '../../../src/core/extract/extract-dbc.js';

const objects = [
    { id: 'CORETEST_A_ID', label: 'CORETEST_A' },
    { id: 'CORETEST_B_ID', label: 'CORETEST_B' }
];

describe('extractDbc', () => {
    it('asks for the selected messages by id and writes what Maximo returns', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-dbc-'));
        const calls = [];
        const client = { getDBCObject: async (...args) => { calls.push(args); return '<dbc/>'; } };

        const written = await extractDbc(client, { group: 'msg', objects, fileName: 'V1.msg', label: 'Message', plural: 'Messages' }, dir);

        assert.strictEqual(written, path.join(dir, 'V1.msg'));
        assert.strictEqual(fs.readFileSync(written, 'utf8'), '<dbc/>');
        assert.deepStrictEqual(calls, [['msg', 'CORETEST_A,CORETEST_B', 'V1.msg', 'CORETEST_A_ID,CORETEST_B_ID', 'Create Messages CORETEST_A, CORETEST_B']]);
    });

    it('passes the where clause through for record types and throws on an error status', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-dbc-'));
        let where;
        const client = { getDBCObject: async (group, list, file, clause) => { where = clause; return { status: 'error', message: 'bad where' }; } };

        await assert.rejects(
            extractDbc(client, { group: 'table', objects: [objects[0]], fileName: 'V1.dbc', where: '1=1', label: 'Table', plural: 'Tables' }, dir),
            { message: 'Error extracting DBC:\nbad where' }
        );
        assert.strictEqual(where, '1=1');
        assert.deepStrictEqual(fs.readdirSync(dir), []);
    });
});

describe('sanitizeFileName', () => {
    it('replaces characters a file name cannot hold', () => {
        assert.strictEqual(sanitizeFileName(' a/b:c?.dbc '), 'a_b_c_.dbc');
        assert.strictEqual(sanitizeFileName('..'), '_');
    });
});

describe('DBC_TYPES', () => {
    it('names each DBC source type once', () => {
        assert.ok(DBC_TYPES.some((type) => type.group === 'os' && type.label === 'Object Structure' && type.plural === 'Object Structures'));
        assert.strictEqual(new Set(DBC_TYPES.map((type) => type.group)).size, DBC_TYPES.length);
        assert.throws(() => { DBC_TYPES[0].group = 'changed'; });
    });
});
