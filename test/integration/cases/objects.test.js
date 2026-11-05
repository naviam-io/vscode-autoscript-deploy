/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';
import { assertEquals } from '../harness.js';

export default {
    name: 'objects',
    run: async (client) => {
        const options = {
            fixture: 'objects',
            payloadKey: 'objects',
            objectType: 'objects',
            identityProperty: 'object',
            compareFixture: true,
            synonymDomains: { level: 'SITEORGTYPE', 'relationships.cardinality': 'RPTCARDINALITY' },
            ignore: [
                // Database Configuration derives these when it applies the object, until then MAXOBJECTCFG does not hold them.
                'uniqueColumn',
                'triggerRoot',
                'addRowstamp',
                'textSearchEnabled',
                // MAXRELATIONSHIP.ISDEFAULT does not exist before MAS 9.1, verified below instead.
                'relationships.isDefault'
            ],
            verify: (extracted, describe, warnings, infos) => {
                const isDefault = extracted.relationships.find((relationship) => relationship.relationship === 'NVTEST_REL_ASSET').isDefault;
                if (isDefault === undefined) {
                    const mentions = (messages) => messages.some((message) => message.indexOf('MAXRELATIONSHIP.ISDEFAULT') !== -1);
                    assertEquals(mentions(infos), true, 'Deploying ' + describe + ' reported that MAXRELATIONSHIP.ISDEFAULT does not exist');
                } else {
                    assertEquals(isDefault, true, describe + ' relationship isDefault');
                }
            }
        };

        // Deleting an object Database Configuration has not applied only marks it for removal, which
        // extraction treats as gone, so the second pass proves a redeploy restores it.
        await roundTrip(client, options);
        const marked = await client.extractObjectCfg('NVTEST_OBJ');
        assertEquals(marked && marked.changed, 'R', 'The deleted object is marked for removal');
        await roundTrip(client, options);
    }
};
