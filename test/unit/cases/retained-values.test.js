/*
 * Unit tests for the retained values engine.
 *
 *   npm run test:unit
 *
 * The engine decides which values a deployment must leave alone because the customer owns them. It
 * carries no knowledge of any configuration type: it reads the natural key from a model class's
 * static _keys and rebuilds the result through the model's own constructor. That is why most of
 * these tests drive it with local classes rather than with the cron task models. The classes below
 * are not stand-ins for the real ones; they are the whole contract an adopter has to meet, so a
 * configuration type added later is covered by the same tests it already passes.
 *
 * The cron task models are then checked against that contract separately, at the bottom.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { loadScriptFunctions } from '../harness.js';

const {
    hasRetainDeclarations,
    applyRetainedValues,
    retainIdentityOf,
    MaximoCronTask,
    MaximoCronTaskInstance,
    MaximoCronTaskParam,
    MaximoDomain,
    MaximoDiscreteDomainValue,
    MaximoNumRangeDomainValue,
    MaximoSynonymDomainValue,
    MaximoTableDomainValue,
    MaximoCrossoverDomainValue,
    MaximoCrossoverField,
    MaximoDomainValueCondition,
    MaximoQuery,
    MaximoEndPoint,
    MaximoEndPointProperty,
    MaximoMessage,
    MaximoProperty,
    MaximoPropertyInstance,
    MaximoLogger,
    MaximoAction,
    MaximoActionGroup,
    MaximoEscalation,
    MaximoEscalationRefPoint,
    MaximoEscalationNotification,
    MaximoObject,
    MaximoAttribute,
    Relationship
} = loadScriptFunctions(
    'resources/naviam.autoscript.library.js',
    [
        'hasRetainDeclarations',
        'applyRetainedValues',
        'retainIdentityOf',
        'retainInto',
        'retainIsMarker',
        'retainIsCollection',
        'retainKeysOf',
        'retainSameKeyValue',
        'retainSameRow',
        'retainFindRow',
        'retainCollectionNames',
        'MaximoCronTask',
        'MaximoCronTaskInstance',
        'MaximoCronTaskParam',
        'MaximoDomain',
        'MaximoDiscreteDomainValue',
        'MaximoNumRangeDomainValue',
        'MaximoSynonymDomainValue',
        'MaximoTableDomainValue',
        'MaximoCrossoverDomainValue',
        'MaximoCrossoverField',
        'MaximoDomainValueCondition',
        'MaximoQuery',
        'MaximoEndPoint',
        'MaximoEndPointProperty',
        'MaximoMessage',
        'MaximoProperty',
        'MaximoPropertyInstance',
        'MaximoLogger',
        'MaximoAction',
        'MaximoActionGroup',
        'MaximoEscalation',
        'MaximoEscalationRefPoint',
        'MaximoEscalationNotification',
        'MaximoObject',
        'MaximoAttribute',
        'Relationship',
        'Index',
        'Column',
        'upperCaseKey',
        'arrayOrEmpty',
        'booleanOrDefault',
        'valueOrDefault',
        'requireKeys',
        'rejectDuplicates'
    ],
    {}
);

/*
 * A minimal adopter. Child defaults every property it does not receive and declares a composite key,
 * which is the case the cron task models do not exercise.
 */
function Child(input) {
    this.app = input.app;
    this.owner = input.owner;
    this.clause = typeof input.clause === 'undefined' ? '' : input.clause;
    this.description = typeof input.description === 'undefined' ? '' : input.description;
    this._retain = input._retain || [];
}
Child._keys = ['app', 'owner'];

function Parent(input) {
    this.name = input.name;
    this.description = typeof input.description === 'undefined' ? '' : input.description;
    this.child = (input.child || []).map(function (row) {
        return new Child(row);
    });
    this._retain = input._retain || [];
}
Parent._keys = ['name'];

describe('hasRetainDeclarations', () => {
    it('is false for a payload that asks for nothing, so an ordinary deployment does no snapshot work', () => {
        assert.strictEqual(hasRetainDeclarations(new Parent({ name: 'P', child: [{ app: 'A', owner: 'O' }] })), false);
    });

    it('is false for an empty _retain array', () => {
        assert.strictEqual(hasRetainDeclarations(new Parent({ name: 'P', _retain: [] })), false);
    });

    it('is true when the top level asks for retention', () => {
        assert.strictEqual(hasRetainDeclarations(new Parent({ name: 'P', _retain: ['description'] })), true);
    });

    it('is true when only a nested row asks for retention', () => {
        const parent = new Parent({ name: 'P', child: [{ app: 'A', owner: 'O', _retain: ['description'] }] });
        assert.strictEqual(hasRetainDeclarations(parent), true);
    });

    it('tolerates a missing payload', () => {
        assert.strictEqual(hasRetainDeclarations(null), false);
    });
});

describe('applyRetainedValues scalars', () => {
    it('replaces a retained property with the value the target system holds', () => {
        const target = new Parent({ name: 'P', description: 'shipped', _retain: ['description'] });
        const result = applyRetainedValues(target, { name: 'P', description: 'customer edited' });
        assert.strictEqual(result.description, 'customer edited');
    });

    it('leaves a property the payload did not mark, so the product still ships its own defaults', () => {
        const target = new Parent({ name: 'P', description: 'shipped' });
        const result = applyRetainedValues(target, { name: 'P', description: 'customer edited' });
        assert.strictEqual(result.description, 'shipped');
    });

    it("retains a falsy value, because an emptied field is still the customer's choice", () => {
        const target = new Parent({ name: 'P', description: 'shipped', _retain: ['description'] });
        const result = applyRetainedValues(target, { name: 'P', description: '' });
        assert.strictEqual(result.description, '');
    });

    it('keeps the payload value when the snapshot does not carry the property at all', () => {
        const target = new Parent({ name: 'P', description: 'shipped', _retain: ['description'] });
        const result = applyRetainedValues(target, { name: 'P' });
        assert.strictEqual(result.description, 'shipped');
    });

    it('ignores a name the payload made up, exactly as the model constructors ignore an unknown property', () => {
        const target = new Parent({ name: 'P', _retain: ['notAProperty'] });
        const result = applyRetainedValues(target, { name: 'P', notAProperty: 'x' });
        assert.strictEqual(typeof result.notAProperty, 'undefined');
    });

    it('does nothing when there is no snapshot, which is the case for a record being created', () => {
        const target = new Parent({ name: 'P', description: 'shipped', _retain: ['description'] });
        const result = applyRetainedValues(target, null);
        assert.strictEqual(result.description, 'shipped');
    });
});

describe('applyRetainedValues nested rows', () => {
    it('matches a nested row on its composite key before copying anything into it', () => {
        const target = new Parent({
            name: 'P',
            child: [
                { app: 'PO', owner: 'ALICE', description: 'shipped', _retain: ['description'] },
                { app: 'PO', owner: 'BOB', description: 'shipped', _retain: ['description'] }
            ]
        });

        const result = applyRetainedValues(target, {
            name: 'P',
            child: [
                { app: 'PO', owner: 'BOB', description: 'bob edited' },
                { app: 'PO', owner: 'ALICE', description: 'alice edited' }
            ]
        });

        assert.strictEqual(result.child[0].description, 'alice edited');
        assert.strictEqual(result.child[1].description, 'bob edited');
    });

    it('does not confuse two rows that agree on only part of a composite key', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: 'ALICE', description: 'shipped', _retain: ['description'] }] });
        const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PO', owner: 'BOB', description: 'bob edited' }] });
        assert.strictEqual(result.child[0].description, 'shipped');
    });

    it('matches a blank key part whether either side holds it as null, undefined or empty, because Maximo stores all three as null', () => {
        [null, undefined, ''].forEach((payloadOwner) => {
            [null, undefined, ''].forEach((snapshotOwner) => {
                const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: payloadOwner, description: 'shipped', _retain: ['description'] }] });
                const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PO', owner: snapshotOwner, description: 'edited' }] });
                assert.strictEqual(result.child[0].description, 'edited', JSON.stringify(payloadOwner) + ' against ' + JSON.stringify(snapshotOwner));
                assert.strictEqual(result.child[0].owner, payloadOwner, 'The payload keeps its own blank');
            });
        });
    });

    it('does not match a blank key part to a value', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: null, description: 'shipped', _retain: ['description'] }] });
        const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PO', owner: 'ALICE', description: 'alice edited' }] });
        assert.strictEqual(result.child[0].description, 'shipped');
    });

    it('leaves a payload row the snapshot has no counterpart for, so a newly shipped row gets its defaults', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'NEW', owner: 'O', description: 'shipped', _retain: ['description'] }] });
        const result = applyRetainedValues(target, { name: 'P', child: [] });
        assert.strictEqual(result.child[0].description, 'shipped');
    });
});

describe('applyRetainedValues collections', () => {
    it('appends a row the customer added, when the payload names the collection', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: 'ALICE' }], _retain: ['child'] });
        const result = applyRetainedValues(target, {
            name: 'P',
            child: [
                { app: 'PO', owner: 'ALICE', description: 'ignored, the payload row wins' },
                { app: 'PR', owner: 'CUSTOM', description: 'customer added' }
            ]
        });

        assert.strictEqual(result.child.length, 2);
        assert.strictEqual(result.child[1].app, 'PR');
        assert.strictEqual(result.child[1].description, 'customer added');
    });

    it('does not append when the payload does not name the collection, so a removed row stays removed', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: 'ALICE' }] });
        const result = applyRetainedValues(target, {
            name: 'P',
            child: [
                { app: 'PO', owner: 'ALICE' },
                { app: 'PR', owner: 'CUSTOM' }
            ]
        });

        assert.strictEqual(result.child.length, 1);
    });

    it('never overwrites a payload row with its snapshot counterpart, because the payload is the shipped definition', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: 'ALICE', description: 'shipped' }], _retain: ['child'] });
        const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PO', owner: 'ALICE', description: 'customer edited' }] });
        assert.strictEqual(result.child[0].description, 'shipped');
    });

    it('appends every snapshot row when the payload declares the collection empty', () => {
        const target = new Parent({ name: 'P', child: [], _retain: ['child'] });
        const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PR', owner: 'CUSTOM' }] });
        assert.strictEqual(result.child.length, 1);
    });

    it('rebuilds an appended row through the model constructor, so a property the snapshot omits is defaulted rather than left absent', () => {
        const target = new Parent({ name: 'P', child: [], _retain: ['child'] });
        const result = applyRetainedValues(target, { name: 'P', child: [{ app: 'PR', owner: 'CUSTOM' }] });

        assert.ok(result.child[0] instanceof Child);
        assert.strictEqual(result.child[0].clause, '');
        assert.deepStrictEqual(result.child[0]._retain, []);
    });

    it('tolerates a snapshot that omits the collection entirely', () => {
        const target = new Parent({ name: 'P', child: [{ app: 'PO', owner: 'ALICE' }], _retain: ['child'] });
        const result = applyRetainedValues(target, { name: 'P' });
        assert.strictEqual(result.child.length, 1);
    });

    it('does not mistake _retain itself for a retainable collection', () => {
        const target = new Parent({ name: 'P', _retain: ['description'] });
        const result = applyRetainedValues(target, { name: 'P', description: 'customer edited', _retain: ['anything'] });
        assert.deepStrictEqual(result._retain, ['description']);
    });
});

describe('retainIdentityOf', () => {
    it('reads the identity from the model rather than from a second declaration of it', () => {
        assert.strictEqual(retainIdentityOf(new Parent({ name: 'SFG20SYNC' })), 'SFG20SYNC');
    });

    it('joins a composite key, so a record identified by several columns needs no special case', () => {
        assert.strictEqual(retainIdentityOf(new Child({ app: 'PO', owner: 'ALICE' })), 'PO:ALICE');
    });

    it('fails loudly for a model that declares no key, rather than writing a snapshot nothing can find', () => {
        function Unkeyed() {
            this.name = 'x';
        }

        assert.throws(() => retainIdentityOf(new Unkeyed()), /_keys/);
    });
});

/*
 * The cron task models, checked against the two obligations the engine places on an adopter. Nesting
 * is covered above with the local classes.
 */
