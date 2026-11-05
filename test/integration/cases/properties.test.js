/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
    name: 'properties',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'properties',
            payloadKey: 'properties',
            objectType: 'properties',
            identityProperty: 'propName',
            synonymDomains: { secureLevel: 'PROPSECURELEVEL' },
            compareFixture: true
        });
    }
};
