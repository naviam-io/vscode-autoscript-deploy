/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
    name: 'queries',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'queries',
            payloadKey: 'queries',
            objectType: 'queries',
            identityProperty: ['app', 'clauseName', 'owner'],
            extractLabel: (item) => item.app + ': ' + item.clauseName,
            compareFixture: true
        });
    }
};
