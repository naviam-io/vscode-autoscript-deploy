/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed query values across a redeployment, and that it
 * has no effect when the query is first created.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const QUERY_LABEL = 'AUTOSCRIPT: NVTEST_RETAIN_QUERY';
const DELETE = { queries: [{ _delete: true, app: 'AUTOSCRIPT', clauseName: 'NVTEST_RETAIN_QUERY', owner: 'MAXADMIN' }] };

async function extractQuery(client) {
    const extracted = await client.extract('queries', QUERY_LABEL);
    if (!extracted) {
        throw new Error('Query ' + QUERY_LABEL + ' was not found');
    }

    return extracted;
}

export default {
    name: 'query-retained-values',
    run: async (client) => {
        const fixture = loadFixture('query-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('queries', QUERY_LABEL), null, 'Query left over from an earlier run');

        try {
            // Release 1 already declares _retain, which must not stop a new query receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractQuery(client);
            assertEquals(installed.clause, "status = 'ACTIVE'", 'First deploy installs the shipped clause');
            assertEquals(installed.notes, 'Release 1 notes', 'First deploy installs the shipped notes');
            assertEquals(installed.priority, 1, 'First deploy installs the shipped priority');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractQuery(client);
            assertEquals(upgraded.clause, "status = 'DRAFT'", 'Redeploy keeps the customer clause');
            assertEquals(upgraded.notes, 'Notes written by the customer', 'Redeploy keeps the customer notes');
            assertEquals(upgraded.priority, 5, 'Redeploy keeps the customer priority');
            assertEquals(upgraded.description, 'Retained values test, release 2', 'Description is not retained, so it follows the product');
            assertEquals(upgraded.isPublic, false, 'isPublic is not retained, so it follows the product');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it. Clearing
            // the notes also proves a retained value the customer emptied stays empty.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            const upgradedAgain = await extractQuery(client);
            assertEquals(upgradedAgain.clause, "status = 'INACTIVE'", 'A stale snapshot was left behind by the first upgrade');
            assertEquals(upgradedAgain.notes, undefined, 'Notes the customer cleared stay cleared');
            assertEquals(upgradedAgain.priority, 7, 'Redeploy keeps the second customer priority');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('queries', QUERY_LABEL), null, 'Extract of query "' + QUERY_LABEL + '" after delete');
    }
};
