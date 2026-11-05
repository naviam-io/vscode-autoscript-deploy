import { isManifestDocument, isInspectionFormDocument } from '../deploy/manifest-planner.js';

/**
 * The kinds of configuration that can be extracted as JSON: the label shown, the group the records
 * sit under in a configuration file, and how extracted records sort and replace existing ones.
 */
export const CONFIGURATION_TYPES = Object.freeze([
    {
        label: 'Actions',
        group: 'actions',
        sort: (a, b) => a.action.localeCompare(b.action),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.action === b.action))];
        },
    },
    {
        label: 'Cron Tasks',
        group: 'cronTasks',
        sort: (a, b) => a.cronTaskName.localeCompare(b.cronTaskName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.cronTaskName === b.cronTaskName))];
        },
    },
    {
        label: 'End Points',
        group: 'endPoints',
        sort: (a, b) => a.endPointName.localeCompare(b.endPointName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.endPointName === b.endPointName))];
        },
    },
    {
        label: 'Enterprise Services',
        group: 'enterpriseServices',
        sort: (a, b) => a.ifaceName.localeCompare(b.ifaceName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.ifaceName === b.ifaceName))];
        },
    },
    {
        label: 'External Systems',
        group: 'externalSystems',
        sort: (a, b) => a.extSysName.localeCompare(b.extSysName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.extSysName === b.extSysName))];
        },
    },
    {
        label: 'Escalations',
        group: 'escalations',
        sort: (a, b) => a.escalation.localeCompare(b.escalation),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.escalation === b.escalation))];
        },
    },
    {
        label: 'Domains',
        group: 'domains',
        sort: (a, b) => a.domainId.localeCompare(b.domainId),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.domainId === b.domainId))];
        },
    },
    {
        label: 'Integration Objects',
        group: 'integrationObjects',
        sort: (a, b) => a.intObjectName.localeCompare(b.intObjectName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.intObjectName === b.intObjectName))];
        },
    },
    {
        label: 'Loggers',
        group: 'loggers',
        sort: (a, b) => a.logger.localeCompare(b.logger),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.logger === b.logger))];
        },
    },
    {
        label: 'Messages',
        group: 'messages',
        sort: (a, b) => {
            const groupCompare = a.msgGroup.localeCompare(b.msgGroup);
            if (groupCompare !== 0) return groupCompare;
            return a.msgKey.localeCompare(b.msgKey);
        },
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.msgGroup === b.msgGroup && a.msgKey === b.msgKey))];
        },
    },
    {
        label: 'Objects',
        group: 'objects',
        sort: (a, b) => a.object.localeCompare(b.object),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.object === b.object))];
        },
    },
    {
        label: 'Properties',
        group: 'properties',
        sort: (a, b) => a.propName.localeCompare(b.propName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.propName === b.propName))];
        },
    },
    {
        label: 'Publish Channels',
        group: 'publishChannels',
        sort: (a, b) => a.ifaceName.localeCompare(b.ifaceName),
        filter: (a1, a2) => {
            return [...a1, ...a2.filter((b) => !a1.some((a) => a.ifaceName === b.ifaceName))];
        },
    },
    {
        label: 'Queries',
        group: 'queries',
        sort: (a, b) => {
            const appCompare = a.app.localeCompare(b.app);
            if (appCompare !== 0) return appCompare;
            const nameCompare = a.clauseName.localeCompare(b.clauseName);
            if (nameCompare !== 0) return nameCompare;
            return a.owner.localeCompare(b.owner);
        },
        filter: (a1, a2) => {
            return [
                ...a1,
                ...a2.filter((b) => !a1.some((a) => a.app === b.app && a.clauseName === b.clauseName && a.owner === b.owner)),
            ];
        },
    },
]);

/**
 * Fetches the detail of each selected record.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {{ label: string, group: string }} type one of CONFIGURATION_TYPES
 * @param {{ id: * }[]} items the records, as listed by getObjectList
 * @returns {Promise<{ results: object[], cancelled: boolean }>}
 */
export async function fetchConfiguration(client, ui, type, items) {
    const results = [];
    let cancelled = false;

    await ui.withProgress({ title: `Extracting ${type.label}`, cancellable: true }, async (progress, token) => {
        const total = items.length;
        const increment = Math.round(100 / total);
        let i = 0;

        for (const item of items) {
            if (token.isCancellationRequested) {
                cancelled = true;
                break;
            }

            const result = await client.getObjectDetail(type.group.toLowerCase(), item.id);
            if (result != null) {
                results.push(result);
            }

            i++;
            progress.report({ increment, message: `${i} of ${total}` });
        }
    });

    return { results, cancelled };
}

/**
 * Merges extracted records into the text of a configuration file, replacing records with the same
 * identity and keeping the rest.
 *
 * @param {string} existingText the file's text, empty when it does not exist
 * @param {{ group: string, sort?: Function, filter?: Function }} type one of CONFIGURATION_TYPES
 * @param {object[]} results the extracted records
 * @returns {string|null} the new text, or null when the file is not a configuration file the records can go in
 */
export function mergeConfiguration(existingText, type, results) {
    if (isBlank(existingText)) {
        return JSON.stringify({ [type.group]: results }, null, 4);
    }

    let json;
    try {
        json = JSON.parse(existingText);
    } catch {
        return null;
    }

    if (isManifestDocument(json) || isInspectionFormDocument(json)) {
        return null;
    }

    if (json[type.group]) {
        if (!Array.isArray(json[type.group])) {
            return null;
        }
        json[type.group] = typeof type.filter === 'function' ? type.filter(results, json[type.group]) : [...json[type.group], ...results];
        if (typeof type.sort === 'function') {
            json[type.group].sort(type.sort);
        }
    } else {
        json[type.group] = results;
    }

    return JSON.stringify(sortObjectKeys(json), null, 4);
}

function isBlank(str) {
    return !str || /^\s*$/.test(str);
}

function sortObjectKeys(obj) {
    const sorted = {};
    Object.keys(obj)
        .sort()
        .forEach((key) => {
            sorted[key] = obj[key];
        });
    return sorted;
}
