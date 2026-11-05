import fs from 'fs';

export const DEFAULT_SETTINGS_FILE = './settings.json';

export const DEFAULT_SETTINGS = Object.freeze({
    allowUntrustedCerts: false,
    apikey: undefined,
    ca: undefined,
    context: 'maximo',
    maxauth: false,
    host: undefined,
    password: undefined,
    port: undefined,
    ssl: true,
    key: undefined,
    timeout: 30,
    username: undefined,
    install: true,
    deploy: Object.freeze({
        allowAdminMode: false,
        allowEsigDisable: false,
        retainedSnapshots: undefined,
        file: undefined,
        recursive: true,
        directory: './',
        deleteAll: false,
        deleteList: 'delete.json',
        configurationTimeout: 5
    }),
    log: Object.freeze({
        timeout: 30
    }),
    extract: Object.freeze({
        directory: './',
        overwrite: true,
        type: 'script',
        name: undefined,
        file: undefined,
        dbcType: undefined,
        where: undefined,
        object: undefined
    })
});

const SECTIONS = ['deploy', 'log', 'extract'];

/**
 * Overlays settings on the defaults; the command sections are merged key by key.
 */
export function mergeSettings(defaults, overrides) {
    const merged = { ...defaults, ...overrides };
    for (const section of SECTIONS) {
        merged[section] = { ...defaults[section], ...(overrides && typeof overrides[section] === 'object' ? overrides[section] : {}) };
    }
    return merged;
}

/**
 * Reads the settings file. A missing file is only an error when it was named explicitly.
 *
 * @returns {{ settings: object, settingsFile: string | undefined }}
 */
export function loadSettings(settingsPath, { explicit }) {
    if (!settingsPath || !fs.existsSync(settingsPath)) {
        if (explicit) {
            throw new Error(`The settings file ${settingsPath} cannot be read.`);
        }
        return { settings: mergeSettings(DEFAULT_SETTINGS, {}), settingsFile: undefined };
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`The settings file ${settingsPath} exists, but is not a valid JSON format.`);
        }
        throw new Error(`An error occurred reading ${settingsPath}, ${error.message}`);
    }

    return { settings: mergeSettings(DEFAULT_SETTINGS, parsed), settingsFile: settingsPath };
}
