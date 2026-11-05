/*
 * The CLI is published as a public scoped package on npmjs; a scoped package is private by default.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const cli = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'cli', 'package.json'), 'utf8'));

describe('CLI package', () => {
    it('is published as @naviam/maximo-dev-tools', () => {
        assert.strictEqual(cli.name, '@naviam/maximo-dev-tools');
    });

    it('is published publicly to npmjs', () => {
        assert.deepStrictEqual(cli.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org' });
    });

    it('installs the maximo-dev-tools command', () => {
        assert.deepStrictEqual(cli.bin, { 'maximo-dev-tools': 'dist/index.js' });
    });
});