describe('cron task models meet the adopter contract', () => {
    it('declares the natural key of every level', () => {
        assert.deepStrictEqual(MaximoCronTask._keys, ['cronTaskName']);
        assert.deepStrictEqual(MaximoCronTaskInstance._keys, ['instanceName']);
        assert.deepStrictEqual(MaximoCronTaskParam._keys, ['parameter']);
    });

    it('identifies a cron task by the same name the snapshot key is built from', () => {
        assert.strictEqual(retainIdentityOf(new MaximoCronTask({ cronTaskName: 'SFG20SYNC' })), 'SFG20SYNC');
    });

    it('defaults the child collection of an instance the extract script emitted without one', () => {
        const rebuilt = new MaximoCronTaskInstance({ instanceName: 'CUSTOM1', schedule: '1h,*' });
        assert.deepStrictEqual(rebuilt.cronTaskParam, []);
    });

    it('defaults every scalar an extracted row omits, so the apply layer never falls back to a Maximo column default', () => {
        const rebuilt = new MaximoCronTaskInstance({ instanceName: 'CUSTOM1' });
        assert.strictEqual(rebuilt.active, false);
        assert.strictEqual(rebuilt.keepHistory, true);
        assert.strictEqual(rebuilt.maxHistory, 1000);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoCronTaskParam({ parameter: 'HOST', value: 'server1' });
        assert.deepStrictEqual(new MaximoCronTaskParam(once), once);
    });
});

/*
 * The domain models, checked against the same two obligations. The defaulting assertions matter
 * because a captured record only matches the payload row it belongs to once both have been built
 * by the same model class.
 */
describe('domain models meet the adopter contract', () => {
    it('declares the natural key of every level', () => {
        assert.deepStrictEqual(MaximoDomain._keys, ['domainId']);
        assert.deepStrictEqual(MaximoDiscreteDomainValue._keys, ['value', 'orgId', 'siteId']);
        assert.deepStrictEqual(MaximoNumRangeDomainValue._keys, ['rangeSegment', 'orgId', 'siteId']);
        assert.deepStrictEqual(MaximoSynonymDomainValue._keys, ['value', 'maxValue', 'orgId', 'siteId']);
        assert.deepStrictEqual(MaximoTableDomainValue._keys, ['orgId', 'siteId']);
        assert.deepStrictEqual(MaximoCrossoverDomainValue._keys, ['orgId', 'siteId']);
        assert.deepStrictEqual(MaximoCrossoverField._keys, ['sourceField', 'destField']);
        assert.deepStrictEqual(MaximoDomainValueCondition._keys, ['conditionNum', 'objectName']);
    });

    it('identifies a domain by the same id the snapshot key is built from', () => {
        assert.strictEqual(retainIdentityOf(new MaximoDomain({ domainId: 'SFG20STATUS', domainType: 'ALN' })), 'SFG20STATUS');
    });

    it('defaults the scope of a value the extract script emitted without one, so a payload row and its snapshot counterpart compare equal', () => {
        const payload = new MaximoDiscreteDomainValue({ value: 'DRAFT', description: 'Draft' });
        const snapshot = new MaximoDiscreteDomainValue({ value: 'DRAFT' });

        assert.strictEqual(payload.orgId, snapshot.orgId);
        assert.strictEqual(payload.siteId, snapshot.siteId);
    });

    it('defaults every scalar an extracted row omits, so the apply layer never falls back to a Maximo column default', () => {
        const table = new MaximoTableDomainValue({ objectName: 'ASSET' });
        assert.strictEqual(table.validtnWhereClause, '');
        assert.strictEqual(table.listWhereClause, '');

        const field = new MaximoCrossoverField({ sourceField: 'DESCRIPTION', destField: 'DESCRIPTION' });
        assert.strictEqual(field.copyEvenIfSrcNull, false);
        assert.strictEqual(field.copyOnlyIfDestNull, false);
        assert.strictEqual(field.sequence, null);
    });

    it('defaults every value collection of a domain the extract script emitted without one', () => {
        const rebuilt = new MaximoDomain({ domainId: 'SFG20STATUS', domainType: 'ALN' });

        assert.deepStrictEqual(rebuilt.alnDomain, []);
        assert.deepStrictEqual(rebuilt.numericDomain, []);
        assert.deepStrictEqual(rebuilt.numRangeDomain, []);
        assert.deepStrictEqual(rebuilt.synonymDomain, []);
        assert.deepStrictEqual(rebuilt.tableDomain, []);
        assert.deepStrictEqual(rebuilt.crossoverDomain, []);
    });

    it('round trips one of its own values unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoSynonymDomainValue({ value: 'WAPPR', maxValue: 'APPR', description: 'Waiting on approval' });
        assert.deepStrictEqual(new MaximoSynonymDomainValue(once), once);
    });
});

/*
 * The query model has no child collections, so its obligations reduce to a key that matches how the
 * record is found and a constructor that rebuilds its own instances.
 */
describe('query model meets the adopter contract', () => {
    const shipped = {
        app: 'WOTRACK',
        clauseName: 'SFG20OPEN',
        owner: 'MAXADMIN',
        clause: "status = 'APPR'",
        description: 'Open work',
        isPublic: true,
        isUserList: false,
        notes: 'Shipped notes',
        priority: 1
    };

    it('declares the natural key the query is looked up by', () => {
        assert.deepStrictEqual(MaximoQuery._keys, ['app', 'clauseName', 'owner']);
    });

    it('identifies a query by the same app, name and owner the snapshot key is built from', () => {
        assert.strictEqual(retainIdentityOf(new MaximoQuery(shipped)), 'WOTRACK:SFG20OPEN:MAXADMIN');
    });

    it('keeps the retained values of the existing query and ships everything else', () => {
        const payload = new MaximoQuery(Object.assign({}, shipped, { _retain: ['clause', 'isPublic'] }));
        const snapshot = new MaximoQuery(Object.assign({}, shipped, { clause: "status = 'WAPPR'", isPublic: false, description: 'Customer description' }));

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.clause, "status = 'WAPPR'");
        assert.strictEqual(merged.isPublic, false);
        assert.strictEqual(merged.description, 'Open work');
    });

    it('leaves a retained property the existing query holds as null unset, so the apply layer keeps the null rather than writing the shipped value', () => {
        const payload = new MaximoQuery(Object.assign({}, shipped, { _retain: ['notes'] }));
        const extracted = Object.assign({}, shipped);
        delete extracted.notes;

        const merged = applyRetainedValues(payload, new MaximoQuery(extracted));

        assert.strictEqual(merged.notes, undefined);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoQuery(Object.assign({}, shipped, { _retain: ['clause'] }));
        assert.deepStrictEqual(new MaximoQuery(once), once);
    });
});

/*
 * The handler defines an end point's property rows, so a property value the payload omits must stay
 * undefined through the rebuild: the apply layer leaves it unchanged rather than clearing it.
 */
describe('end point model meets the adopter contract', () => {
    const shipped = {
        endPointName: 'SFG20HTTP',
        description: 'SFG20 sync',
        handlerName: 'HTTP',
        properties: [
            { property: 'URL', value: 'https://example.com/shipped', allowOverride: false },
            { property: 'PASSWORD', password: 'shipped' }
        ]
    };

    it('declares the natural keys the end point and its properties are looked up by', () => {
        assert.deepStrictEqual(MaximoEndPoint._keys, ['endPointName']);
        assert.deepStrictEqual(MaximoEndPointProperty._keys, ['property']);
    });

    it('keeps the retained value and password of the existing end point and ships everything else', () => {
        const payload = new MaximoEndPoint({
            endPointName: 'SFG20HTTP',
            description: 'SFG20 sync',
            handlerName: 'HTTP',
            properties: [
                { property: 'URL', value: 'https://example.com/shipped', allowOverride: false, _retain: ['value'] },
                { property: 'PASSWORD', password: 'shipped', _retain: ['password'] }
            ]
        });
        const snapshot = new MaximoEndPoint({
            endPointName: 'SFG20HTTP',
            description: 'Customer description',
            handlerName: 'HTTP',
            properties: [
                { property: 'PASSWORD', password: 'customer', allowOverride: false },
                { property: 'URL', value: 'https://customer.example.com', allowOverride: true }
            ]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.description, 'SFG20 sync');
        assert.strictEqual(merged.properties[0].value, 'https://customer.example.com');
        assert.strictEqual(merged.properties[0].allowOverride, false);
        assert.strictEqual(merged.properties[1].password, 'customer');
    });

    it('leaves a property value the payload omits undefined, so deploying it changes nothing', () => {
        const merged = applyRetainedValues(new MaximoEndPoint(Object.assign({}, shipped, { _retain: ['description'] })), new MaximoEndPoint(shipped));

        assert.strictEqual(merged.properties[0].password, undefined);
        assert.strictEqual(merged.properties[1].value, undefined);
        assert.strictEqual(merged.properties[1].allowOverride, undefined);
    });

    it('rejects a property that sets both value and password', () => {
        assert.throws(
            () => new MaximoEndPoint({ endPointName: 'SFG20HTTP', properties: [{ property: 'URL', value: 'a', password: 'b' }] }),
            /both value and password/
        );
    });

    it('rejects a property listed more than once', () => {
        assert.throws(
            () =>
                new MaximoEndPoint({
                    endPointName: 'SFG20HTTP',
                    properties: [
                        { property: 'URL', value: 'a' },
                        { property: 'URL', value: 'b' }
                    ]
                }),
            /more than once/
        );
    });

    it('keeps a null value distinct from an omitted one, so a property can be cleared', () => {
        const endPoint = new MaximoEndPoint({ endPointName: 'SFG20HTTP', properties: [{ property: 'URL', value: null }] });

        assert.strictEqual(endPoint.properties[0].value, null);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoEndPoint(Object.assign({}, shipped, { _retain: ['description'] }));
        assert.deepStrictEqual(new MaximoEndPoint(once), once);
    });
});

/*
 * A message has no child collections either, but its options are an array of strings rather than of
 * rows, which the engine must still retain as a whole whether the payload lists options or not.
 */
describe('message model meets the adopter contract', () => {
    const shipped = {
        msgGroup: 'SFG20',
        msgKey: 'SYNCFAILED',
        value: 'Synchronisation failed',
        displayMethod: 'MSGBOX',
        options: ['ok'],
        prefix: 'BMXZZ',
        suffix: 'E',
        explanation: 'Shipped explanation'
    };

    it('declares the natural key the message is looked up by', () => {
        assert.deepStrictEqual(MaximoMessage._keys, ['msgGroup', 'msgKey']);
    });

    it('identifies a message by the same group and key the snapshot key is built from', () => {
        assert.strictEqual(retainIdentityOf(new MaximoMessage(shipped)), 'SFG20:SYNCFAILED');
    });

    it('keeps the retained values of the existing message and ships everything else', () => {
        const payload = new MaximoMessage(Object.assign({}, shipped, { value: 'Sync failed', _retain: ['value', 'options'] }));
        const snapshot = new MaximoMessage(
            Object.assign({}, shipped, { value: 'Customer text', options: ['yes', 'no'], displayMethod: 'STATUS', msgId: 'BMXZZ0001E' })
        );

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.value, 'Customer text');
        assert.deepStrictEqual(merged.options, ['yes', 'no']);
        assert.strictEqual(merged.displayMethod, 'MSGBOX');
        assert.strictEqual(merged.msgId, null);
    });

    it('retains the existing options when the payload lists none', () => {
        const payload = new MaximoMessage(Object.assign({}, shipped, { options: [], _retain: ['options'] }));
        const snapshot = new MaximoMessage(Object.assign({}, shipped, { options: ['close', 'warning'] }));

        assert.deepStrictEqual(applyRetainedValues(payload, snapshot).options, ['close', 'warning']);
    });

    it('does not touch the options when they are not retained', () => {
        const payload = new MaximoMessage(Object.assign({}, shipped, { options: [], _retain: ['value'] }));
        const snapshot = new MaximoMessage(Object.assign({}, shipped, { options: ['close', 'warning'] }));

        assert.deepStrictEqual(applyRetainedValues(payload, snapshot).options, []);
    });

    it('carries a retained property the existing message holds as null, so the cleared value is not replaced by the shipped one', () => {
        const payload = new MaximoMessage(Object.assign({}, shipped, { _retain: ['explanation'] }));
        const extracted = Object.assign({}, shipped);
        delete extracted.explanation;

        const merged = applyRetainedValues(payload, new MaximoMessage(extracted));

        assert.strictEqual(merged.explanation, null);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoMessage(Object.assign({}, shipped, { _retain: ['value'] }));
        assert.deepStrictEqual(new MaximoMessage(once), once);
    });
});

