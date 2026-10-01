/*
 * Guards the one place the retain contract is stated twice.
 *
 *   npm run test:unit
 *
 * The deployment JSON schema lists which properties a payload author may name in "_retain". It gives
 * editor completion, and with server side validation gone it is the only gate before the deployment
 * itself. The properties it offers are defined by the model classes in the Nashorn library, which
 * sit on the far side of the REST boundary in a separate repository, so the two cannot share a
 * definition. This test makes drift between them impossible instead: a property renamed in a model
 * class, or offered by the schema but never defined, fails here rather than at deploy time.
 *
 * A configuration type added later is covered by adding it to RETAIN_CONTRACTS below.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const schema = require('../../../schemas/deploy-schema.json');
const { loadScriptFunctions } = require('../harness');

const models = loadScriptFunctions(
    'resources/naviam.autoscript.library.js',
    [
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
        'valueOrDefault'
    ],
    {}
);

/*
 * Each level names the schema node describing an object and the model class that produces it. The
 * collection is the property of the parent level that carries the child rows. A configuration type
 * whose children hang off several collections contributes one entry per branch, so that every
 * schema node is reached exactly once and its assertions are named for the branch they came from.
 */
const RETAIN_CONTRACTS = [
    {
        definition: 'cronTask',
        levels: [
            { label: 'cronTask', model: models.MaximoCronTask },
            { label: 'cronTaskInstance', collection: 'cronTaskInstance', model: models.MaximoCronTaskInstance },
            { label: 'cronTaskParam', collection: 'cronTaskParam', model: models.MaximoCronTaskParam }
        ]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain', model: models.MaximoDomain }]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain.alnDomain', collection: 'alnDomain', model: models.MaximoDiscreteDomainValue }]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain.numericDomain', collection: 'numericDomain', model: models.MaximoDiscreteDomainValue }]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain.numRangeDomain', collection: 'numRangeDomain', model: models.MaximoNumRangeDomainValue }]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain.synonymDomain', collection: 'synonymDomain', model: models.MaximoSynonymDomainValue }]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain.tableDomain', collection: 'tableDomain', model: models.MaximoTableDomainValue }]
    },
    {
        definition: 'domain',
        levels: [
            { label: 'domain.crossoverDomain', collection: 'crossoverDomain', model: models.MaximoCrossoverDomainValue },
            { label: 'domain.crossoverDomain.crossoverFields', collection: 'crossoverFields', model: models.MaximoCrossoverField }
        ]
    }
];

function schemaNodesOf(contract) {
    let node = schema.definitions[contract.definition];
    assert.ok(node, 'schema has no definition named ' + contract.definition);

    return contract.levels.map((level) => {
        if (level.collection) {
            const collection = node.properties[level.collection];
            assert.ok(collection, 'schema has no property named ' + level.collection);
            assert.ok(collection.items, level.collection + ' is not an array of objects in the schema');
            node = collection.items;
        }

        return { label: level.label, model: level.model, schema: node };
    });
}

/*
 * The properties a model class defines, which is what a payload may legitimately ask to retain. The
 * markers are excluded because they are engine instructions rather than record data.
 */
function propertiesOf(model) {
    return Object.keys(new model({})).filter((name) => name.charAt(0) !== '_');
}

describe('retain schema consistency', () => {
    RETAIN_CONTRACTS.forEach((contract) => {
        schemaNodesOf(contract).forEach(({ label, model, schema: node }) => {
            const declared = node.properties._retain;

            it(label + ' offers retainable properties at all', () => {
                assert.ok(declared, label + ' is missing _retain in the schema');
                assert.ok(Array.isArray(declared.items.enum) && declared.items.enum.length > 0, label + ' offers no retainable property');
            });

            it(label + ' offers no retainable property the schema does not define', () => {
                declared.items.enum.forEach((name) => {
                    assert.ok(
                        Object.prototype.hasOwnProperty.call(node.properties, name),
                        label + ' offers ' + name + ' as retainable but does not define it as a property'
                    );
                });
            });

            it(label + ' offers no retainable property the model class does not carry', () => {
                const properties = propertiesOf(model);
                declared.items.enum.forEach((name) => {
                    assert.ok(
                        properties.indexOf(name) !== -1,
                        label + ' offers ' + name + ' as retainable but the model class does not define it'
                    );
                });
            });

            it(label + ' offers nothing that identifies the record, because retaining an identity cannot change it', () => {
                const keys = model._keys || [];
                declared.items.enum.forEach((name) => {
                    assert.ok(keys.indexOf(name) === -1, label + ' offers its own key ' + name + ' as retainable');
                });
            });
        });
    });
});
