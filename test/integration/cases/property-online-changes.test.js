/* eslint-disable no-undef */
/*
 * Proves that a property whose online changes are disabled can still be redeployed. Maximo makes the
 * global value read only once ONLINECHANGES is off, which only governs the System Properties
 * application, so a deployment must still be able to set it.
 */
import { assertEquals } from '../harness.js';

const PROPERTY_NAME = 'TEST_onlinechanges';
const PROPERTY = { propName: PROPERTY_NAME, description: 'Online changes test', propValue: 'first value', onlineChanges: false };
const DELETE = { properties: [{ _delete: true, propName: PROPERTY_NAME }] };

export default {
    name: 'property-online-changes',
    run: async (client) => {
        await client.deployConfig(DELETE);

        try {
            await client.deployConfig({ properties: [PROPERTY] });
            await client.deployConfig({ properties: [PROPERTY] });

            let extracted = await client.extract('properties', PROPERTY_NAME);
            assertEquals(extracted.propValue, 'first value', 'Redeploy of an unchanged property without online changes');
            assertEquals(extracted.onlineChanges, false, 'Online changes stay disabled');

            await client.deployConfig({ properties: [Object.assign({}, PROPERTY, { propValue: 'second value' })] });

            extracted = await client.extract('properties', PROPERTY_NAME);
            assertEquals(extracted.propValue, 'second value', 'Redeploy changes the value of a property without online changes');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('properties', PROPERTY_NAME), null, 'Extract of property "' + PROPERTY_NAME + '" after delete');
    }
};
