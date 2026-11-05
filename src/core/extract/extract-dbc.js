import * as fs from 'fs';
import * as path from 'path';

import Logger from '../log.js';

const LOG_SOURCE = 'ExtractDBCCommand';

/**
 * The DBC source types: group is the type Maximo extracts, label and plural name it.
 *
 * @type {ReadonlyArray<{ label: string, group: string, plural: string }>}
 */
export const DBC_TYPES = Object.freeze(
    [
        { label: 'Object Structure', group: 'os', plural: 'Object Structures' },
        { label: 'Table Data', group: 'table', plural: 'Tables' },
        { label: 'Publish Channel', group: 'pc', plural: 'Publish Channels' },
        { label: 'Enterprise Service', group: 'es', plural: 'Enterprise Services' },
        { label: 'Invocation Channel', group: 'ic', plural: 'Invocation Channels' },
        { label: 'Web Service', group: 'ws', plural: 'Web Services' },
        { label: 'End Point', group: 'ep', plural: 'End Points' },
        { label: 'External System', group: 'ex', plural: 'External Systems' },
        { label: 'Interaction', group: 'int', plural: 'Interactions' },
        { label: 'Automation Script', group: 'script', plural: 'Automation Scripts' },
        { label: 'Records by Object Structure', group: 'byos', plural: 'Records by Object Structures' },
        { label: 'Property', group: 'prop', plural: 'Properties' },
        { label: 'Message', group: 'msg', plural: 'Messages' },
        { label: 'Object', group: 'object', plural: 'Objects' },
        { label: 'Attribute', group: 'attribute', plural: 'Attributes' }
    ].map((type) => Object.freeze(type))
);

/**
 * Extracts Maximo configuration as a DBC script and writes it into extractDir.
 *
 * @param {*} client the Maximo client
 * @param {{ group: string, objects: { id: *, label: string }[], fileName: string, where?: string|null, label: string, plural: string }} request
 *        group is the DBC source type; where is the where clause for record types and is built from the
 *        selected ids for messages and attributes
 * @param {string} extractDir an existing folder
 * @returns {Promise<string>} the path written
 */
export async function extractDbc(client, { group, objects, fileName, where = null, label, plural }, extractDir) {
    const objectList = objects.map((obj) => obj.label).join(',');
    const objectListDisplay = objects.map((obj) => obj.label).join(', ');

    if (group === 'msg' || group === 'attribute') {
        where = objects.map((obj) => obj.id).join(',');
    }

    const result = await client.getDBCObject(group, objectList, fileName, where, `Create ${objects.length > 1 ? plural : label} ${objectListDisplay}`);

    if (result && result.status === 'error') {
        Logger.error(`Error extracting DBC: ${result.message}`, null, LOG_SOURCE);
        throw new Error('Error extracting DBC:\n' + result.message);
    }

    const filePath = path.join(extractDir, fileName);
    fs.writeFileSync(filePath, result, 'utf8');
    Logger.info(`DBC extract written to ${filePath}.`, LOG_SOURCE);
    return filePath;
}

/**
 * Replaces the characters a file name cannot hold.
 *
 * @param {string} fileName
 * @returns {string}
 */
export function sanitizeFileName(fileName) {
    return (
        fileName
            // eslint-disable-next-line no-useless-escape
            .replace(/[<>:"|?*\\\/]/g, '_')
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x1f\x80-\x9f]/g, '_') // Control characters
            .replace(/^\.+$/, '_') // Don't allow only dots
            .replace(/\.$/, '_') // Don't end with period
            .trim()
    );
}
