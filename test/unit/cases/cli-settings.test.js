/*
 * Unit tests for how the CLI reads its settings file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings } from '../../../cli/lib/settings.js';

function settingsFile(content) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-settings-')), 'settings.json');
    fs.writeFileSync(file, content);
    return file;
}

describe('CLI settings', () => {
    it('keeps the defaults of a command section the file only partly sets', () => {
        const merged = mergeSettings(DEFAULT_SETTINGS, { host: 'maximo.example.com', deploy: { deleteAll: true } });

        assert.strictEqual(merged.host, 'maximo.example.com');
        assert.strictEqual(merged.deploy.deleteAll, true);
        assert.strictEqual(merged.deploy.recursive, true);
        assert.strictEqual(merged.deploy.deleteList, 'delete.json');
        assert.strictEqual(merged.extract.type, 'script');
    });

    it('uses the defaults when the default settings file is missing', () => {
        const { settings, settingsFile: file } = loadSettings(path.join(os.tmpdir(), 'cli-missing', 'settings.json'), { explicit: false });

        assert.strictEqual(file, undefined);
        assert.strictEqual(settings.context, 'maximo');
        assert.strictEqual(settings.log.timeout, 30);
    });

    it('rejects a missing settings file named explicitly', () => {
        assert.throws(() => loadSettings(path.join(os.tmpdir(), 'cli-missing', 'mine.json'), { explicit: true }), /cannot be read/);
    });

    it('rejects a settings file that is not JSON', () => {
        assert.throws(() => loadSettings(settingsFile('{ host: '), { explicit: true }), /not a valid JSON format/);
    });

    it('reads the settings file over the defaults', () => {
        const file = settingsFile(JSON.stringify({ ssl: false, log: { timeout: 60 } }));
        const { settings, settingsFile: loaded } = loadSettings(file, { explicit: false });

        assert.strictEqual(loaded, file);
        assert.strictEqual(settings.ssl, false);
        assert.strictEqual(settings.log.timeout, 60);
        assert.strictEqual(settings.timeout, 30);
    });
});
