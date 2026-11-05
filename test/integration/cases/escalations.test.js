/* eslint-disable no-undef */
import { assertEquals } from '../harness.js';
import { createCommTemplates, deleteCommTemplates } from '../comm-templates.js';
import { roundTrip } from '../round-trip.js';

// The escalation point runs this action group, which the fixture deploys ahead of the escalation.
// The group goes first, so no action is deleted while a group still refers to it.
const ACTIONS = ['TEST_REPORTJOB_GRP', 'TEST_REPORTJOB_HOST'];
const TEMPLATES = ['NVTESTESCBASIC'];

export default {
    name: 'escalations',
    run: async (client) => {
        try {
            await createCommTemplates(client, 'REPORTJOB', TEMPLATES);
            await roundTrip(client, {
                fixture: 'escalations',
                payloadKey: 'escalations',
                objectType: 'escalations',
                identityProperty: 'escalation',
                synonymDomains: { 'escRefPoint.intervalUom': 'ESCTIMEINTERVAL' },
                compareFixture: true
            });
        } finally {
            await client.deployConfig({ actions: ACTIONS.map((action) => ({ _delete: true, action: action })) });
            await deleteCommTemplates(client, TEMPLATES);
        }

        for (const action of ACTIONS) {
            assertEquals(await client.extract('actions', action), null, 'Extract of action "' + action + '" after delete');
        }
    }
};
