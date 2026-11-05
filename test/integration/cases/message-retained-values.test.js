/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed message values across a redeployment, and that it
 * has no effect when the message is first created.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const MESSAGE_LABEL = 'NVTEST:RETAINMSG';
const DELETE = { messages: [{ _delete: true, msgGroup: 'NVTEST', msgKey: 'RETAINMSG' }] };

async function extractMessage(client) {
    const extracted = await client.extract('messages', MESSAGE_LABEL);
    if (!extracted) {
        throw new Error('Message ' + MESSAGE_LABEL + ' was not found');
    }

    return extracted;
}

export default {
    name: 'message-retained-values',
    run: async (client) => {
        const fixture = loadFixture('message-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('messages', MESSAGE_LABEL), null, 'Message left over from an earlier run');

        try {
            // Release 1 already declares _retain, which must not stop a new message receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractMessage(client);
            assertEquals(installed.value, 'Retained values test, release 1', 'First deploy installs the shipped value');
            assertEquals(installed.options.join(','), 'ok', 'First deploy installs the shipped options');
            assertEquals(installed.explanation, 'Release 1 explanation', 'First deploy installs the shipped explanation');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractMessage(client);
            assertEquals(upgraded.value, 'Text written by the customer', 'Redeploy keeps the customer value');
            assertEquals(upgraded.options.join(','), 'yes,no', 'Redeploy keeps the customer options');
            assertEquals(upgraded.explanation, 'Explanation written by the customer', 'Redeploy keeps the customer explanation');
            assertEquals(upgraded.displayMethod, 'STATUS', 'displayMethod is not retained, so it follows the product');
            assertEquals(upgraded.adminResponse, 'Release 2 admin response', 'adminResponse is not retained, so it follows the product');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it. Clearing
            // the explanation also proves a retained value the customer emptied stays empty.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            const upgradedAgain = await extractMessage(client);
            assertEquals(upgradedAgain.value, 'Second text written by the customer', 'A stale snapshot was left behind by the first upgrade');
            assertEquals(upgradedAgain.options.join(','), 'close', 'Redeploy keeps the second customer options');
            assertEquals(upgradedAgain.explanation, undefined, 'Explanation the customer cleared stays cleared');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('messages', MESSAGE_LABEL), null, 'Extract of message "' + MESSAGE_LABEL + '" after delete');
    }
};
