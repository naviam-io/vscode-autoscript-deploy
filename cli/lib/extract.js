/*
 * The extract command: lists what Maximo has of a type, selects it by name and hands it to the core
 * extractor the extension uses. See docs/flows/cli.md.
 */
import fs from 'fs';
import path from 'path';

import { extractScripts } from '../../src/core/extract/extract-scripts.js';
import { extractScreens } from '../../src/core/extract/extract-screens.js';
import { extractForms } from '../../src/core/extract/extract-forms.js';
import { extractReports } from '../../src/core/extract/extract-reports.js';
import { fetchConfiguration, mergeConfiguration } from '../../src/core/extract/extract-configuration.js';
import { DBC_TYPES, extractDbc } from '../../src/core/extract/extract-dbc.js';
import { findConfigurationType } from './configuration.js';
import { describeError } from './deploy.js';

const labels = (items) => items.map((item) => item.label);

const FILE_TYPES = {
    script: {
        singular: 'automation script',
        plural: 'automation scripts',
        list: (client) => client.getAllScriptNames(),
        extract: (client, ui, items, directory) => extractScripts(client, ui, labels(items), directory)
    },
    screen: {
        singular: 'screen definition',
        plural: 'screen definitions',
        list: (client) => client.getAllScreenNames(),
        extract: (client, ui, items, directory) => extractScreens(client, ui, labels(items), directory)
    },
    form: {
        singular: 'inspection form',
        plural: 'inspection forms',
        list: (client) => client.getFormNames(),
        extract: (client, ui, items, directory) => extractForms(client, ui, items, directory)
    },
    report: {
        singular: 'report',
        plural: 'reports',
        list: (client) => client.getReportNames(),
        extract: (client, ui, items, directory) => extractReports(client, ui, items, directory)
    }
};

/**
 * The items with one of the names, matched case-insensitively against what Maximo calls them; all items when no names are given.
 *
 * @returns {{ selected: any[], missing: string[] }}
 */
export function selectByName(items, names) {
    if (!names || names.length === 0) {
        return { selected: [...items], missing: [] };
    }

    const wanted = names.map((name) => name.toLowerCase());
    const namesOf = (item) => [item.label, item.reportName, item.name].filter((value) => typeof value === 'string').map((value) => value.toLowerCase());
    const selected = items.filter((item) => namesOf(item).some((name) => wanted.includes(name)));
    const missing = names.filter((name) => !selected.some((item) => namesOf(item).includes(name.toLowerCase())));
    return { selected, missing };
}

/**
 * @param {*} client
 * @param {import('../../src/core/ui.js').Ui} ui
 * @param {object} config
 * @param {{ out?: (text: string) => void }} [options]
 * @returns {Promise<{ failed: number }>}
 */
export async function runExtract(client, ui, config, { out = (text) => process.stdout.write(text + '\n') } = {}) {
    const type = String(config.type).toLowerCase();

    if (FILE_TYPES[type]) {
        return await extractFiles(client, ui, config, FILE_TYPES[type], out);
    }
    if (type === 'dbc') {
        return await extractDbcFile(client, ui, config, out);
    }
    return await extractConfiguration(client, ui, config, findConfigurationType(type), out);
}

async function select(ui, items, names, plural, out) {
    if (!Array.isArray(items) || items.length === 0) {
        out(`No ${plural} were found.`);
        return { selected: [], failed: names.length > 0 ? 1 : 0 };
    }

    const { selected, missing } = selectByName(items, names);
    if (missing.length > 0) {
        await ui.error(`No ${plural} were found named ${missing.join(', ')}.`);
    }
    return { selected, failed: missing.length };
}

async function extractFiles(client, ui, config, type, out) {
    const { selected, failed } = await select(ui, await type.list(client), config.name, type.plural, out);
    if (selected.length === 0) {
        return { failed };
    }

    fs.mkdirSync(config.directory, { recursive: true });
    const result = await type.extract(client, ui, selected, config.directory);
    for (const failure of result.failures) {
        await ui.error(`The ${type.singular} ${failure.name} could not be extracted.`, { detail: failure.message });
    }
    if (!result.cancelled) {
        out(`${result.extracted} of ${selected.length} ${selected.length > 1 ? type.plural : type.singular} extracted to ${config.directory}.`);
    }
    return { failed: failed + result.failures.length + (result.cancelled ? 1 : 0) };
}

async function extractConfiguration(client, ui, config, type, out) {
    const target = config.file ? path.resolve(config.directory, config.file) : path.join(config.directory, `${type.group}.json`);
    if (config.overwrite === false && fs.existsSync(target)) {
        out(`${target} exists and --overwrite is false, so nothing was extracted.`);
        return { failed: 0 };
    }

    const { selected, failed } = await select(ui, await client.getObjectList(type.group), config.name, type.label.toLowerCase(), out);
    if (selected.length === 0) {
        return { failed };
    }

    const { results, cancelled } = await fetchConfiguration(client, ui, type, selected);
    if (cancelled) {
        return { failed: failed + 1 };
    }

    const merged = mergeConfiguration(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', type, results);
    if (merged === null) {
        await ui.error(`${target} is not a configuration file the ${type.label.toLowerCase()} can be added to.`);
        return { failed: failed + 1 };
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, merged, 'utf8');
    out(`${results.length} ${type.label.toLowerCase()} extracted to ${target}.`);

    const empty = selected.length - results.length;
    if (empty > 0) {
        await ui.error(`${empty} of ${selected.length} ${type.label.toLowerCase()} returned nothing from Maximo.`);
    }
    return { failed: failed + empty };
}

async function extractDbcFile(client, ui, config, out) {
    const type = DBC_TYPES.find((candidate) => candidate.group === config.dbcType);
    const target = path.resolve(config.directory, config.file);
    if (config.overwrite === false && fs.existsSync(target)) {
        out(`${target} exists and --overwrite is false, so nothing was extracted.`);
        return { failed: 0 };
    }

    const items = type.group === 'attribute' ? await client.getDBCAttributeList(config.object) : await client.getDBCObjectList(type.group);
    const { selected, failed } = await select(ui, items, config.name, type.plural.toLowerCase(), out);
    if (selected.length === 0) {
        return { failed };
    }

    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await ui.withProgress({ title: 'DBC', cancellable: false }, async (progress) => {
            progress.report({ message: `Extracting ${selected.length} ${(selected.length > 1 ? type.plural : type.label).toLowerCase()} to ${target}` });
            await extractDbc(
                client,
                { group: type.group, objects: selected, fileName: path.basename(target), where: config.where || null, label: type.label, plural: type.plural },
                path.dirname(target)
            );
        });
    } catch (error) {
        await ui.error(describeError(error));
        return { failed: failed + 1 };
    }

    out(`Extracted ${selected.map((item) => item.label).join(', ')} to ${target}.`);
    return { failed };
}
