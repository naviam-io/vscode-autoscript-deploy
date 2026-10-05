var MXServerType = Java.type('psdi.server.MXServer');

export function close(mboSet: any): void {
    if (mboSet && mboSet instanceof Java.type('psdi.mbo.MboSet')) {
        try {
            mboSet.cleanup();
            mboSet.close();
        } catch (ignored) {
        }
    }
}

export function valueOrDefault<T>(value: T | undefined, defaultValue: T): T {
    return typeof value === 'undefined' ? defaultValue : value;
}

let sseOutput: any = null;
let reportedMissing: Record<string, boolean> = {};

export function configureSse(requestContext?: any): void {
    reportedMissing = {};
    if (!requestContext || typeof requestContext.getHttpServletResponse !== 'function') {
        return;
    }

    const response = requestContext.getHttpServletResponse();
    sseOutput = response.getOutputStream();
    response.setBufferSize(0);
    response.setContentType('text/event-stream');
    response.addHeader('Connection', 'keep-alive');
    response.addHeader('Cache-Control', 'no-cache');
    response.addHeader('X-Accel-Buffering', 'no');
    response.setHeader('Content-Encoding', 'none');
    response.flushBuffer();
}

export function updateProgress(message: string): void {
    writeServerSentEvent('progress', message, 500);
}

export function updateError(message: string): void {
    writeServerSentEvent('error', message, 5000);
}

export function updateWarning(message: string): void {
    writeServerSentEvent('warning', message, 5000);
}

export function updateInfo(message: string): void {
    writeServerSentEvent('info', message, 0);
}

function writeServerSentEvent(event: string, message: string, sleepMillis: number): void {
    if (!sseOutput || !message) {
        return;
    }

    const JavaString = Java.type('java.lang.String');
    const System = Java.type('java.lang.System');
    const Thread = Java.type('java.lang.Thread');
    const payload = 'id: ' + System.currentTimeMillis() + '\n' + 'event: ' + event + '\n' + 'data: ' + message + '\n\n';

    sseOutput.write(new JavaString(payload).getBytes('UTF-8'));
    sseOutput.flush();
    Thread.sleep(sleepMillis);
}

export function hasAttribute(mbo: psdi.mbo.MboRemote, field: string): boolean {
    const objectName = mbo.getName();
    if (MXServerType.getMXServer().getMaximoDD().getMboSetInfo(objectName).getMboValueInfo(field) != null) {
        return true;
    }

    const key = objectName + '.' + field;
    if (!reportedMissing[key]) {
        reportedMissing[key] = true;
        updateInfo('Skipped ' + key + ', the attribute does not exist in this Maximo version.');
    }
    return false;
}

export function setValue(mbo: psdi.mbo.MboRemote, field: string, value: any, accessModifier?: any): void {
    if (typeof value === 'undefined') {
        return;
    }

    if (!hasAttribute(mbo, field)) {
        return;
    }

    if (value === null) {
        if (typeof accessModifier !== 'undefined') {
            mbo.setValueNull(field, accessModifier);
        } else {
            mbo.setValueNull(field);
        }
        return;
    }

    if (typeof accessModifier !== 'undefined') {
        mbo.setValue(field, value, accessModifier);
    } else {
        mbo.setValue(field, value);
    }
}

export function applyValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        setValue(mbo, update[0], update[1]);
    });
}

export function applyWritableValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (isWritable(mbo, update[0])) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function applyOptionalWritableValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (update[1] !== null && typeof update[1] !== 'undefined' && isWritable(mbo, update[0])) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function applyOptionalValues(mbo: psdi.mbo.MboRemote, updates: Array<[string, any]>): void {
    updates.forEach(function (update) {
        if (update[1] !== null) {
            setValue(mbo, update[0], update[1]);
        }
    });
}

export function isWritable(mbo: psdi.mbo.MboRemote, field: string): boolean {
    return hasAttribute(mbo, field) && !(mbo as any).getMboValue(field).isReadOnly();
}

/**
 * The internal value of a synonym domain field written as !VALUE!, or null for a plain localized value.
 * A value that starts with ! is reserved for this syntax. See docs/modules/nashorn-library.md.
 */
export function parseInternalValue(value: any): string | null {
    if (typeof value !== 'string' || value.charAt(0) !== '!') {
        return null;
    }

    const match = /^!([^!]+)!$/.exec(value);
    if (!match) {
        throw new Error('The value "' + value + '" is not valid. A value that starts with ! must be an internal value written as !VALUE!, for example !MAXTABLE!.');
    }

    return match[1];
}

/**
 * The value to set on a synonym domain field: a plain localized value unchanged, an internal value
 * resolved to the target server's default localized value.
 */
export function toExternalSynonymValue(domainId: string, value: any, mbo?: psdi.mbo.MboRemote): any {
    const internalValue = parseInternalValue(value);
    if (internalValue === null) {
        return value;
    }

    let external: any = null;
    try {
        const translator = MXServerType.getMXServer().getMaximoDD().getTranslator();
        external = mbo ? translator.toExternalDefaultValue(domainId, internalValue, mbo) : translator.toExternalDefaultValue(domainId, internalValue);
    } catch (ignored) {
        external = null;
    }

    if (external === null || typeof external === 'undefined' || String(external) === '') {
        throw new Error('The value "' + value + '" is not valid. ' + internalValue + ' is not an internal value of the ' + domainId + ' synonym domain.');
    }

    return String(external);
}

/** The internal value of a synonym domain field, whichever form it is written in, for logic that depends on it. */
export function toInternalSynonymValue(domainId: string, value: any, mbo?: psdi.mbo.MboRemote): any {
    const internalValue = parseInternalValue(value);
    if (internalValue !== null) {
        return internalValue;
    }

    if (value === null || typeof value === 'undefined' || value === '') {
        return value;
    }

    try {
        const translator = MXServerType.getMXServer().getMaximoDD().getTranslator();
        const internal = mbo ? translator.toInternalString(domainId, value, mbo) : translator.toInternalString(domainId, value);
        return internal === null || typeof internal === 'undefined' || String(internal) === '' ? value : String(internal);
    } catch (ignored) {
        return value;
    }
}
