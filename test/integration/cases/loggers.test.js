/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
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
