/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
    name: 'actions',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'actions',
            payloadKey: 'actions',
            objectType: 'actions',
            identityProperty: 'action',
            synonymDomains: { type: 'ACTIONTYPE', useWith: 'ACTIONUSEWITH' },
            compareFixture: true
        });
    }
};
