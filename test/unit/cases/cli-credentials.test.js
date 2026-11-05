/*
 * Unit tests for the encryption of the password and API key in the CLI settings file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptCredentials, encryptSettingsFile, resolveKeyFile } from '../../../cli/lib/credentials.js';

function settingsFile(settings) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-credentials-')), 'settings.json');
    fs.writeFileSync(file, JSON.stringify(settings));
    return file;
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('CLI credentials', () => {
    it('round-trips the password and API key through the key file', () => {
        const file = settingsFile({ password: 'secret', apikey: 'key' });

        const keyFile = encryptSettingsFile(file, undefined);
        const settings = read(file);

        assert.strictEqual(keyFile, path.join(path.dirname(file), '.settings.json.key'));
        assert.match(settings.password, /^\{encrypted\}[0-9a-f]+$/);
        assert.match(settings.apikey, /^\{encrypted\}[0-9a-f]+$/);
        const config = decryptCredentials({ settingsFile: file, password: settings.password, apikey: settings.apikey });
        assert.strictEqual(config.password, 'secret');
        assert.strictEqual(config.apikey, 'key');
    });

    it('uses the key named by --key, relative to the settings file', () => {
        const file = settingsFile({ password: 'secret' });

        const keyFile = encryptSettingsFile(file, 'keys/my.key');

        assert.strictEqual(keyFile, path.join(path.dirname(file), 'keys', 'my.key'));
        assert.ok(fs.existsSync(keyFile));
        assert.ok(!fs.existsSync(path.join(path.dirname(file), '.settings.json.key')));
        assert.strictEqual(decryptCredentials({ settingsFile: file, key: 'keys/my.key', password: read(file).password }).password, 'secret');
    });

    it('expands ~ to the home directory', () => {
        assert.strictEqual(resolveKeyFile('/tmp/settings.json', '~/.maximo.key'), path.join(os.homedir(), '.maximo.key'));
    });

    it('falls back to the key file earlier versions used, with a warning', () => {
        const file = settingsFile({ password: 'secret' });
        encryptSettingsFile(file, undefined);
        const warnings = [];

        const config = decryptCredentials({ settingsFile: file, key: '~/cli-test-missing.key', password: read(file).password }, (message) => warnings.push(message));

        assert.strictEqual(config.password, 'secret');
        assert.match(warnings[0], /does not exist, using .*\.settings\.json\.key/);
    });

    it('refuses to decrypt without the key file', () => {
        const file = settingsFile({ password: 'secret' });
        encryptSettingsFile(file, 'other.key');

        assert.throws(() => decryptCredentials({ settingsFile: file, password: read(file).password }), /cannot be read/);
    });

    it('refuses to encrypt what is already encrypted', () => {
        const file = settingsFile({ password: 'secret' });
        encryptSettingsFile(file, undefined);

        assert.throws(() => encryptSettingsFile(file, undefined), /already encrypted/);
    });

    it('leaves plain values alone', () => {
        const config = { settingsFile: '/nowhere/settings.json', password: 'plain' };
        assert.strictEqual(decryptCredentials(config), config);
    });
});
