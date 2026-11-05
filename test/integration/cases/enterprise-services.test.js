/* eslint-disable no-undef */
/*
 * Enterprise services: the round trip of a service with all its nested objects, then updates that drop
 * rows and change a rule's action, the refusals to recreate a service an external system uses and to
 * delete a predefined one, an embedded object structure deployed, renamed and deleted with its service,
 * an extracted service redeployed unchanged, and the payload validation errors.
 */
import { assertEquals } from '../harness.js';
import { loadFixture, roundTrip } from '../round-trip.js';

const NAME = 'NVTEST_ES_ASSET';
const EXTSYS = 'NVTESTESX';
const SCRIPT_NAME = 'NVTEST.ES.SETUP';
const DELETE = { enterpriseServices: [{ _delete: true, ifaceName: NAME }] };
const EMBEDDED = 'NVTEST_ES_EMBED';
const OS1 = 'NVTEST_ESOS1';
const OS2 = 'NVTEST_ESOS2';
const PREDEFINED = 'MXBUDGETInterface';

const SYNONYM_DOMAINS = {};
['processingRules', 'objectProcessingRules'].forEach((rules) => {
    SYNONYM_DOMAINS[rules + '.action'] = 'IFACEPROCTYPE';
    SYNONYM_DOMAINS[rules + '.conditions.details.evalType'] = 'EVALTYPE';
    SYNONYM_DOMAINS[rules + '.conditions.details.changeType'] = 'CHANGETYPE';
});

