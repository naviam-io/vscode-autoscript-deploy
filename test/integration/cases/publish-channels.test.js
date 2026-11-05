/* eslint-disable no-undef */
/*
 * Publish channels: the round trip of a channel with all its nested objects, then updates that change
 * a rule's action, drop rows, toggle the listener and move the channel to another object structure,
 * Maximo refusing to recreate a channel an external system uses, an embedded object structure deployed,
 * renamed and deleted with its channel, an extracted channel redeployed unchanged, and the payload
 * validation errors.
 */
import { assertEquals } from '../harness.js';
import { loadFixture, roundTrip } from '../round-trip.js';

const NAME = 'NVTEST_PC_ASSET';
const EXTSYS = 'NVTESTPCX';
const SCRIPT_NAME = 'NVTEST.PC.SETUP';
const DELETE = { publishChannels: [{ _delete: true, ifaceName: NAME }] };
const EMBEDDED = 'NVTEST_PC_EMBED';
const OS1 = 'NVTEST_PCOS1';
const OS2 = 'NVTEST_PCOS2';

const SYNONYM_DOMAINS = {
    'processingRules.action': 'IFACEPROCTYPE',
    'processingRules.conditions.details.evalType': 'EVALTYPE',
    'processingRules.conditions.details.changeType': 'CHANGETYPE'
};

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
    return runScript(client, 'Publish channel test external system', [
        "var set = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', userInfo);",
        'try {',
        '    var system = set.add();',
        "    system.setValue('EXTSYSNAME', '" + EXTSYS + "');",
        "    system.setValue('DESCRIPTION', 'Publish channel test');",
        "    system.setValue('ENDPOINTNAME', 'MXXMLFILE');",
        "    var link = system.getMboSet('MAXEXTIFACEOUT').add();",
        "    link.setValue('IFACENAME', '" + NAME + "');",
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ]);
}

