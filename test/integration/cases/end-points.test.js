/* eslint-disable no-undef */
/*
 * Deploys and extracts an HTTP end point, including an encrypted property whose password must
 * extract as the value deployed, then updates it and checks the errors a handler defined property
 * list raises.
 */
import { assertEquals } from '../harness.js';
import { roundTrip } from '../round-trip.js';

const NAME = 'NVTEST_EP_HTTP';

function property(extracted, name) {
    return (extracted.properties || []).find((candidate) => candidate.property === name);
}

async function deployError(client, payload) {
    try {
        await client.deployConfig(payload);
    } catch (caught) {
        return caught.message;
    }
    return null;
}

function assertError(message, expected, describe) {
    if (!message || !message.includes(expected)) {
        throw new Error(describe + ': expected an error containing "' + expected + '", got ' + JSON.stringify(message));
    }
}

export default {
    name: 'end-points',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'end-points',
            payloadKey: 'endPoints',
            objectType: 'endpoints',
            identityProperty: 'endPointName',
            compareFixture: true,
            verify: (extracted, describe) => {
                assertEquals(property(extracted, 'PASSWORD').value, undefined, describe + ' encrypted property has no value');
                assertEquals(property(extracted, 'URL').password, undefined, describe + ' plain property has no password');
                assertEquals(property(extracted, 'HTTPMETHOD').allowOverride, false, describe + ' allowOverride defaults to false');
            }
        });

        const remove = { endPoints: [{ _delete: true, endPointName: NAME }] };
        try {
            await client.deployConfig({
                endPoints: [
                    { endPointName: NAME, description: 'Update test', handlerName: 'HTTP', properties: [{ property: 'URL', value: 'https://example.com/v1' }] }
                ]
            });

            // An update lists only the properties it changes, and leaves the handler unnamed.
            await client.deployConfig({
                endPoints: [
                    { endPointName: NAME, description: 'Updated', properties: [{ property: 'URL', value: 'https://example.com/v2', allowOverride: true }] }
                ]
            });
            const updated = await client.extract('endpoints', NAME);
            assertEquals(updated.description, 'Updated', 'Update changes the description');
            assertEquals(updated.handlerName, 'HTTP', 'Update keeps the handler');
            assertEquals(property(updated, 'URL').value, 'https://example.com/v2', 'Update changes the URL');
            assertEquals(property(updated, 'URL').allowOverride, true, 'Update changes allowOverride');

            assertError(
                await deployError(client, { endPoints: [{ endPointName: NAME, properties: [{ property: 'NVTEST_UNKNOWN', value: 'x' }] }] }),
                'NVTEST_UNKNOWN',
                'A property the handler does not define'
            );
            assertError(
                await deployError(client, { endPoints: [{ endPointName: NAME, properties: [{ property: 'PASSWORD', value: 'x' }] }] }),
                'PASSWORD',
                'A value for an encrypted property'
            );
            assertError(
                await deployError(client, { endPoints: [{ endPointName: NAME, properties: [{ property: 'URL', password: 'x' }] }] }),
                'URL',
                'A password for a plain property'
            );
            assertError(await deployError(client, { endPoints: [{ endPointName: NAME, handlerName: 'JMS' }] }), 'BMXAA0019I', 'Changing the handler');
            assertError(await deployError(client, { endPoints: [{ endPointName: 'NVTEST_EP_NOHANDLER' }] }), 'BMXAA4195E', 'A new end point without a handler');
            assertError(
                await deployError(client, { endPoints: [{ endPointName: 'NVTEST_EP_BADHANDLER', handlerName: 'NVTEST_NOHANDLER' }] }),
                'NVTEST_NOHANDLER',
                'A new end point with an unknown handler'
            );
            assertError(
                await deployError(client, { endPoints: [{ endPointName: NAME, properties: [{ property: 'URL', value: 'x', password: 'y' }] }] }),
                'both value and password',
                'A property with both value and password'
            );
            assertError(
                await deployError(client, {
                    endPoints: [
                        {
                            endPointName: NAME,
                            properties: [
                                { property: 'URL', value: 'x' },
                                { property: 'URL', value: 'y' }
                            ]
                        }
                    ]
                }),
                'more than once',
                'A property listed twice'
            );
            assertEquals(await client.extract('endpoints', 'NVTEST_EP_NOHANDLER'), null, 'A failed create leaves no end point without a handler');
            assertEquals(await client.extract('endpoints', 'NVTEST_EP_BADHANDLER'), null, 'A failed create leaves no end point with an unknown handler');

            assertEquals(
                property(await client.extract('endpoints', NAME), 'URL').value,
                'https://example.com/v2',
                'Failed deploys leave the end point unchanged'
            );
        } finally {
            await client.deployConfig({
                endPoints: [
                    { _delete: true, endPointName: 'NVTEST_EP_NOHANDLER' },
                    { _delete: true, endPointName: 'NVTEST_EP_BADHANDLER' },
                    remove.endPoints[0]
                ]
            });
        }

        assertEquals(await client.extract('endpoints', NAME), null, 'Extract of end point "' + NAME + '" after delete');
    }
};
