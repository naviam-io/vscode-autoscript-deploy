/* eslint-disable no-undef */
/*
 * Proves that an entry its model rejects fails the deployment before anything in the payload is
 * applied: a query _delete without clauseName must delete nothing, and neither it nor an invalid
 * entry of a later type may let the valid query before it through.
 */
import { assertEquals } from '../harness.js';

const KEEP = 'NVTEST_MISSING_KEY_KEEP';
const NEW = 'NVTEST_MISSING_KEY_NEW';

function query(clauseName) {
    return {
        app: 'AUTOSCRIPT',
        clauseName: clauseName,
        owner: 'MAXADMIN',
        clause: "status = 'ACTIVE'",
        description: 'Missing key test',
        isPublic: true,
        isUserList: false
    };
}

function remove(clauseName) {
    return { _delete: true, app: 'AUTOSCRIPT', clauseName: clauseName, owner: 'MAXADMIN' };
}

async function exists(client, clauseName) {
    return (await client.extract('queries', 'AUTOSCRIPT: ' + clauseName)) !== null;
}

async function deployError(client, payload) {
    try {
        await client.deployConfig(payload);
    } catch (caught) {
        return caught.message;
    }
    return null;
}

export default {
    name: 'missing-key',
    run: async (client) => {
        const cleanup = { queries: [remove(KEEP), remove(NEW)] };

        await client.deployConfig(cleanup);
        assertEquals(await exists(client, KEEP), false, 'Query ' + KEEP + ' left over from an earlier run');

        try {
            await client.deployConfig({ queries: [query(KEEP)] });
            assertEquals(await exists(client, KEEP), true, 'Query ' + KEEP + ' was created');

            assertEquals(
                await deployError(client, { queries: [query(NEW), { _delete: true, app: 'AUTOSCRIPT', owner: 'MAXADMIN' }] }),
                'The query is missing key "clauseName" (app: AUTOSCRIPT, owner: MAXADMIN).',
                'A _delete without clauseName is rejected'
            );
            assertEquals(await exists(client, NEW), false, 'The valid entry beside the rejected one was not applied');
            assertEquals(await exists(client, KEEP), true, 'The rejected _delete removed nothing');

            assertEquals(
                await deployError(client, { queries: [query(NEW)], integrationObjects: [{ intObjectName: 'NVTEST_MISSING_KEY_IO' }] }),
                'The maxIntObjDetail property is required and must an array that contains at least one Maximo Integration Object Detail object.',
                'An integration object without maxIntObjDetail is rejected'
            );
            assertEquals(await exists(client, NEW), false, 'The valid query before the rejected integration object was not applied');
        } finally {
            await client.deployConfig(cleanup);
        }

        assertEquals(await exists(client, KEEP), false, 'Query ' + KEEP + ' after delete');
        assertEquals(await exists(client, NEW), false, 'Query ' + NEW + ' after delete');
    }
};
