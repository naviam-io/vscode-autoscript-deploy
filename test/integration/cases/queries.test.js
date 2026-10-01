/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
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
