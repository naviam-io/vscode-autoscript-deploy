/*
 * The CLI and the extension are released together, so their versions must match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('CLI version', () => {
    it('matches the extension version', () => {
        const extension = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        const cli = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'cli', 'package.json'), 'utf8'));

        assert.strictEqual(cli.version, extension.version);
    });
});
