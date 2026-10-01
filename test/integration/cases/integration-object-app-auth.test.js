/* eslint-disable no-undef */
/*
 * Proves that object application authorization (OBJECTAPPAUTH) records are merged, not owned.
 *
 * OBJECTAPPAUTH is a global table keyed by context and object name, with no relationship to an
 * object structure, so several object structures can declare the same record. Deploying one adds or
 * updates the record, redeploying must not fail on the existing record, and deleting an object
 * structure must leave the record for the others.
 */
const { assertEquals } = require('../harness');
const { loadFixture } = require('../round-trip');

const CONTEXT = '/nvtest/appauth';
// A second context for the same object, declared by the same detail.
const SECOND_CONTEXT = '/nvtest/appauth2';
// An out of the box object structure with a PERSON detail, to observe the record once ours are gone.
const OBSERVER = 'MXPERSON';
// An out of the box object structure for another object, whose extraction must not include the record.
const UNRELATED = 'MXAPIMESSAGE';
const DEPLOY_SCRIPT_NAME = 'NVTEST.APPAUTH.CLEANUP';

function appAuth(extracted, context = CONTEXT) {
    if (!extracted) {
        throw new Error('The object structure was not extracted');
    }

    const auths = extracted.maxIntObjDetail[0].objectAppAuth || [];
    const matches = auths.filter((auth) => auth.context === context);
    return matches.length > 0 ? matches[0] : null;
}

// Nothing in the deployment format deletes an OBJECTAPPAUTH record, which is the point of this test.
async function deleteAppAuth(client) {
    const source = [
        'var scriptConfig = {',
        '    "autoscript": "' + DEPLOY_SCRIPT_NAME + '",',
        '    "description": "Object application authorization test cleanup",',
        '    "status": "Active"',
        '};',
        "var MXServer = Java.type('psdi.server.MXServer');",
        "var set = MXServer.getMXServer().getMboSet('OBJECTAPPAUTH', MXServer.getMXServer().getSystemUserInfo());",
        'try {',
        "    set.setWhere(\"context in ('" + CONTEXT + "', '" + SECOND_CONTEXT + "')\");",
        '    set.deleteAll();',
        '    set.save();',
        '} finally {',
        '    set.close();',
        '}'
    ].join('\n');

    const response = await client.runDeployScript(source);
    assertEquals(response && response.status, 'success', 'Cleanup of the OBJECTAPPAUTH records reported ' + JSON.stringify(response));
}

module.exports = {
    name: 'integration-object-app-auth',
    run: async (client) => {
        const fixture = loadFixture('integration-object-app-auth');

        try {
            await client.deployConfig(fixture.first);
            let auth = appAuth(await client.extract('integrationobjects', 'TEST_APPAUTH_A'));
            assertEquals(auth && auth.authApp, 'PERSON', 'Record added by the first object structure');
            assertEquals(auth.description, 'Set by A', 'Description added by the first object structure');
            const second = appAuth(await client.extract('integrationobjects', 'TEST_APPAUTH_A'), SECOND_CONTEXT);
            assertEquals(second && second.authApp, 'PERSONGR', 'Second context added by the same detail');
            assertEquals(second.description, 'Second context', 'Description of the second context');
            assertEquals(appAuth(await client.extract('integrationobjects', UNRELATED)), null, 'Record extracted for another object');

            // A second object structure declaring the same context and object updates the shared record.
            await client.deployConfig(fixture.second);
            auth = appAuth(await client.extract('integrationobjects', 'TEST_APPAUTH_A'));
            assertEquals(auth && auth.authApp, 'PERSONGR', 'Shared record updated by the second object structure');
            assertEquals(auth.description, 'Set by B', 'Shared description updated by the second object structure');

            // Redeploying replaces the object structure; the existing record must be updated, not added again,
            // and a description the payload omits is left as it was.
            await client.deployConfig(fixture.noDescription);
            auth = appAuth(await client.extract('integrationobjects', 'TEST_APPAUTH_A'));
            assertEquals(auth && auth.authApp, 'PERSON', 'Record updated by the redeployment');
            assertEquals(auth.description, 'Set by B', 'Omitted description overwrote the shared description');

            await client.deployConfig(fixture.delete);
            assertEquals(await client.extract('integrationobjects', 'TEST_APPAUTH_A'), null, 'TEST_APPAUTH_A after delete');
            assertEquals(await client.extract('integrationobjects', 'TEST_APPAUTH_B'), null, 'TEST_APPAUTH_B after delete');

            auth = appAuth(await client.extract('integrationobjects', OBSERVER));
            assertEquals(auth && auth.authApp, 'PERSON', 'Record kept after its object structures were deleted');
            assertEquals(appAuth(await client.extract('integrationobjects', OBSERVER), SECOND_CONTEXT) !== null, true, 'Second context kept after delete');
        } finally {
            await client.deployConfig(fixture.delete);
            await deleteAppAuth(client);
        }

        const observed = await client.extract('integrationobjects', OBSERVER);
        assertEquals(appAuth(observed), null, 'Record after cleanup');
        assertEquals(appAuth(observed, SECOND_CONTEXT), null, 'Second context after cleanup');
        assertEquals(await client.findScript(DEPLOY_SCRIPT_NAME), null, 'The cleanup script was left installed in Maximo');
    }
};
