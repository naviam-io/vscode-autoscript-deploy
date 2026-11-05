/* eslint-disable no-undef */
/*
 * Proves that _retain preserves the customer's publish channel values across a redeployment, at the
 * channel, rule and condition detail levels, and that the values not retained follow the product.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const NAME = 'NVTEST_PC_RETAIN';
const DELETE = { publishChannels: [{ _delete: true, ifaceName: NAME }] };

async function extractChannel(client) {
    const extracted = await client.extract('publishchannels', NAME);
    if (!extracted) {
        throw new Error('Publish channel ' + NAME + ' was not found');
    }
    const rule = extracted.processingRules[0];
    return {
        description: extracted.description,
        storeMsg: extracted.storeMsg,
        controls: (extracted.integrationControls || []).map((control) => control.control).sort().join(','),
        ruleDescription: rule.description,
        ruleEnabled: rule.enabled,
        value: rule.conditions[0].details[0].value
    };
}

export default {
    name: 'publish-channel-retained-values',
    run: async (client) => {
        const fixture = loadFixture('publish-channel-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('publishchannels', NAME), null, 'Publish channel left over from an earlier run');

        try {
            await client.deployConfig(fixture.productV1);
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractChannel(client);
            assertEquals(upgraded.description, 'Customer description', 'Redeploy keeps the customer description');
            assertEquals(upgraded.controls, 'POSEND,WOSTART', 'Redeploy keeps the customer integration controls');
            assertEquals(upgraded.storeMsg, false, 'storeMsg is not retained, so it follows the product');
            assertEquals(upgraded.ruleEnabled, false, 'Redeploy keeps the customer rule enabled flag');
            assertEquals(upgraded.ruleDescription, 'Release 2', 'The rule description is not retained, so it follows the product');
            assertEquals(upgraded.value, 'MISSING', 'Redeploy keeps the customer condition value');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('publishchannels', NAME), null, 'Extract of publish channel "' + NAME + '" after delete');
    }
};
