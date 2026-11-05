// @ts-nocheck
import { window, commands } from 'vscode';
import isValidHostname from 'is-valid-hostname';

/**
 * Describes the first required connection setting that is missing or invalid, or returns null.
 */
export function findSettingsProblem(maximoConfig) {
    const host = maximoConfig.host;
    const userName = maximoConfig.username;
    const port = maximoConfig.port;
    const apiKey = maximoConfig.apiKey;

    if (!host) {
        return { message: 'The Maximo host is missing', action: 'set it now?' };
    }

    if (!isValidHostname(host)) {
        return { message: 'The Maximo host is invalid', action: 'fix it now?' };
    }

    if (port < 0 || port > 65535) {
        return { message: 'The Maximo port must be between 0 and 65535', action: 'fix it now?' };
    }

    if (!userName && !apiKey) {
        return { message: 'The Maximo user name is missing and an API Key was not provided', action: 'set it now?' };
    }

    return null;
}

export function validateSettings(maximoConfig) {
    const problem = findSettingsProblem(maximoConfig);
    if (!problem) {
        return true;
    }

    window.showInformationMessage(`${problem.message}, ${problem.action}`, { modal: true }, ...['Yes']).then((response) => {
        if (response === 'Yes') {
            commands.executeCommand('workbench.action.openSettings', 'maximo');
        }
    });
    return false;
}
