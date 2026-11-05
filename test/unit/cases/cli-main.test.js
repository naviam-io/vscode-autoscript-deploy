/*
 * Unit tests for the CLI entry: exit codes and messages for the paths that do not reach Maximo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../../cli/lib/main.js';

function sink() {
    let text = '';
    return { write: (chunk) => { text += chunk; }, text: () => text };
}

async function run(argv) {
    const stdout = sink();
    const stderr = sink();
    const code = await main(argv, { resourcesDir: os.tmpdir(), stdout, stderr });
    return { code, stdout: stdout.text(), stderr: stderr.text() };
}

function settingsFile(content) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-main-')), 'settings.json');
    fs.writeFileSync(file, JSON.stringify(content));
    return file;
}

describe('CLI main', () => {
    it('fails on an unknown option', async () => {
        const { code, stderr } = await run(['deploy', '--nonsense']);

        assert.strictEqual(code, 1);
        assert.match(stderr, /Unknown argument/);
    });

    it('fails with the validation message before connecting', async () => {
        const { code, stderr } = await run(['log', '--settings', settingsFile({ apikey: 'k' })]);

        assert.strictEqual(code, 1);
        assert.match(stderr, /A host name or IP address is required/);
    });

    it('fails when a named settings file does not exist', async () => {
        const { code, stderr } = await run(['log', '--settings', path.join(os.tmpdir(), 'missing-settings.json')]);

        assert.strictEqual(code, 1);
        assert.match(stderr, /cannot be read/);
    });

    it('encrypts the settings file without connecting', async () => {
        const file = settingsFile({ host: 'h', apikey: 'secret' });

        const { code, stdout } = await run(['encrypt', '--settings', file]);

        assert.strictEqual(code, 0);
        assert.match(stdout, /were encrypted with the key/);
        assert.match(JSON.parse(fs.readFileSync(file, 'utf8')).apikey, /^\{encrypted\}/);
    });
});
