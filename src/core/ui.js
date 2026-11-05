/*
 * The port through which core operations report progress and ask the user to decide. The extension
 * implements it with VS Code dialogs (src/vscode-ui.js); the CLI answers decisions from its options.
 * See docs/modules/core.md.
 */

/**
 * @typedef {object} Progress
 * @property {(update: { message?: string, increment?: number }) => void} report
 *
 * @typedef {object} CancelToken
 * @property {boolean} isCancellationRequested
 * @property {(listener: () => any) => any} onCancellationRequested
 *
 * @typedef {object} Ui
 * @property {<T>(options: { title: string, cancellable?: boolean }, task: (progress: Progress, token: CancelToken) => PromiseLike<T>) => PromiseLike<T>} withProgress
 * @property {(message: string, options?: { detail?: string }) => PromiseLike<unknown>} error modal error
 * @property {(message: string, options?: { modal?: boolean }) => PromiseLike<unknown>} info information, modal unless modal is false
 * @property {(decision: string, message: string, options: { actions: string[], severity?: 'info'|'warning', detail?: string }) => PromiseLike<string|undefined>} choose
 *     a modal question; resolves to the chosen action, or undefined when dismissed
 * @property {(ms: number) => Promise<void>} pause a cosmetic delay so a notification can be read; a host may skip it
 */

/** What a choose() call is deciding, so a non-interactive host can answer from its options. */
export const Decision = Object.freeze({
    ADMIN_MODE: 'adminMode',
    DISABLE_ESIG: 'disableEsig',
    SNAPSHOT_LOOKUP_FAILED: 'snapshotLookupFailed',
    RETAINED_SNAPSHOT: 'retainedSnapshot',
    OVERWRITE: 'overwrite'
});