/*
 * A property's instance rows are deleted and recreated on every deployment, so their retained values
 * come only from the snapshot, matched on the same server name and host Maximo keys them by.
 */
describe('property model meets the adopter contract', () => {
    const shipped = {
        propName: 'example.sync.url',
        description: 'Synchronisation endpoint',
        propValue: 'https://example.invalid/v1',
        onlineChanges: true,
        maxPropInstance: [{ serverName: 'MXServer', propValue: 'https://example.invalid/server' }]
    };

    function instanceOn(property, serverName) {
        return property.maxPropInstance.filter((instance) => instance.serverName === serverName)[0];
    }

    it('declares the natural keys the property and its instances are looked up by', () => {
        assert.deepStrictEqual(MaximoProperty._keys, ['propName']);
        assert.deepStrictEqual(MaximoPropertyInstance._keys, ['serverName', 'serverHost']);
    });

    it('identifies a property by its name', () => {
        assert.strictEqual(retainIdentityOf(new MaximoProperty(shipped)), 'example.sync.url');
    });

    it('keeps the retained values of the existing property and ships everything else', () => {
        const payload = new MaximoProperty(
            Object.assign({}, shipped, { description: 'Release 2', propValue: 'https://example.invalid/v2', _retain: ['propValue', 'onlineChanges'] })
        );
        const snapshot = new MaximoProperty(
            Object.assign({}, shipped, { description: 'Customer description', propValue: 'https://customer.invalid', onlineChanges: false })
        );

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.propValue, 'https://customer.invalid');
        assert.strictEqual(merged.onlineChanges, false);
        assert.strictEqual(merged.description, 'Release 2');
    });

    it('keeps the retained value of an existing instance matched by server name and host', () => {
        const payload = new MaximoProperty(
            Object.assign({}, shipped, {
                maxPropInstance: [
                    { serverName: 'MXServer', propValue: 'release 2', _retain: ['propValue'] },
                    { serverName: 'MXServer', serverHost: 'other.host', propValue: 'release 2 on other host', _retain: ['propValue'] }
                ]
            })
        );
        const snapshot = new MaximoProperty(
            Object.assign({}, shipped, { maxPropInstance: [{ serverName: 'MXServer', serverHost: '', propValue: 'customer value' }] })
        );

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.maxPropInstance.length, 2);
        assert.strictEqual(merged.maxPropInstance[0].propValue, 'customer value');
        assert.strictEqual(merged.maxPropInstance[1].propValue, 'release 2 on other host', 'A new instance gets the shipped value');
    });

    it('treats a null payload host as the empty host extract reports, so the instance still matches', () => {
        const payload = new MaximoProperty(
            Object.assign({}, shipped, { maxPropInstance: [{ serverName: 'MXServer', serverHost: null, propValue: 'release 2', _retain: ['propValue'] }] })
        );
        const snapshot = new MaximoProperty(
            Object.assign({}, shipped, { maxPropInstance: [{ serverName: 'MXServer', serverHost: '', propValue: 'customer value' }] })
        );

        const merged = applyRetainedValues(payload, snapshot);
        assert.strictEqual(merged.maxPropInstance[0].propValue, 'customer value');
        assert.strictEqual(merged.maxPropInstance[0].serverHost, '');
    });

    it('keeps an instance the customer added only when the property retains maxPropInstance', () => {
        const snapshot = new MaximoProperty(
            Object.assign({}, shipped, {
                maxPropInstance: shipped.maxPropInstance.concat([{ serverName: 'CustomerServer', propValue: 'customer instance' }])
            })
        );

        const retained = applyRetainedValues(new MaximoProperty(Object.assign({}, shipped, { _retain: ['maxPropInstance'] })), snapshot);
        assert.strictEqual(instanceOn(retained, 'CustomerServer').propValue, 'customer instance');
        assert.ok(retained.maxPropInstance.every((instance) => instance instanceof MaximoPropertyInstance));

        const notRetained = applyRetainedValues(new MaximoProperty(Object.assign({}, shipped, { _retain: ['propValue'] })), snapshot);
        assert.strictEqual(instanceOn(notRetained, 'CustomerServer'), undefined);
    });

    it('carries a retained boolean the extract omitted as a default, so the customer value is not replaced by the shipped one', () => {
        const payload = new MaximoProperty(Object.assign({}, shipped, { liveRefresh: false, _retain: ['liveRefresh'] }));
        const extracted = Object.assign({}, shipped);

        assert.strictEqual(applyRetainedValues(payload, new MaximoProperty(extracted)).liveRefresh, true);
    });

    it('carries a retained value the customer cleared', () => {
        const payload = new MaximoProperty(Object.assign({}, shipped, { _retain: ['propValue'] }));
        const extracted = Object.assign({}, shipped, { propValue: '' });

        assert.strictEqual(applyRetainedValues(payload, new MaximoProperty(extracted)).propValue, '');
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoProperty(
            Object.assign({}, shipped, {
                _retain: ['propValue'],
                maxPropInstance: [{ serverName: 'MXServer', serverHost: 'host', propValue: 'value', _retain: ['propValue'] }]
            })
        );
        assert.deepStrictEqual(new MaximoProperty(once), once);
    });
});

/*
 * A logger has no child rows: a child logger is a record of its own, so it carries its own _retain.
 * LOGGER repeats across parents and even across roots, so the identity is everything the payload
 * identifies the logger by.
 */
describe('logger model meets the adopter contract', () => {
    const shipped = {
        logger: 'examplesync',
        logLevel: 'ERROR',
        active: true,
        appenders: 'Console'
    };

    it('declares the name, the parent log key and the log key as its natural key', () => {
        assert.deepStrictEqual(MaximoLogger._keys, ['logger', 'parentLogKey', 'logKey']);
    });

    it('keeps the log key as the payload gives it, so deploy can tell a given key from none', () => {
        assert.strictEqual(new MaximoLogger(shipped).logKey, null);
        assert.strictEqual(retainIdentityOf(new MaximoLogger(shipped)), 'examplesync:null:null');
        assert.strictEqual(
            retainIdentityOf(new MaximoLogger(Object.assign({}, shipped, { logKey: 'log4j.logger.maximo.other' }))),
            'examplesync:null:log4j.logger.maximo.other'
        );
    });

    it('gives a root and a child of the same name different identities', () => {
        const root = new MaximoLogger({ logger: 'sql' });
        const child = new MaximoLogger({ logger: 'sql', parentLogKey: 'log4j.logger.maximo.report.birt' });

        assert.notStrictEqual(retainIdentityOf(root), retainIdentityOf(child));
    });

    it('identifies a child the same way whether it names its parent or its parent log key', () => {
        const byParent = new MaximoLogger({ logger: 'examplechild', parent: 'examplesync' });
        const byParentLogKey = new MaximoLogger({ logger: 'examplechild', parentLogKey: 'log4j.logger.maximo.examplesync' });

        assert.strictEqual(byParent.parentLogKey, 'log4j.logger.maximo.examplesync');
        assert.strictEqual(retainIdentityOf(byParent), retainIdentityOf(byParentLogKey));
    });

    it('rejects a logger without a name', () => {
        assert.throws(() => new MaximoLogger({ logLevel: 'INFO' }), /missing key "logger"/);
    });

    it('keeps the retained values of the existing logger and ships everything else', () => {
        const payload = new MaximoLogger(Object.assign({}, shipped, { logLevel: 'WARN', active: false, _retain: ['logLevel'] }));
        const snapshot = new MaximoLogger(Object.assign({}, shipped, { logLevel: 'DEBUG', active: true, appenders: 'Rolling' }));

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.logLevel, 'DEBUG');
        assert.strictEqual(merged.active, false);
        assert.strictEqual(merged.appenders, 'Console');
    });

    it('keeps the identity of the payload when the stored log key of a child differs from the parent log key and the name', () => {
        const payload = new MaximoLogger({ logger: 'WOSTATUS', parentLogKey: 'log4j.logger.maximo.service', active: true, _retain: ['active'] });
        const snapshot = new MaximoLogger({
            logger: 'WOSTATUS',
            logKey: 'log4j.logger.maximo.service.WORKORDER.WOSTATUS',
            parentLogKey: 'log4j.logger.maximo.service',
            active: false
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.active, false);
        assert.strictEqual(merged.logKey, null);
        assert.strictEqual(retainIdentityOf(merged), 'WOSTATUS:log4j.logger.maximo.service:null');
    });

    it('carries retained appenders the customer cleared, which extract omits', () => {
        const payload = new MaximoLogger(Object.assign({}, shipped, { _retain: ['appenders'] }));
        const extracted = { logger: 'examplesync', logKey: 'log4j.logger.maximo.examplesync', logLevel: 'ERROR', active: true };

        assert.strictEqual(applyRetainedValues(payload, new MaximoLogger(extracted)).appenders, '');
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild it', () => {
        const once = new MaximoLogger(Object.assign({}, shipped, { parent: 'parent', _retain: ['logLevel', 'active'] }));
        assert.deepStrictEqual(new MaximoLogger(once), once);
    });
});

/*
 * An action is deleted and recreated on every deployment, so the snapshot is the only source of the
 * values the customer changed, including the group members they added. Maximo lets a sequence hold one
 * member of a group, so a group row is identified by its sequence.
 */
