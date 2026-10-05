/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
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
