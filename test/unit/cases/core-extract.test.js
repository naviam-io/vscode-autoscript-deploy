/*
 * Unit tests for the core extract support, file writer and extractors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecordingUi } from '../support/recording-ui.js';
import { resolveExtractLocation, prepareExtractFolder, showExtractResult } from '../../../src/core/extract/extract-support.js';
import { createExtractedFileWriter } from '../../../src/core/extract/extracted-file-writer.js';
import { extractScripts } from '../../../src/core/extract/extract-scripts.js';
import { Decision } from '../../../src/core/ui.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'core-extract-'));

describe('resolveExtractLocation', () => {
    it('falls back to the workspace when nothing is configured', () => {
        assert.strictEqual(resolveExtractLocation(undefined, '/ws'), '/ws');
    });

    it('expands the home directory', () => {
        assert.strictEqual(resolveExtractLocation('~/out', '/ws'), path.join(os.homedir(), '/out'));
    });

    it('resolves ./ and bare relative paths against the workspace', () => {
        assert.strictEqual(resolveExtractLocation('./out', '/ws'), path.join('/ws', 'out'));
        assert.strictEqual(resolveExtractLocation('out', '/ws'), path.join('/ws', 'out'));
    });

    it('is undefined when there is neither a setting nor a workspace', () => {
        assert.strictEqual(resolveExtractLocation(undefined, undefined), undefined);
    });
});

describe('prepareExtractFolder', () => {
    it('creates the resolved folder', () => {
        const root = tempDir();
        const { ui, calls } = createRecordingUi();

        const dir = prepareExtractFolder(ui, './out/scripts', root, 'automation scripts', 'Test');
        assert.strictEqual(dir, path.join(root, 'out', 'scripts'));
        assert.ok(fs.statSync(dir).isDirectory());
        assert.deepStrictEqual(calls, []);
    });

    it('tells the user when there is nowhere to extract to', () => {
        const { ui, calls } = createRecordingUi();

        assert.strictEqual(prepareExtractFolder(ui, undefined, undefined, 'reports', 'Test'), undefined);
        assert.match(calls[0].message, /before exporting reports/);
    });
});

describe('showExtractResult', () => {
    const nouns = { singular: 'form', plural: 'forms', success: 'Forms extracted.' };

    it('reports success unless cancelled', () => {
        const { ui, calls } = createRecordingUi();
        showExtractResult(ui, { extracted: 2, failures: [], cancelled: false }, 2, nouns, 'Test');
        showExtractResult(ui, { extracted: 1, failures: [], cancelled: true }, 2, nouns, 'Test');
        assert.deepStrictEqual(calls, [{ method: 'info', message: 'Forms extracted.' }]);
    });

    it('lists the first failures and counts the rest', () => {
        const { ui, calls } = createRecordingUi();
        const failures = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, message: 'boom' }));
        showExtractResult(ui, { extracted: 1, failures, cancelled: false }, 6, nouns, 'Test');

        assert.strictEqual(calls[0].message, '5 of 6 forms could not be extracted.');
        assert.match(calls[0].detail, /^A:\nboom\n\nB:/);
        assert.match(calls[0].detail, /and 2 more/);
        assert.doesNotMatch(calls[0].detail, /D:/);
    });
});

describe('createExtractedFileWriter', () => {
    it('writes a new file, leaves an identical one alone and asks before replacing a different one', async () => {
        const dir = tempDir();
        const file = path.join(dir, 'a.js');
        const { ui, calls } = createRecordingUi({ answers: { [Decision.OVERWRITE]: 'Skip' } });
        const writer = createExtractedFileWriter(ui);

        assert.strictEqual(await writer.write(file, 'one', 'script a.js'), 'written');
        assert.strictEqual(await writer.write(file, 'one', 'script a.js'), 'unchanged');
        assert.strictEqual(await writer.write(file, 'two', 'script a.js'), 'skipped');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), 'one');
        assert.strictEqual(calls.filter((call) => call.method === 'choose').length, 1);
    });

    it('stops asking after Replace All', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'a.js'), 'old');
        fs.writeFileSync(path.join(dir, 'b.js'), 'old');
        const { ui, calls } = createRecordingUi({ answers: { [Decision.OVERWRITE]: 'Replace All' } });
        const writer = createExtractedFileWriter(ui);

        assert.strictEqual(await writer.write(path.join(dir, 'a.js'), 'new', 'a.js'), 'replaced');
        assert.strictEqual(await writer.write(path.join(dir, 'b.js'), 'new', 'b.js'), 'replaced');
        assert.strictEqual(calls.filter((call) => call.method === 'choose').length, 1);
    });

    it('reports cancelled when the question is dismissed', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'a.js'), 'old');
        const { ui } = createRecordingUi();
        assert.strictEqual(await createExtractedFileWriter(ui).write(path.join(dir, 'a.js'), 'new', 'a.js'), 'cancelled');
    });
});

describe('extractScripts', () => {
    it('names files by script and language, lower case', async () => {
        const dir = tempDir();
        const client = {
            getScript: async (name) => ({ script: `// ${name}`, scriptLanguage: name === 'CORETEST_B' ? 'python' : 'nashorn' })
        };
        const { ui } = createRecordingUi();

        const result = await extractScripts(client, ui, ['CORETEST_A', 'CORETEST_B'], dir);

        assert.deepStrictEqual(result, { extracted: 2, failures: [], cancelled: false });
        assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['coretest_a.js', 'coretest_b.py']);
    });
});
