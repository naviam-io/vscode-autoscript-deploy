/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
    name: 'messages',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'messages',
            payloadKey: 'messages',
            objectType: 'messages',
            identityProperty: ['msgGroup', 'msgKey'],
            compareFixture: true
        });
    }
};
