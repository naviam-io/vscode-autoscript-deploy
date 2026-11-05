/* eslint-disable no-undef */
import { assertEquals } from '../harness.js';

// Changing an action's type recreates it, because Maximo does not let the type of an action change.
const ACTION = 'NVTEST_ACTION_TYPE';

async function extractAction(client) {
    const extracted = await client.extract('actions', ACTION);
    if (!extracted) {
        throw new Error('Action ' + ACTION + ' was not found');
    }

    return extracted;
}

export default {
    name: 'action-type-change',
    run: async (client) => {
        const types = await client.synonymMap('ACTIONTYPE');
        try {
            await client.deployConfig({
                actions: [
                    {
                        action: ACTION,
                        description: 'Action whose type changes',
                        type: '!SETVALUE!',
                        useWith: '!ALL!',
                        objectName: 'WORKORDER',
                        parameter: 'WOPRIORITY',
                        value: '1'
                    }
                ]
            });
            assertEquals((await extractAction(client)).type, types.SETVALUE, 'First deploy installs the SETVALUE action');

            await client.deployConfig({
                actions: [
                    {
                        action: ACTION,
                        description: 'Action whose type changes',
                        type: '!CHANGESTATUS!',
                        useWith: '!ALL!',
                        objectName: 'WORKORDER',
                        value: 'APPR'
                    }
                ]
            });

            const changed = await extractAction(client);
            assertEquals(changed.type, types.CHANGESTATUS, 'Redeploy changes the action type');
            assertEquals(changed.parameter, undefined, 'The recreated action drops the old parameter');
            assertEquals(changed.value, 'APPR', 'The recreated action has the new value');
        } finally {
            await client.deployConfig({ actions: [{ _delete: true, action: ACTION }] });
        }

        assertEquals(await client.extract('actions', ACTION), null, 'Extract of action "' + ACTION + '" after delete');
    }
};
