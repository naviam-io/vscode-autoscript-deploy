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
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { loadScriptFunctions } = require('../harness');

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
    MaximoDomainValueCondition
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
        'valueOrDefault'
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

    it('retains a falsy value, because an emptied field is still the customer\'s choice', () => {
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
 * is covered above: the bundle mangles the binding each model uses to construct its children, so a
 * cron task built here can only carry empty collections.
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
