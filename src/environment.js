// @ts-nocheck

/**
 * Picks the selected environment from the contents of .devtools-config.json: a single environment,
 * the only entry of a list, or the entry marked selected.
 *
 * @param {Array|Object|null|undefined} list
 * @returns {Object|null}
 */
function findSelectedEnvironment(list) {
    if (!list) {
        return null;
    }
    if (Array.isArray(list)) {
        if (list.length === 0) {
            return null;
        }
        if (list.length === 1) {
            return list[0];
        }
        return list.find((e) => e.selected) || null;
    }
    if (typeof list === 'object' && Object.keys(list).length > 0) {
        return list;
    }
    return null;
}

/**
 * Merges the selected environment with the naviam.* settings. See docs/modules/extension-src.md.
 *
 * @param {Object|null} selected
 * @param {{ get: (key: string) => any }} settings
 * @returns {Object}
 */
function resolveEnvironment(selected, settings) {
    const env = selected || {};
    const useSSL = typeof env.useSSL !== 'undefined' ? env.useSSL : (settings.get('maximo.useSSL') ?? true);

    return {
        name: env.name,
        description: env.description,
        host: env.host ?? settings.get('maximo.host'),
        port: env.port ?? settings.get('maximo.port') ?? (useSSL ? 443 : 80),
        useSSL,
        context: env.context ?? settings.get('maximo.context') ?? 'maximo',
        username: env.username ?? settings.get('maximo.user'),
        password: env.password,
        apiKey: typeof env.password !== 'undefined' ? env.apiKey : (env.apiKey ?? settings.get('maximo.apiKey')),
        maxauthOnly: typeof env.maxauthOnly !== 'undefined' ? env.maxauthOnly : (settings.get('maximo.maxauthOnly') ?? false),
        allowUntrustedCerts: typeof env.allowUntrustedCerts !== 'undefined' ? env.allowUntrustedCerts : settings.get('maximo.allowUntrustedCerts'),
        timeout: env.timeout ?? settings.get('maximo.timeout'),
        configurationTimeout: env.configurationTimeout ?? settings.get('maximo.configurationTimeout'),
        ca: env.ca ?? settings.get('maximo.customCA'),
        extractLocation: env.extractLocation ?? settings.get('maximo.extractLocation'),
        extractLocationScreens: env.extractLocationScreens ?? settings.get('maximo.extractScreenLocation'),
        extractLocationForms: env.extractLocationForms ?? settings.get('maximo.extractInspectionFormsLocation'),
        extractLocationReports: env.extractLocationReports ?? settings.get('maximo.extractReportsLocation'),
        extractLocationDBC: env.extractLocationDBC ?? settings.get('maximo.extractDBCLocation'),
        proxyHost: env.proxyHost ?? settings.get('maximo.proxy.host'),
        proxyPort: env.proxyPort ?? settings.get('maximo.proxy.port'),
        proxyUsername: env.proxyUsername ?? settings.get('maximo.proxy.user'),
        proxyPassword: env.proxyPassword ?? settings.get('maximo.proxy.password'),
        debugPort: env.debugPort ?? settings.get('maximo.debugPort')
    };
}

module.exports = { findSelectedEnvironment, resolveEnvironment };
