/* eslint-disable no-undef */
/*
 * Verifies that a script's launch points and variables are deployed as declared.
 *
 * The launch point handling is the largest part of naviam.autoscript.deploy.js and the part with
 * the most branching: three launch point types, two event tables, and script variables that a
 * launch point may rebind. None of it can be unit tested, because every branch ends in a Maximo
 * mbo, so it is checked here against what the server actually stored.
 *
 * The script is deployed twice on purpose. The second deployment declares a different set, which
 * is how the removal of the previous launch points and variables is verified: they are deleted and
 * recreated on every deployment rather than merged, so a launch point dropped from the
 * configuration has to disappear from Maximo.
 */
const { assertEquals, assertNotNull } = require('../harness');

const SCRIPT_NAME = 'NVTEST.LAUNCHPOINTS';
const ACTION_NAME = 'NVTEST_LP_ACTION';

function scriptSource(launchPoints, variables) {
    const config = {
        autoscript: SCRIPT_NAME,
        description: 'Launch point integration test',
        status: 'Active'
    };

    if (variables) {
        config.autoScriptVars = variables;
    }

    if (launchPoints) {
        config.scriptLaunchPoints = launchPoints;
    }

    return 'var scriptConfig = ' + JSON.stringify(config, null, 4) + ';\n\nfunction main() {}\n';
}

async function launchPointsOf(client, name) {
    const response = await client.client.request({
        url: 'os/mxapiautoscript',
        method: 'GET',
        params: {
            lean: 'true',
            'oslc.where': 'autoscript="' + name + '"',
            'oslc.select': 'autoscript,scriptlaunchpoint{*},autoscriptvars{*}'
        },
        validateStatus: () => true
    });

    const members = (response.data && response.data.member) || [];
    assertNotNull(members[0], 'The script ' + name + ' was not found in Maximo');
    return members[0];
}

function launchPoint(record, name) {
    const found = (record.scriptlaunchpoint || []).find((entry) => String(entry.launchpointname).toUpperCase() === name);
    assertNotNull(found, 'The launch point ' + name + ' was not stored');
    return found;
}

// An action launch point can only name an action that exists, so the test creates its own rather
// than attaching itself to one of the actions Maximo ships with.
// SCRIPTLAUNCHPOINT.ACTIONNAME is not persistent: Maximo consumes it to point the named action at
// the script, so the linkage has to be read back from the action rather than the launch point.
async function actionRecord(client, name) {
    const response = await client.client.request({
        url: 'os/mxaction',
        method: 'GET',
        params: { lean: 'true', 'oslc.where': 'action="' + name + '"', 'oslc.select': 'action,type,parameter' },
        validateStatus: () => true
    });

    const members = (response.data && response.data.member) || [];
    return members.length > 0 ? members[0] : null;
}