describe('action model meets the adopter contract', () => {
    const shipped = {
        action: 'EXAMPLEGROUP',
        description: 'Release 1',
        type: 'GROUP',
        useWith: 'ALL',
        actionGroup: [
            { member: 'EXAMPLESET', sequence: 1 },
            { member: 'EXAMPLEAPPR', sequence: 2 }
        ]
    };

    function membersOf(action) {
        return action.actionGroup.map((row) => row.member + '@' + row.sequence);
    }

    it('declares the action name, and the sequence of a group row, as natural keys', () => {
        assert.deepStrictEqual(MaximoAction._keys, ['action']);
        assert.deepStrictEqual(MaximoActionGroup._keys, ['sequence']);
    });

    it('identifies an action by its name', () => {
        assert.strictEqual(retainIdentityOf(new MaximoAction(shipped)), 'EXAMPLEGROUP');
    });

    it('rejects an action without a name, which would otherwise share one snapshot with every other', () => {
        assert.throws(() => new MaximoAction({ type: 'SETVALUE', useWith: 'ALL' }), /missing key "action"/);
    });

    it('keeps the retained values of the existing action and ships everything else', () => {
        const payload = new MaximoAction({
            action: 'EXAMPLESET',
            description: 'Release 2',
            type: 'SETVALUE',
            useWith: 'ALL',
            objectName: 'WORKORDER',
            parameter: 'WOPRIORITY',
            value: '2',
            _retain: ['value', 'useWith']
        });
        const snapshot = new MaximoAction({
            action: 'EXAMPLESET',
            description: 'Release 1',
            type: 'SETVALUE',
            useWith: 'ESCALATION',
            objectName: 'WORKORDER',
            parameter: 'WOPRIORITY',
            value: '5'
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.value, '5');
        assert.strictEqual(merged.useWith, 'ESCALATION');
        assert.strictEqual(merged.description, 'Release 2');
    });

    it('keeps the members the customer added only when the action retains actionGroup, including a shipped member at another sequence', () => {
        const snapshot = new MaximoAction(
            Object.assign({}, shipped, {
                actionGroup: shipped.actionGroup.concat([
                    { member: 'CUSTOMERACTION', sequence: 3 },
                    { member: 'EXAMPLESET', sequence: 4 }
                ])
            })
        );

        const retained = applyRetainedValues(new MaximoAction(Object.assign({}, shipped, { _retain: ['actionGroup'] })), snapshot);
        assert.deepStrictEqual(membersOf(retained), ['EXAMPLESET@1', 'EXAMPLEAPPR@2', 'CUSTOMERACTION@3', 'EXAMPLESET@4']);
        assert.ok(retained.actionGroup.every((row) => row instanceof MaximoActionGroup));

        const notRetained = applyRetainedValues(new MaximoAction(Object.assign({}, shipped, { _retain: ['description'] })), snapshot);
        assert.deepStrictEqual(membersOf(notRetained), ['EXAMPLESET@1', 'EXAMPLEAPPR@2']);
    });

    it('treats a member the customer moved to another sequence as a row of its own', () => {
        const snapshot = new MaximoAction(
            Object.assign({}, shipped, {
                actionGroup: [
                    { member: 'EXAMPLESET', sequence: 5 },
                    { member: 'EXAMPLEAPPR', sequence: 2 }
                ]
            })
        );

        const merged = applyRetainedValues(new MaximoAction(Object.assign({}, shipped, { _retain: ['actionGroup'] })), snapshot);
        assert.deepStrictEqual(membersOf(merged), ['EXAMPLESET@1', 'EXAMPLEAPPR@2', 'EXAMPLESET@5']);
    });

    it('keeps the shipped member at a sequence the customer gave another member', () => {
        const snapshot = new MaximoAction(
            Object.assign({}, shipped, {
                actionGroup: [
                    { member: 'EXAMPLESET', sequence: 1 },
                    { member: 'CUSTOMERACTION', sequence: 2 }
                ]
            })
        );

        const merged = applyRetainedValues(new MaximoAction(Object.assign({}, shipped, { _retain: ['actionGroup'] })), snapshot);
        assert.deepStrictEqual(membersOf(merged), ['EXAMPLESET@1', 'EXAMPLEAPPR@2']);
    });

    it('carries a retained memo the customer cleared, which extract omits', () => {
        const payload = new MaximoAction({
            action: 'EXAMPLEAPPR',
            type: 'CHANGESTATUS',
            useWith: 'ALL',
            objectName: 'WORKORDER',
            value: 'APPR',
            memo: 'Release 2 memo',
            _retain: ['memo']
        });
        const extracted = { action: 'EXAMPLEAPPR', type: 'CHANGESTATUS', useWith: 'ALL', objectName: 'WORKORDER', value: 'APPR' };

        assert.strictEqual(applyRetainedValues(payload, new MaximoAction(extracted)).memo, '');
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoAction(Object.assign({}, shipped, { _retain: ['description', 'actionGroup'] }));
        assert.deepStrictEqual(new MaximoAction(once), once);
    });
});

/*
 * An escalation is updated in place, but its escalation points and their notifications are deleted and
 * added again on every deployment, so the snapshot is the only source of the points the customer added.
 */
describe('escalation model meets the adopter contract', () => {
    const shipped = {
        escalation: 'EXAMPLEESC',
        description: 'Release 1',
        objectName: 'WORKORDER',
        condition: "status = 'WAPPR'",
        active: true,
        schedule: '1h,*,0,*,*,*,*,*,*,*',
        escRefPoint: [
            {
                refPointNum: 1,
                eventAttribute: 'REPORTDATE',
                elapsedInterval: 2,
                intervalUom: 'HOURS',
                action: 'EXAMPLEACTION',
                escNotification: [{ templateId: 'EXAMPLETPL' }]
            }
        ]
    };

    function pointsOf(escalation) {
        return escalation.escRefPoint.map((row) => row.refPointNum);
    }

    it('declares the escalation name, the point number and the template as natural keys', () => {
        assert.deepStrictEqual(MaximoEscalation._keys, ['escalation']);
        assert.deepStrictEqual(MaximoEscalationRefPoint._keys, ['refPointNum']);
        assert.deepStrictEqual(MaximoEscalationNotification._keys, ['templateId']);
    });

    it('identifies an escalation by its name', () => {
        assert.strictEqual(retainIdentityOf(new MaximoEscalation(shipped)), 'EXAMPLEESC');
    });

    it('rejects an escalation without a name, which would otherwise share one snapshot with every other', () => {
        assert.throws(() => new MaximoEscalation({ objectName: 'WORKORDER' }), /missing key "escalation"/);
    });

    it('keeps the retained values of the existing escalation and ships everything else', () => {
        const payload = new MaximoEscalation(
            Object.assign({}, shipped, { description: 'Release 2', active: false, _retain: ['active', 'schedule', 'condition'] })
        );
        const snapshot = new MaximoEscalation(Object.assign({}, shipped, { schedule: '30m,*,*,*,*,*,*,*,*,*', condition: "status = 'APPR'" }));

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.active, true);
        assert.strictEqual(merged.schedule, '30m,*,*,*,*,*,*,*,*,*');
        assert.strictEqual(merged.condition, "status = 'APPR'");
        assert.strictEqual(merged.description, 'Release 2');
    });

    it('keeps the retained values of an existing escalation point and ships the rest', () => {
        const payload = new MaximoEscalation(
            Object.assign({}, shipped, {
                escRefPoint: [
                    Object.assign({}, shipped.escRefPoint[0], { elapsedInterval: 4, eventCondition: 'wopriority = 1', _retain: ['elapsedInterval', 'action'] })
                ]
            })
        );
        const snapshot = new MaximoEscalation(
            Object.assign({}, shipped, {
                escRefPoint: [Object.assign({}, shipped.escRefPoint[0], { elapsedInterval: 8, action: 'CUSTOMERACTION' })]
            })
        );

        const point = applyRetainedValues(payload, snapshot).escRefPoint[0];

        assert.strictEqual(point.elapsedInterval, 8);
        assert.strictEqual(point.action, 'CUSTOMERACTION');
        assert.strictEqual(point.eventCondition, 'wopriority = 1');
    });

    it('keeps a nullable point value the customer cleared, since extraction omits a null field', () => {
        const payload = new MaximoEscalation(
            Object.assign({}, shipped, {
                escRefPoint: [
                    Object.assign({}, shipped.escRefPoint[0], {
                        eventCondition: 'wopriority = 1',
                        _retain: ['eventCondition', 'elapsedInterval', 'intervalUom']
                    })
                ]
            })
        );
        const cleared = { refPointNum: 1, eventAttribute: 'REPORTDATE', action: 'EXAMPLEACTION' };
        const snapshot = new MaximoEscalation(Object.assign({}, shipped, { escRefPoint: [cleared] }));

        const point = applyRetainedValues(payload, snapshot).escRefPoint[0];

        assert.strictEqual(point.eventCondition, undefined);
        assert.strictEqual(point.elapsedInterval, undefined);
        assert.strictEqual(point.intervalUom, undefined);
        assert.strictEqual(point.eventAttribute, 'REPORTDATE');
    });

    it('keeps the points the customer added only when the escalation retains escRefPoint', () => {
        const snapshot = new MaximoEscalation(
            Object.assign({}, shipped, {
                escRefPoint: shipped.escRefPoint.concat([{ refPointNum: 2, eventAttribute: 'TARGSTARTDATE', elapsedInterval: 1, intervalUom: 'DAYS' }])
            })
        );

        const retained = applyRetainedValues(new MaximoEscalation(Object.assign({}, shipped, { _retain: ['escRefPoint'] })), snapshot);
        assert.deepStrictEqual(pointsOf(retained), [1, 2]);
        assert.ok(retained.escRefPoint.every((row) => row instanceof MaximoEscalationRefPoint));
        assert.deepStrictEqual(retained.escRefPoint[1].escNotification, []);

        const notRetained = applyRetainedValues(new MaximoEscalation(Object.assign({}, shipped, { _retain: ['schedule'] })), snapshot);
        assert.deepStrictEqual(pointsOf(notRetained), [1]);
    });

    it('keeps the notifications the customer added only when the point retains escNotification', () => {
        const snapshot = new MaximoEscalation(
            Object.assign({}, shipped, {
                escRefPoint: [Object.assign({}, shipped.escRefPoint[0], { escNotification: [{ templateId: 'EXAMPLETPL' }, { templateId: 'CUSTOMERTPL' }] })]
            })
        );
        const withPointRetain = (retain) =>
            new MaximoEscalation(Object.assign({}, shipped, { escRefPoint: [Object.assign({}, shipped.escRefPoint[0], { _retain: retain })] }));

        const retained = applyRetainedValues(withPointRetain(['escNotification']), snapshot);
        assert.deepStrictEqual(
            retained.escRefPoint[0].escNotification.map((row) => row.templateId),
            ['EXAMPLETPL', 'CUSTOMERTPL']
        );

        const notRetained = applyRetainedValues(withPointRetain(['repeat']), snapshot);
        assert.deepStrictEqual(
            notRetained.escRefPoint[0].escNotification.map((row) => row.templateId),
            ['EXAMPLETPL']
        );
    });

    it('carries a retained calendar the customer cleared, which extract omits', () => {
        const payload = new MaximoEscalation(Object.assign({}, shipped, { escCalendar: 'DAY', _retain: ['escCalendar'] }));
        const extracted = Object.assign({}, shipped);

        assert.strictEqual(applyRetainedValues(payload, new MaximoEscalation(extracted)).escCalendar, null);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoEscalation(
            Object.assign({}, shipped, {
                _retain: ['active', 'escRefPoint'],
                escRefPoint: [
                    Object.assign({}, shipped.escRefPoint[0], { calcCalendar: 'DAY', calcShift: 'DAY', calcOrgId: 'EAGLENA', _retain: ['escNotification'] })
                ]
            })
        );
        assert.deepStrictEqual(new MaximoEscalation(once), once);
    });
});

describe('object model meets the adopter contract', () => {
    const shipped = {
        object: 'EXAMPLEOBJ',
        description: 'Release 1',
        service: 'CUSTAPP',
        attributes: [
            { attribute: 'EXAMPLEID', description: 'Identifier', title: 'Id', type: 'BIGINT', length: 19, required: true },
            { attribute: 'NOTE', description: 'Note', title: 'Note', type: 'ALN', length: 50 }
        ],
        relationships: [{ relationship: 'EXAMPLEWO', child: 'WORKORDER', whereClause: 'wonum = :wonum' }]
    };

    it('declares the object, attribute and relationship names as natural keys', () => {
        assert.deepStrictEqual(MaximoObject._keys, ['object']);
        assert.deepStrictEqual(MaximoAttribute._keys, ['attribute']);
        assert.deepStrictEqual(Relationship._keys, ['relationship']);
    });

    it('upper cases the names, as Maximo stores them, so a lower case payload has the same identity', () => {
        const object = new MaximoObject({
            object: 'exampleObj',
            attributes: [{ attribute: 'note' }],
            relationships: [{ relationship: 'exampleWo', child: 'WORKORDER' }]
        });

        assert.strictEqual(retainIdentityOf(object), 'EXAMPLEOBJ');
        assert.strictEqual(object.attributes[0].attribute, 'NOTE');
        assert.strictEqual(object.relationships[0].relationship, 'EXAMPLEWO');
    });

    it('rejects an object without a name, which would otherwise share one snapshot with every other', () => {
        assert.throws(() => new MaximoObject({ description: 'No name' }), /missing key "object"/);
    });

    it('keeps the retained values of the existing object, its attributes and relationships, and ships everything else', () => {
        const payload = new MaximoObject({
            object: 'exampleobj',
            description: 'Release 2',
            service: 'CUSTAPP2',
            _retain: ['description'],
            attributes: [
                { attribute: 'note', description: 'Note 2', title: 'Note 2', type: 'ALN', length: 60, _retain: ['length', 'title'] },
                { attribute: 'NEWATTR', description: 'New', title: 'New', type: 'ALN', length: 10, _retain: ['length'] }
            ],
            relationships: [
                { relationship: 'examplewo', child: 'WORKORDER', whereClause: 'wonum = :wonum and 1=1', remarks: 'Release 2', _retain: ['whereClause'] }
            ]
        });
        const snapshot = new MaximoObject(
            Object.assign({}, shipped, {
                description: 'Customer',
                attributes: [shipped.attributes[0], Object.assign({}, shipped.attributes[1], { length: 200, title: 'Customer note' })],
                relationships: [Object.assign({}, shipped.relationships[0], { whereClause: 'customer = 1' })]
            })
        );

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.description, 'Customer');
        assert.strictEqual(merged.service, 'CUSTAPP2');
        assert.deepStrictEqual(
            merged.attributes.map((row) => [row.attribute, row.length, row.title, row.description]),
            [
                ['NOTE', 200, 'Customer note', 'Note 2'],
                ['NEWATTR', 10, 'New', 'New']
            ]
        );
        assert.strictEqual(merged.relationships[0].whereClause, 'customer = 1');
        assert.strictEqual(merged.relationships[0].remarks, 'Release 2');
        assert.ok(merged.attributes.every((row) => row instanceof MaximoAttribute));
    });

    it('never appends the attributes the customer added, since objects deploys only touch the rows they name', () => {
        const snapshot = new MaximoObject(
            Object.assign({}, shipped, { attributes: shipped.attributes.concat([{ attribute: 'CUSTOMERATTR', description: 'C', title: 'C' }]) })
        );

        const merged = applyRetainedValues(new MaximoObject(Object.assign({}, shipped, { _retain: ['description'] })), snapshot);

        assert.deepStrictEqual(
            merged.attributes.map((row) => row.attribute),
            ['EXAMPLEID', 'NOTE']
        );
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoObject(
            Object.assign({}, shipped, {
                _retain: ['description'],
                attributes: [Object.assign({}, shipped.attributes[1], { _retain: ['length'] })],
                indexes: [{ index: 'EXAMPLEOBJ_NDX1', columns: [{ column: 'NOTE', sequence: 1 }] }]
            })
        );
        assert.deepStrictEqual(new MaximoObject(once), once);
    });
});

