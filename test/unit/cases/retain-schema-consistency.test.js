/*
 * Guards the one place the retain contract is stated twice.
 *
 *   npm run test:unit
 *
 * The deployment JSON schema lists which properties a payload author may name in "_retain". It gives
 * editor completion, and with server side validation gone it is the only gate before the deployment
 * itself. The properties it offers are defined by the model classes in the Nashorn library, which
 * sit on the far side of the REST boundary and are built for Nashorn, so the two cannot share a
 * definition. This test makes drift between them impossible instead: a property renamed in a model
 * class, or offered by the schema but never defined, fails here rather than at deploy time.
 *
 * A configuration type added later is covered by adding it to RETAIN_CONTRACTS below.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { loadScriptFunctions, REPO_ROOT } from '../harness.js';

const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'deploy-schema.json'), 'utf8'));

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
        'MaximoQuery',
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
        'MaximoEndPoint',
        'MaximoEndPointProperty',
        'MaximoPublishChannel',
        'MaximoEnterpriseService',
        'MaximoIntegrationControl',
        'MaximoEnterpriseServiceObjectStructure',
        'MaximoEnterpriseServiceGatewayProperty',
        'MaximoExternalSystem',
        'MaximoExternalSystemPublishChannel',
        'MaximoExternalSystemEnterpriseService',
        'MaximoExternalSystemIntegrationControl',
        'MaximoExternalSystemIntegrationControlOverride',
        'MaximoExternalSystemIntegrationControlListValue',
        'MaximoExternalSystemIntegrationControlCrossReferenceValue',
        'listValuesOf',
        'crossReferenceValuesOf',
        'rejectDuplicates',
        'MaximoProcessingRule',
        'MaximoProcessingRuleCondition',
        'MaximoProcessingRuleConditionDetail',
        'MaximoProcessingRuleField',
        'MaximoProcessingRuleColumn',
        'validateIntegrationObjectInput',
        'validateIntegrationObjectDetails',
        'validateSignatureOptions',
        'validateOSLCActions',
        'validateOSLCQueries',
        'validateQueryTemplates',
        'arrayOrEmpty',
        'lowerCase',
        'isMissing',
        'sortDetails',
        'upperCaseKey',
        'booleanOrDefault',
        'valueOrDefault',
        'requireKeys'
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
            { label: 'cronTask', model: models.MaximoCronTask, sample: { cronTaskName: 'TASK' } },
            { label: 'cronTaskInstance', collection: 'cronTaskInstance', model: models.MaximoCronTaskInstance },
            { label: 'cronTaskParam', collection: 'cronTaskParam', model: models.MaximoCronTaskParam }
        ]
    },
    {
        definition: 'domain',
        levels: [{ label: 'domain', model: models.MaximoDomain, sample: { domainId: 'DOMAIN' } }]
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
    },
    {
        definition: 'endPoint',
        levels: [
            { label: 'endPoint', model: models.MaximoEndPoint, sample: { endPointName: 'EXAMPLE' } },
            { label: 'endPoint.properties', collection: 'properties', model: models.MaximoEndPointProperty, sample: { property: 'URL' } }
        ]
    },
    {
        definition: 'publishChannel',
        levels: [
            { label: 'publishChannel', model: models.MaximoPublishChannel, sample: { ifaceName: 'EXAMPLE', intObjectName: 'MXASSET' } }
        ]
    },
    {
        definition: 'enterpriseService',
        levels: [
            { label: 'enterpriseService', model: models.MaximoEnterpriseService, sample: { ifaceName: 'EXAMPLE', intObjectName: 'MXASSET' } },
            { label: 'enterpriseService.additionalObjectStructures', collection: 'additionalObjectStructures', model: models.MaximoEnterpriseServiceObjectStructure, sample: { intObjectName: 'MXASSET' } }
        ]
    },
    {
        definition: 'enterpriseService',
        levels: [{ label: 'enterpriseService.gatewayProperties', collection: 'gatewayProperties', model: models.MaximoEnterpriseServiceGatewayProperty, sample: { param: 'PARAM' } }]
    },
    {
        definition: 'externalSystem',
        levels: [{ label: 'externalSystem', model: models.MaximoExternalSystem, sample: { extSysName: 'EXAMPLE' } }]
    },
    {
        definition: 'externalSystemPublishChannel',
        levels: [{ label: 'externalSystem.publishChannels', model: models.MaximoExternalSystemPublishChannel, sample: { ifaceName: 'EXAMPLE' } }]
    },
    {
        definition: 'externalSystemEnterpriseService',
        levels: [{ label: 'externalSystem.enterpriseServices', model: models.MaximoExternalSystemEnterpriseService, sample: { ifaceName: 'EXAMPLE' } }]
    },
    {
        definition: 'externalSystemIntegrationControl',
        levels: [{ label: 'externalSystem.integrationControls', model: models.MaximoExternalSystemIntegrationControl, sample: { control: 'EXAMPLE' } }]
    },
    {
        definition: 'externalSystemIntegrationControlOverride',
        levels: [{ label: 'externalSystem.integrationControls.overrides', model: models.MaximoExternalSystemIntegrationControlOverride, sample: { orgId: 'EXAMPLE' } }]
    },
    {
        definition: 'processingRule',
        levels: [
            { label: 'processingRule', model: models.MaximoProcessingRule, sample: { procName: 'RULE', action: 'SKIP' } },
            { label: 'processingRule.conditions', collection: 'conditions', model: models.MaximoProcessingRuleCondition },
            { label: 'processingRule.conditions.details', collection: 'details', model: models.MaximoProcessingRuleConditionDetail, sample: { condType: 'FIELD' } }
        ]
    },
    {
        definition: 'processingRule',
        levels: [{ label: 'processingRule.fields', collection: 'fields', model: models.MaximoProcessingRuleField, sample: { fieldName: 'FIELD', valueType: 'VALUE' } }]
    },
    {
        definition: 'processingRule',
        levels: [{ label: 'processingRule.columns', collection: 'columns', model: models.MaximoProcessingRuleColumn, sample: { fieldName: 'FIELD' } }]
    },
    {
        definition: 'query',
        levels: [{ label: 'query', model: models.MaximoQuery, sample: { app: 'APP', clauseName: 'CLAUSE', owner: 'OWNER' } }]
    },
    {
        definition: 'message',
        levels: [{ label: 'message', model: models.MaximoMessage, sample: { msgGroup: 'GROUP', msgKey: 'KEY', value: 'Value' } }]
    },
    {
        definition: 'maximoProperty',
        levels: [
            { label: 'property', model: models.MaximoProperty, sample: { propName: 'example.property' } },
            { label: 'property.maxPropInstance', collection: 'maxPropInstance', model: models.MaximoPropertyInstance, sample: { serverName: 'SERVER' } }
        ]
    },
    {
        definition: 'logger',
        levels: [{ label: 'logger', model: models.MaximoLogger, sample: { logger: 'example' } }]
    },
    {
        definition: 'action',
        levels: [{ label: 'action', model: models.MaximoAction, sample: { action: 'EXAMPLE' } }]
    },
    {
        definition: 'escalation',
        levels: [
            { label: 'escalation', model: models.MaximoEscalation, sample: { escalation: 'EXAMPLE' } },
            { label: 'escalation.escRefPoint', collection: 'escRefPoint', model: models.MaximoEscalationRefPoint, sample: { refPointNum: 1 } }
        ]
    },
    {
        definition: 'maximoObject',
        levels: [
            { label: 'object', model: models.MaximoObject, sample: { object: 'EXAMPLE' } },
            { label: 'object.attributes', collection: 'attributes', model: models.MaximoAttribute }
        ]
    },
    {
        definition: 'maximoObject',
        levels: [{ label: 'object.relationships', collection: 'relationships', model: models.Relationship }]
    },
    {
        definition: 'integrationObject',
        levels: [
            { label: 'integrationObject', model: models.MaximoIntegrationObject, sample: { intObjectName: 'EXAMPLE', maxIntObjDetail: [{ objectName: 'ASSET' }] } },
            { label: 'integrationObject.maxIntObjDetail', collection: 'maxIntObjDetail', model: models.MaximoIntegrationObjectDetail, sample: { objectName: 'ASSET' } },
            { label: 'integrationObject.maxIntObjDetail.maxIntObjAlias', collection: 'maxIntObjAlias', model: models.MaximoIntegrationObjectAlias }
        ]
    },
    {
        definition: 'integrationObject',
        levels: [
            { label: 'integrationObject.maxIntObjDetail', collection: 'maxIntObjDetail', model: models.MaximoIntegrationObjectDetail, sample: { objectName: 'ASSET' } },
            { label: 'integrationObject.maxIntObjDetail.objectAppAuth', collection: 'objectAppAuth', model: models.MaximoObjectApplicationAuth }
        ]
    },
    {
        definition: 'integrationObject',
        levels: [{ label: 'integrationObject.sigOption', collection: 'sigOption', model: models.MaximoSignatureOption }]
    },
    {
        definition: 'integrationObject',
        levels: [{ label: 'integrationObject.osOSLCAction', collection: 'osOSLCAction', model: models.MaximoOSLCAction }]
    },
    {
        definition: 'integrationObject',
        levels: [{ label: 'integrationObject.oslcQuery', collection: 'oslcQuery', model: models.MaximoOSLCQuery, sample: { queryType: 'osclause' } }]
    },
    {
        definition: 'integrationObject',
        levels: [
            { label: 'integrationObject.queryTemplate', collection: 'queryTemplate', model: models.MaximoQueryTemplate },
            { label: 'integrationObject.queryTemplate.queryTemplateAttr', collection: 'queryTemplateAttr', model: models.MaximoQueryTemplateAttribute }
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

        return { label: level.label, model: level.model, sample: level.sample, schema: node };
    });
}

/*
 * The properties a model class defines, which is what a payload may legitimately ask to retain. The
 * markers are excluded because they are engine instructions rather than record data. A model whose
 * constructor rejects an empty input is built from the level's sample instead.
 */
