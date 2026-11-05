/*
 * Unit tests for the session password cache, which must never hand one environment's password to
 * another.
 *
 *   npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createPasswordCache } from '../../../src/password-cache.js';

const dev = { host: 'dev.example.com', port: 443, context: 'maximo', username: 'wilson' };

describe('createPasswordCache', () => {
    it('returns the password for the environment it was set for', () => {
        const passwords = createPasswordCache();
        passwords.set(dev, 'dev-password');
        assert.strictEqual(passwords.get({ ...dev }), 'dev-password');
    });

    it('never returns it for another host, port, context or user', () => {
        const passwords = createPasswordCache();
        passwords.set(dev, 'dev-password');

        for (const other of [
            { ...dev, host: 'prod.example.com' },
            { ...dev, port: 9443 },
            { ...dev, context: 'maxprod' },
            { ...dev, username: 'maxadmin' }
        ]) {
            assert.strictEqual(passwords.get(other), undefined, JSON.stringify(other));
        }
    });

    it('holds one environment at a time, so setting another replaces it', () => {
        const passwords = createPasswordCache();
        const prod = { ...dev, host: 'prod.example.com' };
        passwords.set(dev, 'dev-password');
        passwords.set(prod, 'prod-password');

        assert.strictEqual(passwords.get(dev), undefined);
        assert.strictEqual(passwords.get(prod), 'prod-password');
    });

    it('forgets the password when cleared', () => {
        const passwords = createPasswordCache();
        passwords.set(dev, 'dev-password');
        passwords.clear();
        assert.strictEqual(passwords.get(dev), undefined);
    });
});
