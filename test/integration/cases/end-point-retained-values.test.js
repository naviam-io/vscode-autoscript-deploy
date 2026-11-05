/* eslint-disable no-undef */
/*
 * Proves that _retain preserves the customer's end point property values, an encrypted password
 * included, across a redeployment, and that it has no effect when the end point is first created.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const NAME = 'NVTEST_EP_RETAIN';
const DELETE = { endPoints: [{ _delete: true, endPointName: NAME }] };

async function extractEndPoint(client) {
    const extracted = await client.extract('endpoints', NAME);
    if (!extracted) {
        throw new Error('End point ' + NAME + ' was not found');
    }

    const values = { description: extracted.description };
    (extracted.properties || []).forEach((property) => (values[property.property] = property.value !== undefined ? property.value : property.password));
    return values;
}

export default {
    name: 'end-point-retained-values',
    run: async (client) => {
        const fixture = loadFixture('end-point-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('endpoints', NAME), null, 'End point left over from an earlier run');

        try {
            await client.deployConfig(fixture.productV1);

            const installed = await extractEndPoint(client);
            assertEquals(installed.URL, 'https://example.com/release1', 'First deploy installs the shipped URL');
            assertEquals(installed.PASSWORD, 'Release1Secret', 'First deploy installs the shipped password');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractEndPoint(client);
            assertEquals(upgraded.URL, 'https://customer.example.com/api', 'Redeploy keeps the customer URL');
            assertEquals(upgraded.PASSWORD, 'CustomerSecret1', 'Redeploy keeps the customer password');
            assertEquals(upgraded.HTTPMETHOD, 'GET', 'HTTPMETHOD is not retained, so it follows the product');
            assertEquals(upgraded.description, 'Retained values test, release 2', 'Description is not retained, so it follows the product');

            // A second edit must survive the next upgrade too, and a password the customer cleared stays cleared.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            const upgradedAgain = await extractEndPoint(client);
            assertEquals(upgradedAgain.URL, 'https://customer.example.com/v2', 'A stale snapshot was left behind by the first upgrade');
            assertEquals(upgradedAgain.PASSWORD, '', 'A password the customer cleared stays cleared');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('endpoints', NAME), null, 'Extract of end point "' + NAME + '" after delete');
    }
};
