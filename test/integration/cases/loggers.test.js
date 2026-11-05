/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
    name: 'loggers',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'loggers',
            payloadKey: 'loggers',
            objectType: 'loggers',
            identityProperty: 'logger',
            compareFixture: true
        });
    }
};
