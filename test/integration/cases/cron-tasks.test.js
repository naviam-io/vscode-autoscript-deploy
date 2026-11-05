/* eslint-disable no-undef */
import { roundTrip } from '../round-trip.js';

export default {
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
