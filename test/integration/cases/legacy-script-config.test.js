/* eslint-disable no-undef */
/*
 * Verifies the messages, maxvars and properties a script may declare in its own scriptConfig.
 *
 * This is the older way of shipping configuration alongside a script, kept for the deployments
 * that already rely on it and superseded by declarative JSON configuration. It is worth pinning
 * precisely because it is legacy: it is the part most likely to be broken by a change made with
 * the newer path in mind, and it uses "delete" to remove a record where JSON configuration uses
 * "_delete".
 *
 * MAXVARTYPE has no object structure, so the maxvar is read back by a one-off deploy script that
 * reports what Maximo holds by throwing it. That script removes itself, whether it ran or not.
 */
const { assertEquals, assertNotNull } = require('../harness');

const SCRIPT_NAME = 'NVTEST.LEGACYCONFIG';
const MAXVAR_NAME = 'NVTESTLEGACYVAR';
const MESSAGE_GROUP = 'nvtestlegacy';
const MESSAGE_KEY = 'legacyMessage';
const PROPERTY_NAME = 'TEST_legacy_scriptconfig';
const INITIAL_PROPERTY_NAME = 'TEST_legacy_initial_value';

function scriptSource(config) {
    const declared = Object.assign({ autoscript: SCRIPT_NAME, description: 'Legacy configuration integration test', status: 'Active' }, config);
    return 'var scriptConfig = ' + JSON.stringify(declared, null, 4) + ';\n\nfunction main() {}\n';
}

/**
 * Returns what Maximo holds for the test maxvar as a single delimited string, or ABSENT.
 */
async function readMaxvar(client) {
    const probe = [
        "var scriptConfig = { autoscript: 'NVTEST.LEGACYCONFIG.PROBE', description: 'Reads a maxvar back', status: 'Active' };",
        '',
        'var server = Packages.psdi.server.MXServer.getMXServer();',
        "var maxvarTypeSet = server.getMboSet('MAXVARTYPE', server.getSystemUserInfo());",
        'var reported;',
        '',
        'try {',
        '    maxvarTypeSet.setWhere("varname = \'' + MAXVAR_NAME + '\'");',
        '    var maxvarType = maxvarTypeSet.moveFirst();',
        '',
        '    if (!maxvarType) {',
        "        reported = 'ABSENT';",
        '    } else {',
        "        var value = maxvarType.getMboSet('MAXVARS').moveFirst();",
        "        reported = maxvarType.getString('VARTYPE') + '|' + maxvarType.getString('DEFAULTVALUE') + '|' + maxvarType.getString('DESCRIPTION') + '|' + (value ? value.getString('VARVALUE') : 'NOVALUE');",
        '    }',
        '} finally {',
        '    maxvarTypeSet.close();',
        '}',
        '',
        "throw 'NVMAXVAR[' + reported + ']';",
        ''
    ].join('\n');

    const response = await client.runDeployScript(probe, false);
    const reported = /NVMAXVAR\[(.*?)\]/.exec(JSON.stringify(response));

    assertNotNull(reported, 'The maxvar probe did not report anything, and answered ' + JSON.stringify(response));
    return reported[1];
}

async function readMessage(client) {
    const response = await client.client.request({
        url: 'os/mxmessage',
        method: 'GET',
        params: {
            lean: 'true',
            'oslc.where': 'msggroup="' + MESSAGE_GROUP + '" and msgkey="' + MESSAGE_KEY + '"',
            'oslc.select': 'msggroup,msgkey,value,msgid,displaymethod'
        },
        validateStatus: () => true
    });

    const members = (response.data && response.data.member) || [];
    return members.length > 0 ? members[0] : null;
}

/**
 * Removes the message and the maxvar the test uses, through the same legacy "delete" the test
 * exercises, so that neither a previous failure nor this run can leave them behind.
 */
async function removeLegacyRecords(client) {
    return client.deployScriptSource(
        scriptSource({
            messages: [{ msgGroup: MESSAGE_GROUP, msgKey: MESSAGE_KEY, value: 'removed', delete: true }],
            maxvars: [{ varName: MAXVAR_NAME, varType: 'SYSTEM', delete: true }]
        }),
        false
    );
}

/**
 * Removes the properties the test declares. They are created through the legacy scriptConfig but
 * removed through JSON configuration, because "delete" on a legacy property entry is a separate
 * path from the one under test here.
 */
async function removeProperties(client) {
    return client.deployConfig({
        properties: [
            { propName: PROPERTY_NAME, _delete: true },
            { propName: INITIAL_PROPERTY_NAME, _delete: true }
        ]
    });
}

