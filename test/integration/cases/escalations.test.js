/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
    name: 'escalations',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'escalations',
            payloadKey: 'escalations',
            objectType: 'escalations',
            identityProperty: 'escalation',
            compareFixture: true
        });
    }
};