function script(description, body) {
    return [
        'var scriptConfig = { autoscript: "' + SCRIPT_NAME + '", description: "' + description + '", active: true };',
        "var MXServer = Java.type('psdi.server.MXServer');",
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

async function runScript(client, description, body) {
    const response = await client.runDeployScript(script(description, body.concat(["throw new Error('NVTEST_DONE');"])));
    if (!/NVTEST_DONE/.test((response && response.message) || '')) {
        throw new Error(description + ' failed: ' + JSON.stringify(response));
    }
}

function linkExternalSystem(client) {
    return runScript(client, 'Enterprise service test external system', [
        "var set = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', userInfo);",
        'try {',
        '    var system = set.add();',
        "    system.setValue('EXTSYSNAME', '" + EXTSYS + "');",
        "    system.setValue('DESCRIPTION', 'Enterprise service test');",
        "    system.setValue('ENDPOINTNAME', 'MXXMLFILE');",
        "    var link = system.getMboSet('MAXEXTIFACEIN').add();",
        "    link.setValue('IFACENAME', '" + NAME + "');",
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ]);
}

function unlinkExternalSystem(client) {
    return runScript(client, 'Enterprise service test external system cleanup', [
        "var set = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', userInfo);",
        'try {',
        '    set.setWhere("extsysname = \'' + EXTSYS + '\'");',
        '    var system = set.moveFirst();',
        '    if (system) {',
        "        system.getMboSet('MAXEXTIFACEIN').deleteAll();",
        '        set.save();',
        '        system = set.moveFirst();',
        '        system.delete();',
        '        set.save();',
        '    }',
        '} finally {',
        '    set.close();',
        '}'
    ]);
}

async function expectError(client, payload, pattern, describe) {
    try {
        await client.deployConfig(payload);
    } catch (error) {
        if (!pattern.test(error.message)) {
            throw new Error(describe + ': unexpected error ' + error.message);
        }
        return;
    }
    throw new Error(describe + ': the deploy did not fail');
}

async function idOf(client, objectType, label) {
    const match = (await client.getObjectList(objectType)).find((item) => item.label === label);
    return match ? match.id : null;
}

/** Redeploys the service as extracted, which must recreate it unchanged and never touch a predefined object structure. */
async function redeployExtracted(client, intObjectName, describe) {
    const objectStructureId = await idOf(client, 'integrationobjects', intObjectName);
    const extracted = await client.extract('enterpriseservices', EMBEDDED);
    const predefined = intObjectName === 'MXOPERLOC';
    if (predefined) {
        assertEquals(extracted.intObjectName, intObjectName, describe + ': the object structure is extracted by reference');
        assertEquals(extracted.objectStructure, undefined, describe + ': the object structure is not embedded');
    } else {
        assertEquals(extracted.objectStructure.intObjectName, intObjectName, describe + ': the object structure is extracted embedded');
        assertEquals(extracted.intObjectName, undefined, describe + ': the object structure is not referenced');
    }

    const { warnings } = await client.deployConfig({ enterpriseServices: [extracted] });
    assertEquals(warnings.length, 0, describe + ': the extracted service deploys without warnings');
    assertEquals(JSON.stringify(await client.extract('enterpriseservices', EMBEDDED)), JSON.stringify(extracted), describe + ': the service is unchanged');
    if (predefined) {
        assertEquals(await idOf(client, 'integrationobjects', intObjectName), objectStructureId, describe + ': the object structure is not recreated');
    }
}

function embedded(intObjectName, objectName, description) {
    return {
        enterpriseServices: [
            {
                ifaceName: EMBEDDED,
                objectStructure: { intObjectName, description, maxIntObjDetail: [{ objectName }] },
                processingRules: [{ procName: 'NVSKIP', action: '!SKIP!', objectName, enabled: true }]
            }
        ]
    };
}

async function embeddedObjectStructure(client) {
    const cleanup = async () => {
        await client.deployConfig({ enterpriseServices: [{ _delete: true, ifaceName: EMBEDDED }] });
        await client.deployConfig({ integrationObjects: [OS1, OS2].map((intObjectName) => ({ _delete: true, intObjectName })) });
    };
    await cleanup();
    try {
        await client.deployConfig(embedded(OS1, 'ASSET', 'Release 1'));
        assertEquals(
            (await client.extract('enterpriseservices', EMBEDDED)).objectStructure.intObjectName,
            OS1,
            'The service receives the embedded object structure'
        );
        assertEquals((await client.extract('integrationobjects', OS1)).description, 'Release 1', 'The embedded object structure is created');

        await client.deployConfig(embedded(OS1, 'ASSET', 'Release 2'));
        assertEquals((await client.extract('integrationobjects', OS1)).description, 'Release 2', 'The embedded object structure is updated');
        await redeployExtracted(client, OS1, 'User defined');

        await client.deployConfig(embedded(OS2, 'LOCATIONS', 'Renamed'));
        assertEquals(
            (await client.extract('enterpriseservices', EMBEDDED)).objectStructure.intObjectName,
            OS2,
            'The service receives the renamed object structure'
        );
        assertEquals((await client.extract('integrationobjects', OS1)).intObjectName, OS1, 'The object structure used before the rename is kept');
        await client.deployConfig({ integrationObjects: [{ _delete: true, intObjectName: OS1 }] });
        assertEquals(await client.extract('integrationobjects', OS1), null, 'The unlinked object structure is deleted on the top level');

        await client.deployConfig({ enterpriseServices: [{ ifaceName: EMBEDDED, intObjectName: 'MXOPERLOC' }] });
        assertEquals(
            (await client.extract('enterpriseservices', EMBEDDED)).intObjectName,
            'MXOPERLOC',
            'The service references another object structure'
        );
        assertEquals((await client.extract('integrationobjects', OS2)).intObjectName, OS2, 'A reference leaves the object structure used before');
        await redeployExtracted(client, 'MXOPERLOC', 'Predefined');

        const predefinedId = await idOf(client, 'integrationobjects', 'MXOPERLOC');
        const predefined = await client.deployConfig(embedded('MXOPERLOC', 'LOCATIONS', 'Predefined'));
        assertEquals(
            predefined.warnings.some((warning) => /MXOPERLOC is predefined.*intObjectName/.test(warning)),
            true,
            'An embedded predefined object structure is reported as skipped'
        );
        assertEquals(await idOf(client, 'integrationobjects', 'MXOPERLOC'), predefinedId, 'An embedded predefined object structure is not recreated');
        assertEquals((await client.extract('enterpriseservices', EMBEDDED)).intObjectName, 'MXOPERLOC', 'The service references the predefined object structure');

        const deployment = embedded(OS2, 'LOCATIONS', 'Embedded again');
        await client.deployConfig(deployment);
        deployment.enterpriseServices[0]._delete = true;
        await client.deployConfig(deployment);
        assertEquals(await client.extract('enterpriseservices', EMBEDDED), null, 'The embedded service is deleted');
        assertEquals((await client.extract('integrationobjects', OS2)).intObjectName, OS2, 'Deleting the service keeps its object structure');

        const ignored = embedded(OS2, 'LOCATIONS', 'Embedded again');
        await client.deployConfig(ignored);
        ignored.enterpriseServices[0].objectStructure._delete = true;
        const { warnings } = await client.deployConfig(ignored);
        assertEquals(
            warnings.some((warning) => /_delete on the object structure .* is ignored/.test(warning)),
            true,
            '_delete on the object structure of a service that is not deleted is reported as ignored'
        );
        assertEquals((await client.extract('integrationobjects', OS2)).description, 'Embedded again', 'The object structure is kept unchanged');
        assertEquals(
            (await client.extract('enterpriseservices', EMBEDDED)).objectStructure.intObjectName,
            OS2,
            'The service still uses the object structure'
        );

        await client.deployConfig({ enterpriseServices: [{ _delete: true, ifaceName: EMBEDDED, objectStructure: { _delete: true, intObjectName: OS2 } }] });
        assertEquals(await client.extract('enterpriseservices', EMBEDDED), null, 'The service is deleted with its object structure');
        assertEquals(await client.extract('integrationobjects', OS2), null, 'The object structure marked _delete is deleted with its service');
    } finally {
        await cleanup();
    }
}

function ruleNamed(rules, procName) {
    return (rules || []).find((rule) => rule.procName === procName);
}

export default {
    name: 'enterprise-services',
    run: async (client) => {
        await client.deployConfig(DELETE);
        assertEquals(await client.extract('enterpriseservices', NAME), null, 'Enterprise service left over from an earlier run');

        await roundTrip(client, {
            fixture: 'enterprise-services',
            payloadKey: 'enterpriseServices',
            objectType: 'enterpriseservices',
            identityProperty: 'ifaceName',
            synonymDomains: SYNONYM_DOMAINS,
            compareFixture: true,
            verify: (extracted, describe) => assertEquals(extracted.objectStructure, undefined, describe + ' predefined object structure is not embedded')
        });

        const fixture = loadFixture('enterprise-services');
        const service = fixture.enterpriseServices[0];
        const actions = await client.synonymMap('IFACEPROCTYPE');

        try {
            await client.deployConfig(fixture);

            // NVSET becomes a SKIP rule; a gateway property, the POSEND control, the additional object structure and the object rules are dropped.
            const updated = JSON.parse(JSON.stringify(service));
            updated.integrationControls = [{ control: 'WOSTART' }];
            updated.gatewayProperties = [service.gatewayProperties[0]];
            delete updated.additionalObjectStructures;
            delete updated.objectProcessingRules;
            updated.processingRules = [service.processingRules[0], { procName: 'NVSET', action: '!SKIP!', objectName: 'ASSET', enabled: true }];
            await client.deployConfig({ enterpriseServices: [updated] });

            let extracted = await client.extract('enterpriseservices', NAME);
            assertEquals(JSON.stringify(extracted.integrationControls.map((c) => c.control)), '["WOSTART"]', 'The dropped control is deleted');
            assertEquals(JSON.stringify(extracted.gatewayProperties.map((p) => p.param)), '["NVPARAM1"]', 'The dropped gateway property is deleted');
            assertEquals(extracted.additionalObjectStructures, undefined, 'The dropped additional object structure is deleted');
            assertEquals(extracted.objectProcessingRules, undefined, 'The dropped object rules are deleted');
            assertEquals(ruleNamed(extracted.processingRules, 'NVSET').action, actions.SKIP, 'The rule action changes');
            assertEquals(ruleNamed(extracted.processingRules, 'NVSET').fields, undefined, 'The fields of the rule whose action changed are gone');

            // A service an external system uses is neither recreated nor deleted, and keeps its rows.
            await linkExternalSystem(client);
            try {
                const pattern = new RegExp('while the external system ' + EXTSYS + ' uses it');
                await expectError(client, { enterpriseServices: [updated] }, pattern, 'Recreate while linked');
                await expectError(client, DELETE, pattern, 'Delete while linked');
                extracted = await client.extract('enterpriseservices', NAME);
                assertEquals(extracted.processingRules.length, 2, 'The refused service keeps its rules');
                assertEquals(extracted.gatewayProperties.length, 1, 'The refused service keeps its gateway properties');
            } finally {
                await unlinkExternalSystem(client);
            }
        } finally {
            await client.deployConfig(DELETE);
        }
        assertEquals(await client.extract('enterpriseservices', NAME), null, 'Extract of enterprise service "' + NAME + '" after delete');

        const predefined = await client.extract('enterpriseservices', PREDEFINED);
        if (predefined) {
            await expectError(
                client,
                { enterpriseServices: [{ _delete: true, ifaceName: PREDEFINED }] },
                /is predefined and cannot be deleted/,
                'Delete a predefined service'
            );
            assertEquals(JSON.stringify(await client.extract('enterpriseservices', PREDEFINED)), JSON.stringify(predefined), 'The predefined service is unchanged');
        }

        await expectError(
            client,
            { enterpriseServices: [{ ifaceName: NAME, intObjectName: 'MXASSET', gatewayProperties: [{ param: 'P' }, { param: 'P' }] }] },
            /lists the gateway property P more than once/,
            'Duplicate gateway properties'
        );
        await expectError(
            client,
            { enterpriseServices: [{ ifaceName: NAME, intObjectName: 'MXASSET', objectProcessingRules: [{ procName: 'NVSKIP' }] }] },
            /missing the required action/,
            'Rule without an action'
        );
        await expectError(client, { enterpriseServices: [{ ifaceName: NAME }] }, /needs an intObjectName or an objectStructure/, 'New service without an object structure');
        await expectError(
            client,
            {
                enterpriseServices: [
                    { ifaceName: NAME, intObjectName: 'MXASSET', objectStructure: { intObjectName: OS1, maxIntObjDetail: [{ objectName: 'ASSET' }] } }
                ]
            },
            /does not match its objectStructure/,
            'A reference that differs from the embedded object structure'
        );
        assertEquals(await client.extract('enterpriseservices', NAME), null, 'A rejected payload creates nothing');

        await embeddedObjectStructure(client);
    }
};
