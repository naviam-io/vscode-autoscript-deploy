/*
 * Unit tests for requireKeys, the key field check each configuration type runs in its constructor,
 * which the library calls for the whole payload before applying any of it.
 *
 *   npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';

const { requireKeys, MaximoQuery, MaximoCronTask, MaximoDomain, MaximoMessage, MaximoProperty, MaximoIntegrationObject } = loadScriptFunctions(
    'resources/naviam.autoscript.library.js',
    [
        'requireKeys',
        'valueOrDefault',
        'booleanOrDefault',
        'arrayOrEmpty',
        'MaximoQuery',
        'MaximoCronTask',
        'MaximoDomain',
        'MaximoMessage',
        'MaximoProperty',
        'MaximoIntegrationObject',
        'validateIntegrationObjectInput',
        'rejectDuplicates'
    ],
    {}
);

describe('requireKeys', () => {
    it('accepts a record with every key field', () => {
        assert.doesNotThrow(() => requireKeys(MaximoQuery, { app: 'WOTRACK', clauseName: 'Q', owner: 'MAXADMIN' }, 'query'));
    });

    it('names a missing key and the rest of the identity', () => {
        assert.throws(
            () => requireKeys(MaximoQuery, { _delete: true, app: 'WOTRACK', owner: 'MAXADMIN' }, 'query'),
            { message: 'The query is missing key "clauseName" (app: WOTRACK, owner: MAXADMIN).' }
        );
    });

    it('treats null, empty and blank values as missing and lists them together', () => {
        assert.throws(() => requireKeys(MaximoQuery, { app: null, clauseName: '', owner: '  ' }, 'query'), {
            message: 'The query is missing keys "app", "clauseName", "owner".'
        });
    });

    it('rejects a missing record', () => {
        assert.throws(() => requireKeys(MaximoDomain, null, 'domain'), { message: 'The domain is missing key "domainId".' });
    });
});

describe('configuration type constructors', () => {
    it('reject an entry without its keys, for a delete too', () => {
        assert.throws(() => new MaximoQuery({ _delete: true, app: 'WOTRACK', owner: 'MAXADMIN' }), /The query is missing key "clauseName"/);
        assert.throws(() => new MaximoCronTask({ className: 'x' }), /The cron task is missing key "cronTaskName"/);
        assert.throws(() => new MaximoDomain({ domainType: 'ALN' }), /The domain is missing key "domainId"/);
        assert.throws(() => new MaximoMessage({ msgGroup: 'G', value: 'v' }), /The message is missing key "msgKey" \(msgGroup: G\)/);
        assert.throws(() => new MaximoProperty({ _delete: true }), /The property is missing key "propName"/);
        assert.throws(() => new MaximoIntegrationObject({ _delete: true, intObjectName: ' ' }), /The integration object is missing key "intObjectName"/);
    });

    it('accept an entry with its keys', () => {
        assert.strictEqual(new MaximoQuery({ app: 'WOTRACK', clauseName: 'Q', owner: 'MAXADMIN' }).clauseName, 'Q');
        assert.strictEqual(new MaximoCronTask({ cronTaskName: 'C', className: 'x' }).cronTaskName, 'C');
        assert.strictEqual(new MaximoDomain({ domainId: 'D', domainType: 'ALN' }).domainId, 'D');
        assert.strictEqual(new MaximoMessage({ msgGroup: 'G', msgKey: 'K', value: 'v' }).msgKey, 'K');
        assert.strictEqual(new MaximoProperty({ _delete: true, propName: 'p' }).propName, 'p');
    });

    it('keep their own validation beyond the keys', () => {
        assert.throws(() => new MaximoMessage({ msgGroup: 'G', msgKey: 'K' }), /The value property is required/);
        assert.throws(() => new MaximoIntegrationObject({ intObjectName: 'IO' }), /The maxIntObjDetail property is required/);
    });
});
