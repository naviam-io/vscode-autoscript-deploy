/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
    name: 'actions',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'actions',
            payloadKey: 'actions',
            objectType: 'actions',
            identityProperty: 'action',
            compareFixture: true
        });
    }
};
