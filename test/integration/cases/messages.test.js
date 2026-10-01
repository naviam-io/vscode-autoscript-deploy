/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
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
