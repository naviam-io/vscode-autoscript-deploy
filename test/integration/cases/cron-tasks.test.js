/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');

module.exports = {
    name: 'cron-tasks',
    run: async (client) => {
        await roundTrip(client, {
            fixture: 'cron-tasks',
            payloadKey: 'cronTasks',
            objectType: 'crontasks',
            identityProperty: 'cronTaskName',
            synonymDomains: { accessLevel: 'CRONACCESS' },
            compareFixture: true
        });
    }
};