function propertiesOf(model, sample) {
    return Object.keys(new model(sample || {})).filter((name) => name.charAt(0) !== '_');
}

describe('retain schema consistency', () => {
    RETAIN_CONTRACTS.forEach((contract) => {
        schemaNodesOf(contract).forEach(({ label, model, sample, schema: node }) => {
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
                const properties = propertiesOf(model, sample);
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

describe('processing rule schema', () => {
    it('is shared by every collection of processing rules', () => {
        [
            ['publishChannel', 'processingRules'],
            ['enterpriseService', 'processingRules'],
            ['enterpriseService', 'objectProcessingRules']
        ].forEach(([definition, collection]) => {
            assert.deepStrictEqual(schema.definitions[definition].properties[collection].items, { $ref: '#/definitions/processingRule' }, definition + '.' + collection);
        });
    });
});

describe('external system schema', () => {
    it('embeds publish channels and enterprise services with their own definitions', () => {
        assert.deepStrictEqual(schema.definitions.externalSystemPublishChannel.properties.publishChannel.$ref, '#/definitions/publishChannel');
        assert.deepStrictEqual(schema.definitions.externalSystemEnterpriseService.properties.enterpriseService.$ref, '#/definitions/enterpriseService');
    });
});

describe('object schema', () => {
    it('keeps every property of the legacy pre-deployment schema, which stays without _retain', () => {
        const predeploy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'predeploy-schema.json'), 'utf8'));
        const legacy = predeploy.definitions.maximoObject;
        const current = schema.definitions.maximoObject;
        const names = (node) => Object.keys(node.properties).filter((name) => name !== '_retain');

        assert.deepStrictEqual(names(current), names(legacy));
        ['attributes', 'indexes', 'relationships'].forEach((collection) => {
            assert.deepStrictEqual(names(current.properties[collection].items), names(legacy.properties[collection].items), collection);
            assert.ok(!legacy.properties[collection].items.properties._retain, collection + ' offers _retain in the pre-deployment schema');
        });
        assert.ok(!legacy.properties._retain, 'the pre-deployment schema offers _retain');
    });
});
