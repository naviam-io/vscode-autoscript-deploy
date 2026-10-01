/*
 * Unit tests for the retained values snapshot key.
 *
 *   npm run test:unit
 *
 * The key identifies a snapshot by the record it belongs to rather than by a deployment run, which
 * is what makes a retried deployment idempotent: a snapshot that already exists can only have been
 * left behind by a run that never completed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { loadScriptFunctions } = require('../harness');

// Nashorn's java.security.MessageDigest and node:crypto produce identical SHA-256 bytes, so the
// stub exercises the real digest rather than a placeholder.
const Java = {
    type(name) {
        if (name === 'java.lang.String') {
            return function JavaString(value) {
                this.getBytes = () => Buffer.from(value, 'utf8');
            };
        }
        if (name === 'java.security.MessageDigest') {
            return {
                getInstance: (algorithm) => ({
                    digest: (bytes) => crypto.createHash(algorithm.replace('-', '').toLowerCase()).update(bytes).digest(),
                }),
            };
        }
        throw new Error('Unexpected Java type: ' + name);
    },
};

const { snapshotKey } = loadScriptFunctions('resources/naviam.autoscript.library.js', ['snapshotKey', 'snapshotKeyHash'], { Java });

describe('snapshotKey', () => {
    it('namespaces the key by Maximo object and natural key', () => {
        assert.strictEqual(snapshotKey('CRONTASKDEF', 'SFG20SYNC'), 'MDT-RETAIN:CRONTASKDEF:SFG20SYNC');
    });

    it('is stable across calls, so a retry finds the snapshot the failed run wrote', () => {
        assert.strictEqual(snapshotKey('CRONTASKDEF', 'A'), snapshotKey('CRONTASKDEF', 'A'));
    });

    it('distinguishes records of different types that share an identity', () => {
        assert.notStrictEqual(snapshotKey('CRONTASKDEF', 'A'), snapshotKey('MAXPROP', 'A'));
    });

    it('bounds the key to the CONTENTUID column, so a 50 character cron task name does not overflow it', () => {
        const name = 'A'.repeat(50);
        assert.strictEqual(snapshotKey('CRONTASKDEF', name).length, 50);
    });

    it('hashes the whole readable key, so names sharing a prefix but differing in the tail do not collide under truncation', () => {
        const shared = 'X'.repeat(40);
        const first = snapshotKey('CRONTASKDEF', shared + 'AAAAAAAAAA');
        const second = snapshotKey('CRONTASKDEF', shared + 'BBBBBBBBBB');
        assert.notStrictEqual(first, second);
    });

    it('is stable for a long name across calls, so a retry still finds the snapshot the failed run wrote', () => {
        const name = 'A'.repeat(50);
        assert.strictEqual(snapshotKey('CRONTASKDEF', name), snapshotKey('CRONTASKDEF', name));
    });
});
