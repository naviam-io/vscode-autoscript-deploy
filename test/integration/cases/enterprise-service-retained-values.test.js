/* eslint-disable no-undef */
/*
 * Proves that _retain preserves the customer's enterprise service values across a redeployment, at the
 * service, gateway property, rule and condition detail levels, for both kinds of rules, and that the
 * values not retained follow the product.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const NAME = 'NVTEST_ES_RETAIN';
const DELETE = { enterpriseServices: [{ _delete: true, ifaceName: NAME }] };

async function extractService(client) {
    const extracted = await client.extract('enterpriseservices', NAME);
    if (!extracted) {
        throw new Error('Enterprise service ' + NAME + ' was not found');
    }
    const rule = extracted.processingRules[0];
    return {
        description: extracted.description,
        storeMsg: extracted.storeMsg,
        controls: (extracted.integrationControls || []).map((control) => control.control).sort().join(','),
        gatewayValue: extracted.gatewayProperties[0].value,
        ruleDescription: rule.description,
        ruleEnabled: rule.enabled,
        value: rule.conditions[0].details[0].value,
        objectRuleDescription: extracted.objectProcessingRules[0].description,
        objectRuleEnabled: extracted.objectProcessingRules[0].enabled
    };
}

export default {
    name: 'enterprise-service-retained-values',
    run: async (client) => {
        const fixture = loadFixture('enterprise-service-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('enterpriseservices', NAME), null, 'Enterprise service left over from an earlier run');

        try {
            await client.deployConfig(fixture.productV1);
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractService(client);
            assertEquals(upgraded.description, 'Customer description', 'Redeploy keeps the customer description');
            assertEquals(upgraded.controls, 'POSEND,WOSTART', 'Redeploy keeps the customer integration controls');
            assertEquals(upgraded.storeMsg, false, 'storeMsg is not retained, so it follows the product');
            assertEquals(upgraded.gatewayValue, 'Customer value', 'Redeploy keeps the customer gateway property value');
            assertEquals(upgraded.ruleEnabled, false, 'Redeploy keeps the customer rule enabled flag');
            assertEquals(upgraded.ruleDescription, 'Release 2', 'The rule description is not retained, so it follows the product');
            assertEquals(upgraded.value, 'MISSING', 'Redeploy keeps the customer condition value');
            assertEquals(upgraded.objectRuleDescription, 'Customer object rule', 'Redeploy keeps the customer object rule description');
            assertEquals(upgraded.objectRuleEnabled, true, 'The object rule enabled flag is not retained, so it follows the product');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('enterpriseservices', NAME), null, 'Extract of enterprise service "' + NAME + '" after delete');
    }
};
