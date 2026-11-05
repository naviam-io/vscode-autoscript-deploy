/* eslint-disable no-undef */
import { assertEquals } from '../harness.js';

// A group's sequence is unique even among members being deleted, and setting its object removes its
// members, so each redeploy must leave exactly the members of the payload at their sequences.
const GROUP = 'NVTEST_AGO_GRP';
const WORKORDER_MEMBER = 'NVTEST_AGO_WOPRI';
const ASSET_MEMBER = 'NVTEST_AGO_ASTPRI';

const MEMBERS = [
    {
        action: WORKORDER_MEMBER,
        description: 'Set work order priority',
        type: '!SETVALUE!',
        useWith: '!ALL!',
        objectName: 'WORKORDER',
        parameter: 'WOPRIORITY',
        value: '1'
    },
    {
        action: ASSET_MEMBER,
        description: 'Set asset priority',
        type: '!SETVALUE!',
        useWith: '!ALL!',
        objectName: 'ASSET',
        parameter: 'PRIORITY',
        value: '1'
    }
];

function group(objectName, members) {
    return {
        action: GROUP,
        description: 'Group whose object changes',
        type: '!GROUP!',
        useWith: '!ALL!',
        objectName: objectName,
        actionGroup: members.map((member, index) => ({ member: member, sequence: index + 1 }))
    };
}

async function assertGroup(client, objectName, members, label) {
    const extracted = await client.extract('actions', GROUP);
    assertEquals(extracted && extracted.objectName, objectName, label + ': object of the group');
    assertEquals(
        JSON.stringify(
            (extracted.actionGroup || [])
                .slice()
                .sort((left, right) => left.sequence - right.sequence)
                .map((row) => row.member + '#' + row.sequence)
        ),
        JSON.stringify(members.map((member, index) => member + '#' + (index + 1))),
        label + ': members of the group'
    );
}

export default {
    name: 'action-group-object',
    run: async (client) => {
        const actions = [GROUP, WORKORDER_MEMBER, ASSET_MEMBER];
        try {
            const steps = [
                ['First deploy', 'WORKORDER', [WORKORDER_MEMBER]],
                ['Member replaced at its sequence', 'WORKORDER', [ASSET_MEMBER]],
                ['Object changed, members kept', 'ASSET', [ASSET_MEMBER]],
                ['Object and members changed together', 'WORKORDER', [WORKORDER_MEMBER]],
                ['Member added', 'WORKORDER', [WORKORDER_MEMBER, ASSET_MEMBER]],
                ['Members swap sequences', 'WORKORDER', [ASSET_MEMBER, WORKORDER_MEMBER]],
                ['Object changed and a member dropped', 'ASSET', [ASSET_MEMBER]]
            ];
            for (const [label, objectName, members] of steps) {
                const payload = label === 'First deploy' ? MEMBERS.concat([group(objectName, members)]) : [group(objectName, members)];
                await client.deployConfig({ actions: payload });
                await assertGroup(client, objectName, members, label);
            }
        } finally {
            await client.deployConfig({ actions: actions.map((action) => ({ _delete: true, action: action })) });
        }

        for (const action of actions) {
            assertEquals(await client.extract('actions', action), null, 'Extract of action "' + action + '" after delete');
        }
    }
};
