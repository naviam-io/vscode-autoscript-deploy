/*
 * Unit tests for the create-only helpers shared by the client and the deployers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SKIPPED, createOnlyParams, assertCreateOnlyOutcome, isSkipped, skippedMessage, OUTDATED_SERVER_MESSAGE } from '../../../src/core/deploy/create-only.js';
import { MaximoError } from '../../../src/core/maximo/errors.js';

describe('create-only helpers', () => {
    it('sends the flag only when asked to', () => {
        assert.deepStrictEqual(createOnlyParams({ createOnly: true }), { createOnly: 'true' });
        assert.strictEqual(createOnlyParams({ createOnly: false }), undefined);
        assert.strictEqual(createOnlyParams(undefined), undefined);
    });

    it('accepts a response that reports its outcome', () => {
        assert.doesNotThrow(() => assertCreateOnlyOutcome({ status: 'success', outcome: 'created' }, { createOnly: true }));
    });

    it('rejects a create-only response without an outcome, which an outdated server sends', () => {
        assert.throws(() => assertCreateOnlyOutcome({ status: 'success' }, { createOnly: true }), (error) => error instanceof MaximoError && error.message === OUTDATED_SERVER_MESSAGE);
    });

    it('does not judge an error response or a request without the flag', () => {
        assert.doesNotThrow(() => assertCreateOnlyOutcome({ status: 'error', message: 'x' }, { createOnly: true }));
        assert.doesNotThrow(() => assertCreateOnlyOutcome({ status: 'success' }, {}));
    });

    it('treats a result as skipped only for a create-only request', () => {
        assert.strictEqual(isSkipped({ outcome: SKIPPED }, { createOnly: true }), true);
        assert.strictEqual(isSkipped({ outcome: SKIPPED }, {}), false);
        assert.strictEqual(isSkipped({ outcome: 'updated' }, { createOnly: true }), false);
    });

    it('words the skip message', () => {
        assert.strictEqual(skippedMessage('a.js'), 'a.js already exists in Maximo and is create-only; it was left unchanged.');
    });
});