async function deleteScript(client, name) {
    const record = await client.findScript(name);

    if (!record) {
        return;
    }

    await client.client.request({
        url: record.href,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-method-override': 'DELETE' },
        validateStatus: () => true
    });
}

module.exports = {
    name: 'legacy-script-config',
    run: async (client) => {
        try {
            await removeLegacyRecords(client);
            await removeProperties(client);

            assertEquals(await readMaxvar(client), 'ABSENT', 'The test maxvar already existed before the test ran');
            assertEquals(await readMessage(client), null, 'The test message already existed before the test ran');

            const deployed = await client.deployScriptSource(
                scriptSource({
                    messages: [{ msgGroup: MESSAGE_GROUP, msgKey: MESSAGE_KEY, value: 'Legacy message value', prefix: 'BMXZZ', suffix: 'E' }],
                    maxvars: [{ varName: MAXVAR_NAME, varType: 'SYSTEM', description: 'LegacyMaxvar', defaultValue: '7', varValue: '9' }],
                    properties: [
                        {
                            propName: PROPERTY_NAME,
                            description: 'Legacy property',
                            propValue: 'legacy',
                            globalOnly: true,
                            liveRefresh: false,
                            nullsAllowed: true,
                            maxType: 'ALN',
                            secureLevel: 'SECURE'
                        },
                        {
                            propName: INITIAL_PROPERTY_NAME,
                            description: 'Legacy property with an initial value',
                            initialPropValue: 'initial',
                            maxType: 'ALN'
                        }
                    ]
                }),
                false
            );

            assertEquals(deployed.status, 'success', 'Deploying the script reported ' + JSON.stringify(deployed));

            assertEquals(await readMaxvar(client), 'SYSTEM|7|LegacyMaxvar|9', 'The maxvar Maximo holds');

            const message = await readMessage(client);
            assertNotNull(message, 'The message declared in the scriptConfig was not created');
            assertEquals(message.value, 'Legacy message value', 'Message value');
            assertEquals(String(message.msgid).slice(0, 5), 'BMXZZ', 'Message id prefix');
            assertEquals(String(message.msgid).slice(-1), 'E', 'Message id suffix');

            const property = await client.extract('properties', PROPERTY_NAME);
            assertNotNull(property, 'The property declared in the scriptConfig was not created');
            assertEquals(property.description, 'Legacy property', 'Property description');
            assertEquals(property.maxType, 'ALN', 'Property type');
            // The value is set on a property that did not exist before this deployment, which is the
            // case that writing the MAXPROPVALUE child directly silently loses.
            assertEquals(property.propValue, 'legacy', 'Property value');

            const initialProperty = await client.extract('properties', INITIAL_PROPERTY_NAME);
            assertNotNull(initialProperty, 'The property declaring an initial value was not created');
            assertEquals(initialProperty.propValue, 'initial', 'Initial property value on creation');

            // An initial value seeds a property that does not exist yet and must never overwrite the
            // value the target system already holds.
            const redeployed = await client.deployScriptSource(
                scriptSource({
                    properties: [{ propName: INITIAL_PROPERTY_NAME, description: 'Legacy property with an initial value', initialPropValue: 'replaced', maxType: 'ALN' }]
                }),
                false
            );

            assertEquals(redeployed.status, 'success', 'Redeploying the initial value property reported ' + JSON.stringify(redeployed));
            assertEquals((await client.extract('properties', INITIAL_PROPERTY_NAME)).propValue, 'initial', 'Initial property value after a redeployment');

            // Legacy configuration removes a record with "delete", not the "_delete" that JSON
            // configuration uses. The difference is deliberate and has to keep working.
            const removed = await client.deployScriptSource(
                scriptSource({
                    messages: [{ msgGroup: MESSAGE_GROUP, msgKey: MESSAGE_KEY, value: 'Legacy message value', delete: true }],
                    maxvars: [{ varName: MAXVAR_NAME, varType: 'SYSTEM', delete: true }]
                }),
                false
            );

            assertEquals(removed.status, 'success', 'Removing the legacy configuration reported ' + JSON.stringify(removed));
            assertEquals(await readMaxvar(client), 'ABSENT', 'The maxvar was not removed by "delete"');
            assertEquals(await readMessage(client), null, 'The message was not removed by "delete"');
        } finally {
            // A run that fails part way through would otherwise leave the message and the maxvar
            // behind, and the next run would find them already there.
            await removeLegacyRecords(client);
            await deleteScript(client, SCRIPT_NAME);
            await removeProperties(client);
        }

        assertEquals(await client.extract('properties', PROPERTY_NAME), null, 'The property was not removed after the test');
        assertEquals(await client.extract('properties', INITIAL_PROPERTY_NAME), null, 'The initial value property was not removed after the test');
    }
};