describe('integration object models meet the adopter contract', () => {
    const io = loadScriptFunctions(
        'resources/naviam.autoscript.library.js',
        [
            'applyRetainedValues',
            'retainIdentityOf',
            'retainInto',
            'retainIsMarker',
            'retainIsCollection',
            'retainKeysOf',
            'retainSameKeyValue',
            'retainSameRow',
            'retainFindRow',
            'retainCollectionNames',
            'applyDefaultTemplateOwner',
            'sortDetails',
            'MaximoIntegrationObject',
            'MaximoIntegrationObjectDetail',
            'MaximoIntegrationObjectColumn',
            'MaximoIntegrationObjectAlias',
            'MaximoObjectApplicationAuth',
            'MaximoSignatureOption',
            'MaximoOSLCAction',
            'MaximoOSLCQuery',
            'MaximoQueryTemplate',
            'MaximoQueryTemplateAttribute',
            'validateIntegrationObjectInput',
            'validateIntegrationObjectDetails',
            'validateSignatureOptions',
            'validateOSLCActions',
            'validateOSLCQueries',
            'validateQueryTemplates',
            'arrayOrEmpty',
            'lowerCase',
            'isMissing',
            'booleanOrDefault',
            'valueOrDefault',
            'requireKeys',
            'rejectDuplicates'
        ],
        {}
    );
    const { MaximoIntegrationObject, MaximoIntegrationObjectDetail, MaximoQueryTemplate, applyRetainedValues, applyDefaultTemplateOwner } = io;

    const shipped = {
        intObjectName: 'EXAMPLEIO',
        description: 'Release 1',
        useWith: 'INTEGRATION',
        maxIntObjDetail: [
            { objectName: 'ASSET', maxIntObjCols: [{ name: 'DESCRIPTION', intObjFldType: 'EXCL' }] },
            { objectName: 'ASSETMETER', parentObjName: 'ASSET', relation: 'ASSETMETER' }
        ],
        sigOption: [{ optionName: 'EXAMPLEOPT', description: 'Shipped option' }],
        osOSLCAction: [{ name: 'EXAMPLEACTION', implType: 'script', scriptName: 'EXAMPLE.SCRIPT', optionName: 'EXAMPLEOPT' }],
        oslcQuery: [{ queryType: 'osclause', clauseName: 'example', description: 'Shipped query', clause: "status = 'OPERATING'" }],
        queryTemplate: [{ templateName: 'EXAMPLETPL', description: 'Shipped template', queryTemplateAttr: [{ selectAttrName: 'assetnum' }] }]
    };

    function build(overrides) {
        return new MaximoIntegrationObject(JSON.parse(JSON.stringify(Object.assign({}, shipped, overrides || {}))));
    }

    function objectsOf(integrationObject) {
        return integrationObject.maxIntObjDetail.map((detail) => detail.objectName);
    }

    it('declares the natural keys agreed with the Maximo unique indexes', () => {
        assert.deepStrictEqual(MaximoIntegrationObject._keys, ['intObjectName']);
        assert.deepStrictEqual(MaximoIntegrationObjectDetail._keys, ['objectName', 'parentObjName', 'relation']);
        assert.deepStrictEqual(io.MaximoIntegrationObjectColumn._keys, ['name', 'intObjFldType']);
        assert.deepStrictEqual(io.MaximoIntegrationObjectAlias._keys, ['name']);
        assert.deepStrictEqual(io.MaximoObjectApplicationAuth._keys, ['context']);
        assert.deepStrictEqual(io.MaximoSignatureOption._keys, ['optionName']);
        assert.deepStrictEqual(io.MaximoOSLCAction._keys, ['name']);
        assert.deepStrictEqual(io.MaximoOSLCQuery._keys, ['queryType', 'app', 'clauseName']);
        assert.deepStrictEqual(MaximoQueryTemplate._keys, ['templateName', 'owner']);
        assert.deepStrictEqual(io.MaximoQueryTemplateAttribute._keys, ['selectAttrName']);
    });

    it('identifies an integration object by its name', () => {
        assert.strictEqual(io.retainIdentityOf(build()), 'EXAMPLEIO');
    });

    it('leaves a template without an owner unowned, so the deployment does not write one', () => {
        assert.strictEqual(build().queryTemplate[0].owner, null);
        assert.strictEqual(build({ queryTemplate: [{ templateName: 'EXAMPLETPL', owner: '' }] }).queryTemplate[0].owner, null);
    });

    it('keeps the retained values at every level and ships everything else', () => {
        const payload = build({
            description: 'Release 2',
            _retain: ['restrictWhere'],
            maxIntObjDetail: [
                { objectName: 'ASSET', excludeByDefault: false, _retain: ['excludeByDefault'] },
                { objectName: 'ASSETMETER', parentObjName: 'ASSET', relation: 'ASSETMETER' }
            ],
            sigOption: [{ optionName: 'EXAMPLEOPT', description: 'Release 2 option', _retain: ['description'] }],
            oslcQuery: [{ queryType: 'osclause', clauseName: 'example', clause: "status = 'ACTIVE'", _retain: ['clause'] }]
        });
        const snapshot = build({
            restrictWhere: "siteid = 'BEDFORD'",
            maxIntObjDetail: [{ objectName: 'ASSET', excludeByDefault: true }, shipped.maxIntObjDetail[1]],
            sigOption: [{ optionName: 'EXAMPLEOPT', description: 'Customer option' }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.description, 'Release 2');
        assert.strictEqual(merged.restrictWhere, "siteid = 'BEDFORD'");
        assert.strictEqual(merged.maxIntObjDetail[0].excludeByDefault, true);
        assert.strictEqual(merged.sigOption[0].description, 'Customer option');
        assert.strictEqual(merged.oslcQuery[0].clause, "status = 'OPERATING'");
        assert.ok(merged instanceof MaximoIntegrationObject);
    });

    it('keeps the columns the customer added when the object retains maxIntObjCols, telling field types apart', () => {
        const withColumns = (retain) =>
            build({
                maxIntObjDetail: [
                    { objectName: 'ASSET', maxIntObjCols: [{ name: 'DESCRIPTION', intObjFldType: 'EXCL' }], _retain: retain },
                    shipped.maxIntObjDetail[1]
                ]
            });
        const snapshot = build({
            maxIntObjDetail: [
                {
                    objectName: 'ASSET',
                    maxIntObjCols: [
                        { name: 'DESCRIPTION', intObjFldType: 'EXCL' },
                        { name: 'DESCRIPTION', intObjFldType: 'INCL' },
                        { name: 'VENDOR', intObjFldType: 'EXCL' }
                    ]
                },
                shipped.maxIntObjDetail[1]
            ]
        });
        const columnsOf = (merged) => merged.maxIntObjDetail[0].maxIntObjCols.map((column) => column.name + ':' + column.intObjFldType);

        assert.deepStrictEqual(columnsOf(applyRetainedValues(withColumns(['maxIntObjCols']), snapshot)), [
            'DESCRIPTION:EXCL',
            'DESCRIPTION:INCL',
            'VENDOR:EXCL'
        ]);
        assert.deepStrictEqual(columnsOf(applyRetainedValues(withColumns(['altKey']), snapshot)), ['DESCRIPTION:EXCL']);
    });

    it('keeps an object the customer added under a shipped parent when the integration object retains maxIntObjDetail', () => {
        const snapshot = build({
            maxIntObjDetail: shipped.maxIntObjDetail.concat([{ objectName: 'ASSETSPEC', parentObjName: 'ASSET', relation: 'ASSETSPEC' }])
        });

        assert.deepStrictEqual(objectsOf(applyRetainedValues(build({ _retain: ['maxIntObjDetail'] }), snapshot)), ['ASSET', 'ASSETMETER', 'ASSETSPEC']);
        assert.deepStrictEqual(objectsOf(applyRetainedValues(build(), snapshot)), ['ASSET', 'ASSETMETER']);
    });

    it('keeps a shipped object the payload no longer ships while it retains maxIntObjDetail, so an added child keeps its parent', () => {
        const snapshot = build({
            maxIntObjDetail: shipped.maxIntObjDetail.concat([{ objectName: 'METERREADING', parentObjName: 'ASSETMETER', relation: 'METERREADING' }])
        });
        const payload = build({ _retain: ['maxIntObjDetail'], maxIntObjDetail: [shipped.maxIntObjDetail[0]] });

        assert.deepStrictEqual(objectsOf(applyRetainedValues(payload, snapshot)), ['ASSET', 'ASSETMETER', 'METERREADING']);
    });

    it('rejects a payload that replaces the top level object while it retains maxIntObjDetail, since the merged structure has two', () => {
        const payload = build({ _retain: ['maxIntObjDetail'], maxIntObjDetail: [{ objectName: 'LOCATIONS' }] });

        assert.throws(() => applyRetainedValues(payload, build()), /more than one top level/);
        assert.deepStrictEqual(objectsOf(applyRetainedValues(build({ maxIntObjDetail: [{ objectName: 'LOCATIONS' }] }), build())), ['LOCATIONS']);
    });

    it('rejects an object whose parent is not one of its objects', () => {
        assert.throws(
            () => build({ maxIntObjDetail: [{ objectName: 'ASSET' }, { objectName: 'METERREADING', parentObjName: 'assetmeter', relation: 'METERREADING' }] }),
            /METERREADING has the parent object assetmeter, which is not one of its objects/
        );
    });

    it('rejects an action whose signature option is not shipped, unless object structure security creates the standard ones', () => {
        const readAction = [{ name: 'READACTION', implType: 'script', scriptName: 'EXAMPLE.SCRIPT', optionName: 'READ' }];

        assert.throws(() => build({ osOSLCAction: readAction }), /READACTION requires the signature option READ/);
        assert.strictEqual(build({ useOSSecurity: true, osOSLCAction: readAction }).osOSLCAction[0].optionName, 'READ');
        assert.strictEqual(build({ osOSLCAction: [{ name: 'OPENACTION', implType: 'script', scriptName: 'EXAMPLE.SCRIPT' }] }).osOSLCAction.length, 1);
    });

    it('rejects a retained action whose signature option is not kept', () => {
        const snapshot = build({
            sigOption: shipped.sigOption.concat([{ optionName: 'CUSTOMEROPT' }]),
            osOSLCAction: shipped.osOSLCAction.concat([{ name: 'CUSTOMERACTION', implType: 'script', scriptName: 'EXAMPLE.SCRIPT', optionName: 'CUSTOMEROPT' }])
        });

        assert.throws(() => applyRetainedValues(build({ _retain: ['osOSLCAction'] }), snapshot), /CUSTOMERACTION requires the signature option CUSTOMEROPT/);
        assert.deepStrictEqual(
            applyRetainedValues(build({ _retain: ['osOSLCAction', 'sigOption'] }), snapshot).osOSLCAction.map((action) => action.name),
            ['EXAMPLEACTION', 'CUSTOMERACTION']
        );
    });

    it('gives an unowned template the default owner, so it matches the template Maximo gave that owner', () => {
        const payload = build({
            _retain: ['queryTemplate'],
            queryTemplate: [
                { templateName: 'EXAMPLETPL', description: 'Release 2', _retain: ['description'] },
                { templateName: 'OWNEDTPL', owner: 'WILSON' }
            ]
        });
        const snapshot = build({
            queryTemplate: [
                { templateName: 'EXAMPLETPL', owner: 'MAXADMIN', description: 'Customer template' },
                { templateName: 'EXAMPLETPL', owner: 'WILSON', description: 'Personal template' },
                { templateName: 'OWNEDTPL', owner: 'WILSON' }
            ]
        });

        applyDefaultTemplateOwner(payload, 'MAXADMIN');
        const merged = applyRetainedValues(payload, snapshot);

        assert.deepStrictEqual(
            merged.queryTemplate.map((template) => [template.templateName, template.owner, template.description]),
            [
                ['EXAMPLETPL', 'MAXADMIN', 'Customer template'],
                ['OWNEDTPL', 'WILSON', ''],
                ['EXAMPLETPL', 'WILSON', 'Personal template']
            ]
        );
    });

    it('sorts the objects by depth, so every parent is added before its children', () => {
        const sorted = build({
            maxIntObjDetail: [
                { objectName: 'METERREADING', parentObjName: 'ASSETMETER', relation: 'METERREADING' },
                { objectName: 'ASSETSPEC', parentObjName: 'ASSET', relation: 'ASSETSPEC' },
                { objectName: 'ASSETMETER', parentObjName: 'ASSET', relation: 'ASSETMETER' },
                { objectName: 'ASSET' }
            ]
        });

        assert.deepStrictEqual(objectsOf(sorted), ['ASSET', 'ASSETSPEC', 'ASSETMETER', 'METERREADING']);
    });

    it('round trips one of its own instances unchanged, flat or not, which is what lets the engine rebuild the tree', () => {
        const nonFlat = build({ _retain: ['maxIntObjDetail', 'queryTemplate'] });
        assert.deepStrictEqual(new MaximoIntegrationObject(nonFlat), nonFlat);

        const flat = build({
            flatSupported: true,
            maxIntObjDetail: [{ objectName: 'ASSET', maxIntObjAlias: [{ name: 'DESCRIPTION', aliasName: 'ASSETDESC', _retain: ['aliasName'] }] }]
        });
        assert.deepStrictEqual(new MaximoIntegrationObject(flat), flat);
    });

    it('rejects a row listed more than once, since the recreated object structure would fail only after the existing one is deleted', () => {
        const build = (extra) => () => new MaximoIntegrationObject(Object.assign({ intObjectName: 'EXAMPLEIO', maxIntObjDetail: [{ objectName: 'ASSET' }] }, extra));
        const asset = (extra) => ({ maxIntObjDetail: [Object.assign({ objectName: 'ASSET' }, extra)] });

        assert.throws(
            build({ maxIntObjDetail: [{ objectName: 'ASSET' }, { objectName: 'ASSETMETER', parentObjName: 'ASSET', relation: 'ASSETMETER' }, { objectName: 'ASSETMETER', parentObjName: 'ASSET', relation: 'ASSETMETER' }] }),
            /Integration object EXAMPLEIO lists the object ASSETMETER ASSET ASSETMETER more than once/
        );
        assert.throws(
            build(asset({ maxIntObjCols: [{ name: 'DESCRIPTION', intObjFldType: 'EXCL' }, { name: 'DESCRIPTION', intObjFldType: 'EXCL' }] })),
            /Integration object EXAMPLEIO object ASSET lists the column DESCRIPTION EXCL more than once/
        );
        assert.doesNotThrow(build(asset({ maxIntObjCols: [{ name: 'DESCRIPTION', intObjFldType: 'EXCL' }, { name: 'DESCRIPTION', intObjFldType: 'INCL' }] })));
        assert.throws(
            build(Object.assign({ flatSupported: true }, asset({ maxIntObjAlias: [{ name: 'DESCRIPTION', aliasName: 'A' }, { name: 'DESCRIPTION', aliasName: 'B' }] }))),
            /Integration object EXAMPLEIO object ASSET lists the alias DESCRIPTION more than once/
        );
        assert.throws(
            build({ osOSLCAction: [{ name: 'GO', implType: 'system', systemName: 'X' }, { name: 'GO', implType: 'system', systemName: 'Y' }] }),
            /Integration object EXAMPLEIO lists the OSLC action GO more than once/
        );
        assert.throws(build({ queryTemplate: [{ templateName: 'T' }, { templateName: 'T' }] }), /Integration object EXAMPLEIO lists the query template T more than once/);
        assert.doesNotThrow(build({ queryTemplate: [{ templateName: 'T', owner: 'A' }, { templateName: 'T', owner: 'B' }] }));
    });
});

describe('publish channel models meet the adopter contract', () => {
    const pc = loadScriptFunctions(
        'resources/naviam.autoscript.library.js',
        [
            'applyRetainedValues',
            'retainIdentityOf',
            'retainInto',
            'retainIsMarker',
            'retainIsCollection',
            'retainKeysOf',
            'retainSameKeyValue',
            'retainSameRow',
            'retainFindRow',
            'retainCollectionNames',
            'MaximoPublishChannel',
            'MaximoIntegrationControl',
            'MaximoProcessingRule',
            'MaximoProcessingRuleCondition',
            'MaximoProcessingRuleConditionDetail',
            'MaximoProcessingRuleField',
            'MaximoProcessingRuleColumn',
            'MaximoIntegrationObject',
            'MaximoIntegrationObjectDetail',
            'MaximoIntegrationObjectColumn',
            'MaximoIntegrationObjectAlias',
            'MaximoObjectApplicationAuth',
            'MaximoSignatureOption',
            'MaximoOSLCAction',
            'MaximoOSLCQuery',
            'MaximoQueryTemplate',
            'MaximoQueryTemplateAttribute',
            'validateIntegrationObjectInput',
            'validateIntegrationObjectDetails',
            'validateSignatureOptions',
            'validateOSLCActions',
            'validateOSLCQueries',
            'validateQueryTemplates',
            'sortDetails',
            'lowerCase',
            'isMissing',
            'booleanOrDefault',
            'arrayOrEmpty',
            'valueOrDefault',
            'requireKeys',
            'rejectDuplicates'
        ],
        {}
    );
    const {
        MaximoPublishChannel,
        MaximoIntegrationControl,
        MaximoProcessingRule,
        MaximoProcessingRuleCondition,
        MaximoProcessingRuleConditionDetail,
        MaximoProcessingRuleField,
        MaximoProcessingRuleColumn,
        MaximoIntegrationObject,
        applyRetainedValues
    } = pc;

    const shipped = {
        ifaceName: 'EXAMPLEPC',
        description: 'Release 1',
        intObjectName: 'MXASSET',
        publishJson: true,
        integrationControls: [{ control: 'EXAMPLECNTL' }],
        processingRules: [
            {
                procName: 'SKIPDECOM',
                action: 'SKIP',
                objectName: 'ASSET',
                hierarchyPath: 'ASSET',
                enabled: true,
                conditions: [
                    {
                        condition: 10,
                        details: [
                            {
                                condSequence: 1,
                                condType: 'FIELD',
                                evalType: 'EQUALS',
                                changeType: 'ALWAYS',
                                compareType: 'VALUE',
                                columnName: 'STATUS',
                                value: 'DECOMMISSIONED'
                            }
                        ]
                    }
                ],
                fields: [{ fieldName: 'DESCRIPTION', replaceNull: false, valueType: 'VALUE', value: 'X' }],
                columns: [{ fieldName: 'ASSETNUM' }]
            }
        ]
    };

    it('declares the natural keys every level is looked up by', () => {
        assert.deepStrictEqual(MaximoPublishChannel._keys, ['ifaceName']);
        assert.deepStrictEqual(MaximoIntegrationControl._keys, ['control']);
        assert.deepStrictEqual(MaximoProcessingRule._keys, ['procName']);
        assert.deepStrictEqual(MaximoProcessingRuleCondition._keys, ['condition']);
        assert.deepStrictEqual(MaximoProcessingRuleConditionDetail._keys, ['condSequence', 'condType']);
        assert.deepStrictEqual(MaximoProcessingRuleField._keys, ['fieldName', 'replaceNull']);
        assert.deepStrictEqual(MaximoProcessingRuleColumn._keys, ['fieldName']);
    });

    it('keeps the retained values of the existing channel and rule and ships everything else', () => {
        const payload = new MaximoPublishChannel(
            Object.assign({}, shipped, {
                _retain: ['description', 'listener'],
                processingRules: [Object.assign({}, shipped.processingRules[0], { _retain: ['enabled'] })]
            })
        );
        const snapshot = new MaximoPublishChannel({
            ifaceName: 'EXAMPLEPC',
            description: 'Customer description',
            intObjectName: 'MXASSET',
            listener: true,
            publishJson: false,
            processingRules: [{ procName: 'SKIPDECOM', action: 'SKIP', objectName: 'ASSET', enabled: false }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.description, 'Customer description');
        assert.strictEqual(merged.listener, true);
        assert.strictEqual(merged.publishJson, true);
        assert.strictEqual(merged.processingRules[0].enabled, false);
        assert.strictEqual(merged.processingRules[0].conditions[0].details[0].value, 'DECOMMISSIONED');
    });

    it('appends the rules and controls the customer added when the collection is retained', () => {
        const payload = new MaximoPublishChannel(Object.assign({}, shipped, { _retain: ['processingRules', 'integrationControls'] }));
        const snapshot = new MaximoPublishChannel({
            ifaceName: 'EXAMPLEPC',
            intObjectName: 'MXASSET',
            integrationControls: [{ control: 'CUSTOMERCNTL' }],
            processingRules: [{ procName: 'CUSTOMER', action: 'STOP', objectName: 'ASSET' }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.deepStrictEqual(
            merged.processingRules.map((rule) => rule.procName),
            ['SKIPDECOM', 'CUSTOMER']
        );
        assert.deepStrictEqual(
            merged.integrationControls.map((control) => control.control),
            ['EXAMPLECNTL', 'CUSTOMERCNTL']
        );
        assert.ok(merged.processingRules[1] instanceof MaximoProcessingRule);
    });

    it('leaves the optional values the payload omits undefined, so the recreated channel takes the Maximo defaults', () => {
        const channel = new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC', intObjectName: 'MXASSET', processingRules: [{ procName: 'RULE', action: 'SKIP' }] });

        assert.strictEqual(channel.description, undefined);
        assert.strictEqual(channel.listener, undefined);
        assert.strictEqual(channel.retainMbos, undefined);
        assert.strictEqual(channel.templateName, undefined);
        assert.strictEqual(channel.processingRules[0].enabled, undefined);
        assert.strictEqual(channel.processingRules[0].description, undefined);
        assert.deepStrictEqual(channel.integrationControls, []);
        assert.deepStrictEqual(channel.processingRules[0].conditions, []);
    });

    it('defaults the condition and detail keys to the values Maximo assigns', () => {
        const condition = new MaximoProcessingRuleCondition({ details: [{ condType: 'FIELD' }] });

        assert.strictEqual(condition.condition, 10);
        assert.strictEqual(condition.details[0].condSequence, 1);
    });

    it('rejects a rule without an action', () => {
        assert.throws(() => new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC', intObjectName: 'MXASSET', processingRules: [{ procName: 'RULE' }] }), /action/);
    });

    it('rejects a channel without an object structure unless it is deleted', () => {
        assert.throws(() => new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC' }), /needs an intObjectName or an objectStructure/);
        assert.doesNotThrow(() => new MaximoPublishChannel({ _delete: true, ifaceName: 'EXAMPLEPC' }));
    });

    it('rejects an integration control listed more than once', () => {
        assert.throws(
            () => new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC', intObjectName: 'MXASSET', integrationControls: [{ control: 'C' }, { control: 'C' }] }),
            /lists the integration control C more than once/
        );
    });

    it('rejects a processing rule listed more than once', () => {
        assert.throws(
            () =>
                new MaximoPublishChannel({
                    ifaceName: 'EXAMPLEPC',
                    intObjectName: 'MXASSET',
                    processingRules: [
                        { procName: 'R', action: 'SKIP' },
                        { procName: 'R', action: 'STOP' }
                    ]
                }),
            /Publish channel EXAMPLEPC lists the processing rule R more than once/
        );
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoPublishChannel(Object.assign({}, shipped, { _retain: ['description'] }));
        assert.deepStrictEqual(new MaximoPublishChannel(once), once);
    });

    const embedded = { ifaceName: 'EXAMPLEPC', objectStructure: { intObjectName: 'EXAMPLEIO', maxIntObjDetail: [{ objectName: 'ASSET' }] } };

    it('builds an embedded object structure as an integration object that survives the rebuild', () => {
        const channel = applyRetainedValues(new MaximoPublishChannel(Object.assign({}, embedded, { _retain: ['description'] })), { description: 'Customer' });

        assert.ok(channel.objectStructure instanceof MaximoIntegrationObject);
        assert.strictEqual(channel.objectStructure.intObjectName, 'EXAMPLEIO');
        assert.strictEqual(channel.objectStructure._delete, false);
        assert.strictEqual(channel.description, 'Customer');
    });

    it('takes the intObjectName from the embedded object structure, so a retained intObjectName reads it from a snapshot', () => {
        const snapshot = new MaximoPublishChannel(embedded);
        assert.strictEqual(snapshot.intObjectName, 'EXAMPLEIO');

        const channel = applyRetainedValues(new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC', intObjectName: 'MXASSET', _retain: ['intObjectName'] }), snapshot);
        assert.strictEqual(channel.intObjectName, 'EXAMPLEIO');
    });

    it('rejects an intObjectName that differs from the embedded object structure', () => {
        assert.doesNotThrow(() => new MaximoPublishChannel(Object.assign({}, embedded, { intObjectName: 'EXAMPLEIO' })));
        assert.throws(() => new MaximoPublishChannel(Object.assign({}, embedded, { intObjectName: 'MXASSET' })), /does not match its objectStructure/);
    });

    it('builds the embedded object structure of a deleted channel as given, so it is only unlinked', () => {
        const channel = new MaximoPublishChannel(Object.assign({}, embedded, { _delete: true }));

        assert.strictEqual(channel.objectStructure._delete, false);
        assert.strictEqual(channel.intObjectName, 'EXAMPLEIO');
    });

    it('needs only the intObjectName of an embedded object structure marked _delete', () => {
        const channel = new MaximoPublishChannel({ _delete: true, ifaceName: embedded.ifaceName, objectStructure: { _delete: true, intObjectName: 'EXAMPLEIO' } });

        assert.strictEqual(channel.objectStructure._delete, true);
        assert.strictEqual(channel.intObjectName, 'EXAMPLEIO');
        assert.doesNotThrow(() => new MaximoPublishChannel({ ifaceName: embedded.ifaceName, objectStructure: { _delete: true, intObjectName: 'EXAMPLEIO' } }));
    });

    it('accepts aliases on an object structure without flat support, as Maximo stores them for MXASSET', () => {
        const objectStructure = {
            intObjectName: 'EXAMPLEIO',
            maxIntObjDetail: [{ objectName: 'ASSET', maxIntObjAlias: [{ name: 'ASSETNUM', aliasName: 'ASSETID' }] }]
        };

        assert.doesNotThrow(() => new MaximoPublishChannel({ ifaceName: 'EXAMPLEPC', objectStructure }));
    });
});

describe('enterprise service models meet the adopter contract', () => {
    const es = loadScriptFunctions(
        'resources/naviam.autoscript.library.js',
        [
            'applyRetainedValues',
            'retainIdentityOf',
            'retainInto',
            'retainIsMarker',
            'retainIsCollection',
            'retainKeysOf',
            'retainSameKeyValue',
            'retainSameRow',
            'retainFindRow',
            'retainCollectionNames',
            'MaximoEnterpriseService',
            'MaximoIntegrationControl',
            'MaximoEnterpriseServiceObjectStructure',
            'MaximoEnterpriseServiceGatewayProperty',
            'MaximoProcessingRule',
            'MaximoProcessingRuleCondition',
            'MaximoProcessingRuleConditionDetail',
            'MaximoProcessingRuleField',
            'MaximoProcessingRuleColumn',
            'MaximoIntegrationObject',
            'MaximoIntegrationObjectDetail',
            'MaximoIntegrationObjectColumn',
            'MaximoIntegrationObjectAlias',
            'MaximoObjectApplicationAuth',
            'MaximoSignatureOption',
            'MaximoOSLCAction',
            'MaximoOSLCQuery',
            'MaximoQueryTemplate',
            'MaximoQueryTemplateAttribute',
            'validateIntegrationObjectInput',
            'validateIntegrationObjectDetails',
            'validateSignatureOptions',
            'validateOSLCActions',
            'validateOSLCQueries',
            'validateQueryTemplates',
            'sortDetails',
            'lowerCase',
            'isMissing',
            'booleanOrDefault',
            'arrayOrEmpty',
            'valueOrDefault',
            'requireKeys',
            'rejectDuplicates'
        ],
        {}
    );
    const {
        MaximoEnterpriseService,
        MaximoIntegrationControl,
        MaximoEnterpriseServiceObjectStructure,
        MaximoEnterpriseServiceGatewayProperty,
        MaximoProcessingRule,
        MaximoIntegrationObject,
        applyRetainedValues
    } = es;

    const shipped = {
        ifaceName: 'EXAMPLEES',
        description: 'Release 1',
        intObjectName: 'MXASSET',
        useExternalSchema: true,
        splitTag: 'ASSET',
        interpreterClass: 'com.example.Interpreter',
        integrationControls: [{ control: 'EXAMPLECNTL' }],
        additionalObjectStructures: [{ intObjectName: 'MXOPERLOC', ifaceMapOrder: 1 }],
        gatewayProperties: [{ param: 'ROOT', value: 'ASSET', isXmlTag: true }],
        processingRules: [{ procName: 'SKIPDECOM', action: 'SKIP', objectName: 'ASSET', enabled: true }],
        objectProcessingRules: [{ procName: 'SETDESC', action: 'SET', objectName: 'ASSET', fields: [{ fieldName: 'DESCRIPTION', valueType: 'VALUE', value: 'X' }] }]
    };

    it('declares the natural keys every level is looked up by', () => {
        assert.deepStrictEqual(MaximoEnterpriseService._keys, ['ifaceName']);
        assert.deepStrictEqual(MaximoIntegrationControl._keys, ['control']);
        assert.deepStrictEqual(MaximoEnterpriseServiceObjectStructure._keys, ['intObjectName']);
        assert.deepStrictEqual(MaximoEnterpriseServiceGatewayProperty._keys, ['param']);
    });

    it('builds both kinds of processing rules as processing rules', () => {
        const service = new MaximoEnterpriseService(shipped);

        assert.ok(service.processingRules[0] instanceof MaximoProcessingRule);
        assert.ok(service.objectProcessingRules[0] instanceof MaximoProcessingRule);
        assert.strictEqual(service.objectProcessingRules[0].fields[0].value, 'X');
    });

    it('keeps the retained values of the existing service and its rows and ships everything else', () => {
        const payload = new MaximoEnterpriseService(
            Object.assign({}, shipped, {
                _retain: ['description', 'storeMsg'],
                gatewayProperties: [{ param: 'ROOT', value: 'ASSET', isXmlTag: true, _retain: ['value'] }],
                objectProcessingRules: [Object.assign({}, shipped.objectProcessingRules[0], { _retain: ['enabled'] })]
            })
        );
        const snapshot = new MaximoEnterpriseService({
            ifaceName: 'EXAMPLEES',
            description: 'Customer description',
            intObjectName: 'MXASSET',
            storeMsg: true,
            gatewayProperties: [{ param: 'ROOT', value: 'CUSTOMER' }],
            objectProcessingRules: [{ procName: 'SETDESC', action: 'SET', enabled: false }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.description, 'Customer description');
        assert.strictEqual(merged.storeMsg, true);
        assert.strictEqual(merged.splitTag, 'ASSET');
        assert.strictEqual(merged.interpreterClass, 'com.example.Interpreter');
        assert.strictEqual(merged.gatewayProperties[0].value, 'CUSTOMER');
        assert.strictEqual(merged.gatewayProperties[0].isXmlTag, true);
        assert.strictEqual(merged.objectProcessingRules[0].enabled, false);
    });

    it('appends the rows the customer added when a collection is retained', () => {
        const payload = new MaximoEnterpriseService(
            Object.assign({}, shipped, { _retain: ['integrationControls', 'additionalObjectStructures', 'gatewayProperties', 'processingRules', 'objectProcessingRules'] })
        );
        const snapshot = new MaximoEnterpriseService({
            ifaceName: 'EXAMPLEES',
            intObjectName: 'MXASSET',
            integrationControls: [{ control: 'CUSTOMERCNTL' }],
            additionalObjectStructures: [{ intObjectName: 'MXPERSON', ifaceMapOrder: 2 }],
            gatewayProperties: [{ param: 'CUSTOMER', value: 'Y' }],
            processingRules: [{ procName: 'CUSTOMER', action: 'STOP' }],
            objectProcessingRules: [{ procName: 'CUSTOMEROBJ', action: 'SKIP' }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.deepStrictEqual(merged.integrationControls.map((row) => row.control), ['EXAMPLECNTL', 'CUSTOMERCNTL']);
        assert.deepStrictEqual(merged.additionalObjectStructures.map((row) => row.intObjectName), ['MXOPERLOC', 'MXPERSON']);
        assert.deepStrictEqual(merged.gatewayProperties.map((row) => row.param), ['ROOT', 'CUSTOMER']);
        assert.deepStrictEqual(merged.processingRules.map((rule) => rule.procName), ['SKIPDECOM', 'CUSTOMER']);
        assert.deepStrictEqual(merged.objectProcessingRules.map((rule) => rule.procName), ['SETDESC', 'CUSTOMEROBJ']);
    });

    it('leaves the optional values the payload omits undefined, so the recreated service takes the Maximo defaults', () => {
        const service = new MaximoEnterpriseService({ ifaceName: 'EXAMPLEES', intObjectName: 'MXASSET', gatewayProperties: [{ param: 'ROOT' }] });

        assert.strictEqual(service.description, undefined);
        assert.strictEqual(service.messageType, undefined);
        assert.strictEqual(service.ifaceType, undefined);
        assert.strictEqual(service.useExternalSchema, undefined);
        assert.strictEqual(service.gatewayProperties[0].isXmlTag, undefined);
        assert.deepStrictEqual(service.integrationControls, []);
        assert.deepStrictEqual(service.additionalObjectStructures, []);
        assert.deepStrictEqual(service.processingRules, []);
        assert.deepStrictEqual(service.objectProcessingRules, []);
    });

    it('rejects a service without an object structure unless it is deleted', () => {
        assert.throws(() => new MaximoEnterpriseService({ ifaceName: 'EXAMPLEES' }), /needs an intObjectName or an objectStructure/);
        assert.doesNotThrow(() => new MaximoEnterpriseService({ _delete: true, ifaceName: 'EXAMPLEES' }));
    });

    it('rejects a row listed more than once', () => {
        const build = (extra) => () => new MaximoEnterpriseService(Object.assign({ ifaceName: 'EXAMPLEES', intObjectName: 'MXASSET' }, extra));

        assert.throws(build({ integrationControls: [{ control: 'C' }, { control: 'C' }] }), /lists the integration control C more than once/);
        assert.throws(
            build({ additionalObjectStructures: [{ intObjectName: 'MXPERSON' }, { intObjectName: 'MXPERSON' }] }),
            /lists the additional object structure MXPERSON more than once/
        );
        assert.throws(build({ gatewayProperties: [{ param: 'P' }, { param: 'P' }] }), /lists the gateway property P more than once/);
        assert.throws(
            build({ processingRules: [{ procName: 'R', action: 'SKIP' }, { procName: 'R', action: 'STOP' }] }),
            /Enterprise service EXAMPLEES lists the processing rule R more than once/
        );
        assert.throws(
            build({ objectProcessingRules: [{ procName: 'R', action: 'SKIP' }, { procName: 'R', action: 'STOP' }] }),
            /Enterprise service EXAMPLEES lists the object processing rule R more than once/
        );
        assert.doesNotThrow(build({ processingRules: [{ procName: 'R', action: 'SKIP' }], objectProcessingRules: [{ procName: 'R', action: 'SKIP' }] }));
    });

    it('rejects a row without its key', () => {
        assert.throws(() => new MaximoEnterpriseService({ ifaceName: 'EXAMPLEES', intObjectName: 'MXASSET', gatewayProperties: [{ value: 'V' }] }), /param/);
        assert.throws(
            () => new MaximoEnterpriseService({ ifaceName: 'EXAMPLEES', intObjectName: 'MXASSET', additionalObjectStructures: [{ ifaceMapOrder: 1 }] }),
            /intObjectName/
        );
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoEnterpriseService(Object.assign({}, shipped, { _retain: ['description'] }));
        assert.deepStrictEqual(new MaximoEnterpriseService(once), once);
    });

    const embedded = { ifaceName: 'EXAMPLEES', objectStructure: { intObjectName: 'EXAMPLEIO', maxIntObjDetail: [{ objectName: 'ASSET' }] } };

    it('builds an embedded object structure as an integration object and takes its name', () => {
        const service = applyRetainedValues(new MaximoEnterpriseService(Object.assign({}, embedded, { _retain: ['description'] })), { description: 'Customer' });

        assert.ok(service.objectStructure instanceof MaximoIntegrationObject);
        assert.strictEqual(service.intObjectName, 'EXAMPLEIO');
        assert.strictEqual(service.objectStructure._delete, false);
        assert.strictEqual(service.description, 'Customer');
    });

    it('rejects an intObjectName that differs from the embedded object structure', () => {
        assert.doesNotThrow(() => new MaximoEnterpriseService(Object.assign({}, embedded, { intObjectName: 'EXAMPLEIO' })));
        assert.throws(() => new MaximoEnterpriseService(Object.assign({}, embedded, { intObjectName: 'MXASSET' })), /does not match its objectStructure/);
    });

    it('builds the embedded object structure of a deleted service as given, so it is only unlinked', () => {
        const service = new MaximoEnterpriseService(Object.assign({}, embedded, { _delete: true }));

        assert.strictEqual(service.objectStructure._delete, false);
        assert.strictEqual(service.intObjectName, 'EXAMPLEIO');
    });

    it('needs only the intObjectName of an embedded object structure marked _delete', () => {
        const service = new MaximoEnterpriseService({ _delete: true, ifaceName: embedded.ifaceName, objectStructure: { _delete: true, intObjectName: 'EXAMPLEIO' } });

        assert.strictEqual(service.objectStructure._delete, true);
        assert.strictEqual(service.intObjectName, 'EXAMPLEIO');
        assert.doesNotThrow(() => new MaximoEnterpriseService({ ifaceName: embedded.ifaceName, objectStructure: { _delete: true, intObjectName: 'EXAMPLEIO' } }));
    });
});

describe('external system models meet the adopter contract', () => {
    const xs = loadScriptFunctions(
        'resources/naviam.autoscript.library.js',
        [
            'applyRetainedValues',
            'retainIdentityOf',
            'retainInto',
            'retainIsMarker',
            'retainIsCollection',
            'retainKeysOf',
            'retainSameKeyValue',
            'retainSameRow',
            'retainFindRow',
            'retainCollectionNames',
            'MaximoExternalSystem',
            'MaximoExternalSystemPublishChannel',
            'MaximoExternalSystemEnterpriseService',
            'MaximoExternalSystemIntegrationControl',
            'MaximoExternalSystemIntegrationControlOverride',
            'MaximoExternalSystemIntegrationControlListValue',
            'MaximoExternalSystemIntegrationControlCrossReferenceValue',
            'listValuesOf',
            'crossReferenceValuesOf',
            'MaximoPublishChannel',
            'MaximoEnterpriseService',
            'MaximoIntegrationControl',
            'MaximoEnterpriseServiceObjectStructure',
            'MaximoEnterpriseServiceGatewayProperty',
            'MaximoProcessingRule',
            'MaximoProcessingRuleCondition',
            'MaximoProcessingRuleConditionDetail',
            'MaximoProcessingRuleField',
            'MaximoProcessingRuleColumn',
            'MaximoIntegrationObject',
            'MaximoIntegrationObjectDetail',
            'MaximoIntegrationObjectColumn',
            'MaximoIntegrationObjectAlias',
            'MaximoObjectApplicationAuth',
            'MaximoSignatureOption',
            'MaximoOSLCAction',
            'MaximoOSLCQuery',
            'MaximoQueryTemplate',
            'MaximoQueryTemplateAttribute',
            'validateIntegrationObjectInput',
            'validateIntegrationObjectDetails',
            'validateSignatureOptions',
            'validateOSLCActions',
            'validateOSLCQueries',
            'validateQueryTemplates',
            'sortDetails',
            'lowerCase',
            'isMissing',
            'booleanOrDefault',
            'arrayOrEmpty',
            'valueOrDefault',
            'requireKeys',
            'rejectDuplicates'
        ],
        {}
    );
    const {
        MaximoExternalSystem,
        MaximoExternalSystemPublishChannel,
        MaximoExternalSystemEnterpriseService,
        MaximoExternalSystemIntegrationControl,
        MaximoExternalSystemIntegrationControlOverride,
        MaximoPublishChannel,
        MaximoEnterpriseService,
        applyRetainedValues
    } = xs;

    const shipped = {
        extSysName: 'EXAMPLEXS',
        description: 'Release 1',
        endPointName: 'EXAMPLEEP',
        enabled: true,
        publishChannels: [{ publishChannel: { ifaceName: 'EXAMPLEPC', intObjectName: 'MXASSET' }, enabled: true, endPointName: 'EXAMPLEEP' }, { ifaceName: 'MXASSETInterface' }],
        enterpriseServices: [{ enterpriseService: { ifaceName: 'EXAMPLEES', intObjectName: 'MXASSET' }, isContinuousQueue: false }],
        integrationControls: [
            { control: 'EXAMPLEVAL', value: 'A', overrides: [{ orgId: 'EAGLENA', value: 'B' }] },
            { control: 'EXAMPLELIST', listValues: [{ value: 'X' }], overrides: [{ siteId: 'BEDFORD', listValues: [{ value: 'Y' }] }] },
            { control: 'EXAMPLEXREF', crossReferenceValues: [{ value: 'M', newValue: 'E' }, { newValue: 'BLANK' }] }
        ]
    };

    it('declares the natural keys every level is looked up by', () => {
        assert.deepStrictEqual(MaximoExternalSystem._keys, ['extSysName']);
        assert.deepStrictEqual(MaximoExternalSystemPublishChannel._keys, ['ifaceName']);
        assert.deepStrictEqual(MaximoExternalSystemEnterpriseService._keys, ['ifaceName']);
        assert.deepStrictEqual(MaximoExternalSystemIntegrationControl._keys, ['control']);
        assert.deepStrictEqual(MaximoExternalSystemIntegrationControlOverride._keys, ['orgId', 'siteId']);
    });

    it('builds an embedded publish channel or enterprise service with its own model and takes its name', () => {
        const system = new MaximoExternalSystem(shipped);

        assert.ok(system.publishChannels[0].publishChannel instanceof MaximoPublishChannel);
        assert.strictEqual(system.publishChannels[0].ifaceName, 'EXAMPLEPC');
        assert.strictEqual(system.publishChannels[1].publishChannel, undefined);
        assert.strictEqual(system.publishChannels[1].ifaceName, 'MXASSETInterface');
        assert.ok(system.enterpriseServices[0].enterpriseService instanceof MaximoEnterpriseService);
        assert.strictEqual(system.enterpriseServices[0].ifaceName, 'EXAMPLEES');
    });

    it('rejects a link that names nothing', () => {
        assert.throws(() => new MaximoExternalSystemEnterpriseService({ enabled: true }), /ifaceName/);
    });

    it('needs an organization or a site on an override', () => {
        assert.throws(() => new MaximoExternalSystemIntegrationControlOverride({ value: 'A' }), /either an "orgId" or a "siteId"/);
        assert.throws(() => new MaximoExternalSystemIntegrationControlOverride({ orgId: 'EAGLENA', siteId: 'BEDFORD' }), /either an "orgId" or a "siteId"/);
        assert.doesNotThrow(() => new MaximoExternalSystemIntegrationControlOverride({ orgId: 'EAGLENA' }));
        assert.doesNotThrow(() => new MaximoExternalSystemIntegrationControlOverride({ siteId: 'BEDFORD' }));
    });

    it('keeps a cross reference with either side blank', () => {
        const values = new MaximoExternalSystem(shipped).integrationControls[2].crossReferenceValues;

        assert.strictEqual(values[1].value, undefined);
        assert.strictEqual(values[1].newValue, 'BLANK');
    });

    it('rejects a row listed more than once', () => {
        const build = (extra) => () => new MaximoExternalSystem(Object.assign({ extSysName: 'EXAMPLEXS' }, extra));

        assert.throws(build({ publishChannels: [{ ifaceName: 'P' }, { publishChannel: { ifaceName: 'P', intObjectName: 'MXASSET' } }] }), /lists the publish channel P more than once/);
        assert.throws(build({ enterpriseServices: [{ ifaceName: 'S' }, { ifaceName: 'S' }] }), /lists the enterprise service S more than once/);
        assert.throws(build({ integrationControls: [{ control: 'C' }, { control: 'C' }] }), /lists the integration control C more than once/);
        assert.throws(build({ integrationControls: [{ control: 'C', listValues: [{ value: 'X' }, { value: 'X' }] }] }), /lists the list value X more than once/);
        assert.throws(build({ integrationControls: [{ control: 'C', overrides: [{ orgId: 'O' }, { orgId: 'O' }] }] }), /lists the override/);
        assert.doesNotThrow(build({ integrationControls: [{ control: 'C', overrides: [{ orgId: 'O' }, { siteId: 'S' }] }] }));
    });

    it('keeps the retained values of the existing system and its rows and ships everything else', () => {
        const payload = new MaximoExternalSystem(
            Object.assign({}, shipped, {
                _retain: ['endPointName', 'enabled'],
                publishChannels: [Object.assign({}, shipped.publishChannels[0], { _retain: ['enabled'] })],
                integrationControls: [Object.assign({}, shipped.integrationControls[0], { _retain: ['value'] })]
            })
        );
        const snapshot = new MaximoExternalSystem({
            extSysName: 'EXAMPLEXS',
            endPointName: 'CUSTOMEREP',
            enabled: false,
            publishChannels: [{ ifaceName: 'EXAMPLEPC', enabled: false }],
            integrationControls: [{ control: 'EXAMPLEVAL', value: 'CUSTOMER' }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.strictEqual(merged.endPointName, 'CUSTOMEREP');
        assert.strictEqual(merged.enabled, false);
        assert.strictEqual(merged.description, 'Release 1');
        assert.strictEqual(merged.publishChannels[0].enabled, false);
        assert.strictEqual(merged.publishChannels[0].endPointName, 'EXAMPLEEP');
        assert.strictEqual(merged.integrationControls[0].value, 'CUSTOMER');
        assert.strictEqual(merged.integrationControls[0].overrides[0].value, 'B');
    });

    it('appends the rows the customer added when a collection is retained', () => {
        const payload = new MaximoExternalSystem(Object.assign({}, shipped, { _retain: ['publishChannels', 'integrationControls'] }));
        const snapshot = new MaximoExternalSystem({
            extSysName: 'EXAMPLEXS',
            publishChannels: [{ ifaceName: 'CUSTOMERPC' }],
            integrationControls: [{ control: 'CUSTOMERCNTL', value: 'Z' }]
        });

        const merged = applyRetainedValues(payload, snapshot);

        assert.deepStrictEqual(merged.publishChannels.map((row) => row.ifaceName), ['EXAMPLEPC', 'MXASSETInterface', 'CUSTOMERPC']);
        assert.deepStrictEqual(merged.integrationControls.map((row) => row.control), ['EXAMPLEVAL', 'EXAMPLELIST', 'EXAMPLEXREF', 'CUSTOMERCNTL']);
    });

    it('leaves the optional values the payload omits undefined, so the recreated system takes the Maximo defaults', () => {
        const system = new MaximoExternalSystem({ extSysName: 'EXAMPLEXS', publishChannels: [{ ifaceName: 'P' }] });

        assert.strictEqual(system.langCode, undefined);
        assert.strictEqual(system.enabled, undefined);
        assert.strictEqual(system.publishChannels[0].enabled, undefined);
        assert.strictEqual(system.publishChannels[0].isContinuousQueue, undefined);
        assert.deepStrictEqual(system.enterpriseServices, []);
        assert.deepStrictEqual(system.integrationControls, []);
    });

    it('round trips one of its own instances unchanged, which is what lets the engine rebuild the tree', () => {
        const once = new MaximoExternalSystem(Object.assign({}, shipped, { _retain: ['description'] }));
        assert.deepStrictEqual(new MaximoExternalSystem(once), once);
    });
});

