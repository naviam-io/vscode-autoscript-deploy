/*
 * Enforces the rules that let the CLI use src/core: see docs/modules/core.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'src', 'core');

const SPECIFIER = /\b(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function coreFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return coreFiles(full);
        }
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

function specifiers(source) {
    return [...source.matchAll(SPECIFIER)].map((match) => match[1] || match[2]);
}

describe('src/core boundary', () => {
    it('is an ES module package', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(CORE_DIR, 'package.json'), 'utf8'));
        assert.strictEqual(manifest.type, 'module');
    });

    for (const file of coreFiles(CORE_DIR)) {
        const name = path.relative(CORE_DIR, file);
        const source = fs.readFileSync(file, 'utf8');

        describe(name, () => {
            it('imports nothing from vscode or outside src/core', () => {
                for (const specifier of specifiers(source)) {
                    assert.notStrictEqual(specifier, 'vscode', `${name} imports vscode`);
                    if (specifier.startsWith('.')) {
                        const target = path.resolve(path.dirname(file), specifier);
                        assert.ok(target.startsWith(CORE_DIR + path.sep), `${name} imports ${specifier}, outside src/core`);
                    }
                }
            });

            it('fully specifies its relative imports', () => {
                for (const specifier of specifiers(source).filter((s) => s.startsWith('.'))) {
                    assert.ok(specifier.endsWith('.js'), `${name} imports ${specifier} without .js`);
                }
            });

            it('uses no CommonJS globals', () => {
                assert.doesNotMatch(source, /\brequire\s*\(|\b__dirname\b|\b__filename\b/);
            });

            it('loads under Node', async () => {
                await import(pathToFileURL(file).href);
            });
        });
    }
});
