/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
    name: 'integration-objects',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'integration-objects',
            payloadKey: 'integrationObjects',
            objectType: 'integrationobjects',
            identityProperty: 'intObjectName',
            synonymDomains: { useWith: 'INTUSEWITH' },
            compareFixture: true
        });
    }
};