// An action launch point creates the action it names, so the test only has to remove it again. An
// action that already exists is left as it is, which is why the test must not create one first.
async function deleteAction(client) {
    return client.deployConfig({ actions: [{ action: ACTION_NAME, _delete: true }] });
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
    name: 'launch-points',
    run: async (client) => {
        try {
            const variables = [
                { varname: 'MATCHLIMIT', description: 'Match limit', varBindingType: 'LITERAL', varType: 'IN', literalDataType: 'INTEGER', varBindingValue: '5' },
                { varname: 'MATCHMODE', description: 'Match mode', varBindingType: 'LITERAL', varType: 'IN', literalDataType: 'ALN', varBindingValue: 'AUTO' }
            ];

            const first = await client.deployScriptSource(
                scriptSource(
                    [
                        {
                            launchPointName: 'NVTEST.LP.SAVE',
                            launchPointType: 'OBJECT',
                            objectName: 'ASSET',
                            description: 'Object save launch point',
                            save: true,
                            add: true,
                            update: false,
                            delete: true,
                            afterCommit: true
                        },
                        {
                            launchPointName: 'NVTEST.LP.ATTRIBUTE',
                            launchPointType: 'ATTRIBUTE',
                            objectName: 'ASSET',
                            attributeName: 'DESCRIPTION',
                            description: 'Attribute validate launch point',
                            validate: true,
                            launchPointVars: [{ varName: 'MATCHLIMIT', varBindingValue: '9' }]
                        },
                        {
                            launchPointName: 'NVTEST.LP.ACTION',
                            launchPointType: 'ACTION',
                            actionName: ACTION_NAME,
                            objectName: 'ASSET',
                            description: 'Action launch point'
                        }
                    ],
                    variables
                ),
                false
            );

            assertEquals(first.status, 'success', 'Deploying the script reported ' + JSON.stringify(first));

            const deployed = await launchPointsOf(client, SCRIPT_NAME);

            assertEquals((deployed.scriptlaunchpoint || []).length, 3, 'Stored launch point count');
            assertEquals((deployed.autoscriptvars || []).length, 2, 'Stored script variable count');

            const save = launchPoint(deployed, 'NVTEST.LP.SAVE');
            assertEquals(String(save.eventtype), '4', 'Object save launch point event type');
            assertEquals(String(save.evcontext), '2', 'Object save launch point event context, for afterCommit');
            assertEquals(Boolean(save.add), true, 'Object save launch point add');
            assertEquals(Boolean(save.update), false, 'Object save launch point update, which was declared false');
            assertEquals(Boolean(save.delete), true, 'Object save launch point delete');

            const attribute = launchPoint(deployed, 'NVTEST.LP.ATTRIBUTE');
            assertEquals(String(attribute.attributeevent), '2', 'Attribute launch point event, for validate');
            assertEquals(String(attribute.attributename).toUpperCase(), 'DESCRIPTION', 'Attribute launch point attribute');

            const action = launchPoint(deployed, 'NVTEST.LP.ACTION');
            assertEquals(String(action.launchpointtype), 'ACTION', 'Action launch point type');

            const bound = await actionRecord(client, ACTION_NAME);
            assertNotNull(bound, 'The action named by the launch point was not found');
            assertEquals(String(bound.type), (await client.synonymMap('ACTIONTYPE')).CUSTOM, 'The action launch point did not convert its action to a script action');
            assertEquals(
                String(bound.parameter),
                SCRIPT_NAME + ',NVTEST.LP.ACTION,' + ACTION_NAME,
                'The action was not bound to the script and launch point'
            );

            // Redeploying with a smaller set proves the previous launch points and variables are
            // removed rather than merged with the new ones.
            const second = await client.deployScriptSource(
                scriptSource(
                    [
                        {
                            launchPointName: 'NVTEST.LP.RESTRICTION',
                            launchPointType: 'ATTRIBUTE',
                            objectName: 'ASSET',
                            attributeName: 'DESCRIPTION',
                            description: 'Attribute access restriction launch point',
                            initializeAccessRestriction: true,
                            initializeValue: true
                        }
                    ],
                    [variables[0]]
                ),
                false
            );

            assertEquals(second.status, 'success', 'Redeploying the script reported ' + JSON.stringify(second));

            const redeployed = await launchPointsOf(client, SCRIPT_NAME);

            assertEquals((redeployed.scriptlaunchpoint || []).length, 1, 'Launch point count after redeploying');
            assertEquals((redeployed.autoscriptvars || []).length, 1, 'Script variable count after redeploying');

            const restriction = launchPoint(redeployed, 'NVTEST.LP.RESTRICTION');
            assertEquals(
                String(restriction.attributeevent),
                '1',
                'A launch point declaring both initializeAccessRestriction and initializeValue is an access restriction'
            );
            // The guard on a launch point that names no attribute used to compare against the
            // string "undefined" and so never fired, letting an incomplete launch point reach
            // Maximo. It has to be reported as a configuration error instead.
            const incomplete = await client.deployScriptSource(
                scriptSource([
                    {
                        launchPointName: 'NVTEST.LP.INCOMPLETE',
                        launchPointType: 'ATTRIBUTE',
                        objectName: 'ASSET',
                        description: 'Attribute launch point naming no attribute',
                        validate: true
                    }
                ]),
                false
            );

            assertEquals(incomplete.status, 'error', 'An attribute launch point without an attributeName was accepted');
            assertEquals(incomplete.reason, 'missing_attribute', 'Rejection reason, got ' + JSON.stringify(incomplete));
        } finally {
            await deleteScript(client, SCRIPT_NAME);
            await deleteAction(client);
        }

        assertEquals(await client.findScript(SCRIPT_NAME), null, 'The script was not removed after the test');
    }
};