function unlinkExternalSystem(client) {
    return runScript(client, 'Publish channel test external system cleanup', [
        "var set = MXServer.getMXServer().getMboSet('MAXEXTSYSTEM', userInfo);",
        'try {',
        '    set.setWhere("extsysname = \'' + EXTSYS + '\'");',
        '    var system = set.moveFirst();',
        '    if (system) {',
        "        system.getMboSet('MAXEXTIFACEOUT').deleteAll();",
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

/** Redeploys the channel as extracted, which must recreate it unchanged and never touch a predefined object structure. */
async function redeployExtracted(client, intObjectName, describe) {
    const objectStructureId = await idOf(client, 'integrationobjects', intObjectName);
    const extracted = await client.extract('publishchannels', EMBEDDED);
    const predefined = intObjectName === 'MXOPERLOC';
    if (predefined) {
        assertEquals(extracted.intObjectName, intObjectName, describe + ': the object structure is extracted by reference');
        assertEquals(extracted.objectStructure, undefined, describe + ': the object structure is not embedded');
    } else {
        assertEquals(extracted.objectStructure.intObjectName, intObjectName, describe + ': the object structure is extracted embedded');
        assertEquals(extracted.intObjectName, undefined, describe + ': the object structure is not referenced');
    }

    const { warnings } = await client.deployConfig({ publishChannels: [extracted] });
    assertEquals(warnings.length, 0, describe + ': the extracted channel deploys without warnings');
    assertEquals(JSON.stringify(await client.extract('publishchannels', EMBEDDED)), JSON.stringify(extracted), describe + ': the channel is unchanged');
    if (predefined) {
        assertEquals(await idOf(client, 'integrationobjects', intObjectName), objectStructureId, describe + ': the object structure is not recreated');
    }
}

function embedded(intObjectName, objectName, description) {
    return { publishChannels: [{ ifaceName: EMBEDDED, objectStructure: { intObjectName, description, maxIntObjDetail: [{ objectName }] } }] };
}

async function embeddedObjectStructure(client) {
    const cleanup = async () => {
        await client.deployConfig({ publishChannels: [{ _delete: true, ifaceName: EMBEDDED }] });
        await client.deployConfig({ integrationObjects: [OS1, OS2].map((intObjectName) => ({ _delete: true, intObjectName })) });
    };
    await cleanup();
    try {
        await client.deployConfig(embedded(OS1, 'ASSET', 'Release 1'));
        assertEquals(
            (await client.extract('publishchannels', EMBEDDED)).objectStructure.intObjectName,
            OS1,
            'The channel publishes the embedded object structure'
        );
        assertEquals((await client.extract('integrationobjects', OS1)).description, 'Release 1', 'The embedded object structure is created');

        await client.deployConfig(embedded(OS1, 'ASSET', 'Release 2'));
        assertEquals((await client.extract('integrationobjects', OS1)).description, 'Release 2', 'The embedded object structure is updated');
        await redeployExtracted(client, OS1, 'User defined');

        await client.deployConfig(embedded(OS2, 'LOCATIONS', 'Renamed'));
        assertEquals(
            (await client.extract('publishchannels', EMBEDDED)).objectStructure.intObjectName,
            OS2,
            'The channel publishes the renamed object structure'
        );
        assertEquals((await client.extract('integrationobjects', OS1)).intObjectName, OS1, 'The object structure used before the rename is kept');
        await client.deployConfig({ integrationObjects: [{ _delete: true, intObjectName: OS1 }] });
        assertEquals(await client.extract('integrationobjects', OS1), null, 'The unlinked object structure is deleted on the top level');

        await client.deployConfig({ publishChannels: [{ ifaceName: EMBEDDED, intObjectName: 'MXOPERLOC' }] });
        assertEquals((await client.extract('publishchannels', EMBEDDED)).intObjectName, 'MXOPERLOC', 'The channel references another object structure');
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
        assertEquals((await client.extract('publishchannels', EMBEDDED)).intObjectName, 'MXOPERLOC', 'The channel references the predefined object structure');

        const deployment = embedded(OS2, 'LOCATIONS', 'Embedded again');
        await client.deployConfig(deployment);
        deployment.publishChannels[0]._delete = true;
        await client.deployConfig(deployment);
        assertEquals(await client.extract('publishchannels', EMBEDDED), null, 'The embedded channel is deleted');
        assertEquals((await client.extract('integrationobjects', OS2)).intObjectName, OS2, 'Deleting the channel keeps its object structure');

        const ignored = embedded(OS2, 'LOCATIONS', 'Embedded again');
        await client.deployConfig(ignored);
        ignored.publishChannels[0].objectStructure._delete = true;
        const { warnings } = await client.deployConfig(ignored);
        assertEquals(
            warnings.some((warning) => /_delete on the object structure .* is ignored/.test(warning)),
            true,
            '_delete on the object structure of a channel that is not deleted is reported as ignored'
        );
        assertEquals((await client.extract('integrationobjects', OS2)).description, 'Embedded again', 'The object structure is kept unchanged');
        assertEquals((await client.extract('publishchannels', EMBEDDED)).objectStructure.intObjectName, OS2, 'The channel still uses the object structure');

        await client.deployConfig({ publishChannels: [{ _delete: true, ifaceName: EMBEDDED, objectStructure: { _delete: true, intObjectName: OS2 } }] });
        assertEquals(await client.extract('publishchannels', EMBEDDED), null, 'The channel is deleted with its object structure');
        assertEquals(await client.extract('integrationobjects', OS2), null, 'The object structure marked _delete is deleted with its channel');
    } finally {
        await cleanup();
    }
}

function ruleNamed(extracted, procName) {
    return (extracted.processingRules || []).find((rule) => rule.procName === procName);
}

export default {
    name: 'publish-channels',
    run: async (client) => {
        await client.deployConfig(DELETE);
        assertEquals(await client.extract('publishchannels', NAME), null, 'Publish channel left over from an earlier run');

        await roundTrip(client, {
            fixture: 'publish-channels',
            payloadKey: 'publishChannels',
            objectType: 'publishchannels',
            identityProperty: 'ifaceName',
            synonymDomains: SYNONYM_DOMAINS,
            compareFixture: true,
            verify: (extracted, describe) => assertEquals(extracted.objectStructure, undefined, describe + ' predefined object structure is not embedded')
        });

        const fixture = loadFixture('publish-channels');
        const channel = fixture.publishChannels[0];
        const actions = await client.synonymMap('IFACEPROCTYPE');

        try {
            await client.deployConfig(fixture);

            // NVSET becomes a SKIP rule, NVSPLIT and the POSEND control are dropped, the listener is enabled.
            const updated = JSON.parse(JSON.stringify(channel));
            updated.listener = true;
            updated.integrationControls = [{ control: 'WOSTART' }];
            updated.processingRules = [
                channel.processingRules[0],
                {
                    procName: 'NVSET',
                    action: '!SKIP!',
                    objectName: 'ASSET',
                    enabled: true,
                    applyOnUpdate: true,
                    conditions: [{ condition: 10, details: [{ condType: 'FIELD', evalType: '!ISNULL!', changeType: '!ALWAYS!', columnName: 'LOCATION' }] }]
                }
            ];
            await client.deployConfig({ publishChannels: [updated] });

            let extracted = await client.extract('publishchannels', NAME);
            assertEquals(extracted.listener, true, 'The listener is enabled');
            assertEquals(JSON.stringify(extracted.integrationControls.map((c) => c.control)), '["WOSTART"]', 'The dropped control is deleted');
            assertEquals(ruleNamed(extracted, 'NVSPLIT'), undefined, 'The dropped rule is deleted');
            assertEquals(ruleNamed(extracted, 'NVSET').action, actions.SKIP, 'The rule action changes');
            assertEquals(ruleNamed(extracted, 'NVSET').fields, undefined, 'The fields of the rule whose action changed are gone');
            assertEquals(ruleNamed(extracted, 'NVSET').conditions.length, 1, 'The rule whose action changed has its condition');

            updated.listener = false;
            await client.deployConfig({ publishChannels: [updated] });
            extracted = await client.extract('publishchannels', NAME);
            assertEquals(extracted.listener, false, 'The listener is disabled');

            // Maximo refuses to delete a channel an external system uses, so it is neither recreated nor deleted.
            await linkExternalSystem(client);
            try {
                await expectError(
                    client,
                    { publishChannels: [updated] },
                    new RegExp('while the external system ' + EXTSYS + ' uses it'),
                    'Recreate while linked'
                );
                await expectError(client, DELETE, new RegExp('while the external system ' + EXTSYS + ' uses it'), 'Delete while linked');
                assertEquals((await client.extract('publishchannels', NAME)).processingRules.length, 2, 'The refused channel keeps its rules');
            } finally {
                await unlinkExternalSystem(client);
            }

            // The channel moves to another object structure.
            await client.deployConfig({
                publishChannels: [
                    {
                        ifaceName: NAME,
                        intObjectName: 'MXOPERLOC',
                        listener: true,
                        processingRules: [{ procName: 'NVSKIP', action: '!SKIP!', objectName: 'LOCATIONS', enabled: true }]
                    }
                ]
            });
            extracted = await client.extract('publishchannels', NAME);
            assertEquals(extracted.intObjectName, 'MXOPERLOC', 'The channel moves to the new object structure');
            assertEquals(extracted.listener, true, 'The moved channel has its listener enabled');
            assertEquals(extracted.processingRules.length, 1, 'The moved channel has only the deployed rule');
            assertEquals(ruleNamed(extracted, 'NVSKIP').objectName, 'LOCATIONS', 'The moved rule is on the new object');
        } finally {
            await client.deployConfig(DELETE);
        }
        assertEquals(await client.extract('publishchannels', NAME), null, 'Extract of publish channel "' + NAME + '" after delete');

        await expectError(
            client,
            { publishChannels: [{ ifaceName: NAME, intObjectName: 'MXASSET', integrationControls: [{ control: 'WOSTART' }, { control: 'WOSTART' }] }] },
            /lists the integration control WOSTART more than once/,
            'Duplicate integration controls'
        );
        await expectError(
            client,
            { publishChannels: [{ ifaceName: NAME, intObjectName: 'MXASSET', processingRules: [{ procName: 'NVSKIP' }] }] },
            /missing the required action/,
            'Rule without an action'
        );
        await expectError(
            client,
            { publishChannels: [{ ifaceName: NAME }] },
            /needs an intObjectName or an objectStructure/,
            'New channel without an object structure'
        );
        await expectError(
            client,
            {
                publishChannels: [
                    { ifaceName: NAME, intObjectName: 'MXASSET', objectStructure: { intObjectName: OS1, maxIntObjDetail: [{ objectName: 'ASSET' }] } }
                ]
            },
            /does not match its objectStructure/,
            'A reference that differs from the embedded object structure'
        );
        assertEquals(await client.extract('publishchannels', NAME), null, 'A rejected payload creates nothing');

        await embeddedObjectStructure(client);
    }
};
