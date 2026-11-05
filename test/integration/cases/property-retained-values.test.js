/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed property values across a redeployment, including
 * the values of property instances, which are deleted and recreated on every deployment, and that
 * it has no effect when the property is first created.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const PROPERTY_NAME = 'TEST_retainprop';
const DELETE = { properties: [{ _delete: true, propName: PROPERTY_NAME }] };

async function extractProperty(client) {
    const extracted = await client.extract('properties', PROPERTY_NAME);
    if (!extracted) {
        throw new Error('Property ' + PROPERTY_NAME + ' was not found');
    }

    return extracted;
}

function instanceOn(extracted, serverName) {
    const instances = extracted.maxPropInstance || [];
    for (let index = 0; index < instances.length; index++) {
        if (instances[index].serverName === serverName) {
            return instances[index];
        }
    }

    return null;
}

function instanceValue(extracted, serverName) {
    const instance = instanceOn(extracted, serverName);
    if (!instance) {
        throw new Error('Extracted property has no instance on server ' + serverName);
    }

    return instance.propValue;
}

export default {
    name: 'property-retained-values',
    run: async (client) => {
        const fixture = loadFixture('property-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('properties', PROPERTY_NAME), null, 'Property left over from an earlier run');

        try {
            // Release 1 already declares _retain, which must not stop a new property receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractProperty(client);
            assertEquals(installed.propValue, 'release 1 value', 'First deploy installs the shipped value');
            assertEquals(installed.onlineChanges, undefined, 'First deploy installs the shipped onlineChanges, which extract omits as the default');
            assertEquals(instanceValue(installed, 'TESTSERVER'), 'release 1 instance value', 'First deploy installs the shipped instance value');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractProperty(client);
            assertEquals(upgraded.propValue, 'value set by the customer', 'Redeploy keeps the customer value');
            assertEquals(upgraded.onlineChanges, false, 'Redeploy keeps the customer onlineChanges');
            assertEquals(upgraded.description, 'Retained values test, release 2', 'description is not retained, so it follows the product');
            assertEquals(upgraded.maximoDefault, 'release 2 default', 'maximoDefault is not retained, so it follows the product');
            assertEquals(instanceValue(upgraded, 'TESTSERVER'), 'instance value set by the customer', 'Recreated instance keeps the customer value');
            assertEquals(instanceValue(upgraded, 'TESTSERVER2'), 'release 2 new instance value', 'New instance gets the shipped value');

            // The product payload never mentions CUSTOMERSERVER. It survives only because the property
            // declares _retain: ["maxPropInstance"].
            assertEquals(instanceValue(upgraded, 'CUSTOMERSERVER'), 'instance added by the customer', 'Customer added instance survives');
            assertEquals(instanceOn(upgraded, 'CUSTOMERSERVER').serverHost, 'customerhost', 'Customer added instance keeps its host');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it. Clearing
            // the value also proves a retained value the customer emptied stays empty.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            const upgradedAgain = await extractProperty(client);
            assertEquals(upgradedAgain.propValue, '', 'Value the customer cleared stays cleared');
            assertEquals(upgradedAgain.onlineChanges, undefined, 'A stale snapshot was left behind by the first upgrade');
            assertEquals(
                instanceValue(upgradedAgain, 'TESTSERVER'),
                'second instance value set by the customer',
                'Recreated instance keeps the second customer value'
            );
            assertEquals(instanceOn(upgradedAgain, 'CUSTOMERSERVER'), null, 'Instance the customer removed stays removed');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('properties', PROPERTY_NAME), null, 'Extract of property "' + PROPERTY_NAME + '" after delete');
    }
};
