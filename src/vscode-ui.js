/*
 * The core UI port on VS Code: see docs/modules/core.md.
 */
import { window, ProgressLocation } from 'vscode';

/** @type {import('./core/ui.js').Ui} */
const vscodeUi = {
    withProgress({ title, cancellable = false }, task) {
        return window.withProgress({ title, cancellable, location: ProgressLocation.Notification }, task);
    },

    error(message, { detail } = {}) {
        return window.showErrorMessage(message, { modal: true, detail });
    },

    info(message, { modal = true } = {}) {
        return window.showInformationMessage(message, { modal });
    },

    choose(decision, message, { actions, severity = 'info', detail }) {
        const options = { modal: true, detail };
        return severity === 'warning'
            ? window.showWarningMessage(message, options, ...actions)
            : window.showInformationMessage(message, options, ...actions);
    },

    pause(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};

export default vscodeUi;
