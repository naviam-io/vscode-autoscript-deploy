/**
 * Capture reads an existing record into the shape a deployment payload carries, by invoking the
 * extract script rather than reimplementing that shape here.
 */
var ScriptCacheType = Java.type('com.ibm.tivoli.maximo.script.ScriptCache');
var ScriptDriverFactoryType = Java.type('com.ibm.tivoli.maximo.script.ScriptDriverFactory');
var HashMapType = Java.type('java.util.HashMap');

const EXTRACT_SCRIPT = 'NAVIAM.AUTOSCRIPT.OBJECTS';

/**
 * Reads the current configuration of one record as a plain, JSON serialisable object.
 *
 * @param objectType the extract object type, for example 'crontasks'
 * @param uniqueId the unique id of the record, from mbo.getUniqueIDValue()
 * @returns the captured configuration, or null when the record does not exist
 */
export function captureExistingState(objectType: string, uniqueId: any): any {
    if (uniqueId === null || typeof uniqueId === 'undefined') {
        return null;
    }

    // A missing extract script has to fail loudly: retention silently doing nothing would let an
    // upgrade overwrite the customer's values while reporting success.
    if (!ScriptCacheType.getInstance().getScriptInfo(EXTRACT_SCRIPT)) {
        throw new Error(
            'Cannot preserve existing values because the ' +
                EXTRACT_SCRIPT +
                ' script is not installed. Deploy the Maximo Development Tools scripts, then try again.'
        );
    }

    const context = new HashMapType();
    context.put('extractType', objectType);
    context.put('extractId', String(uniqueId));

    ScriptDriverFactoryType.getInstance().getScriptDriver(EXTRACT_SCRIPT).runScript(EXTRACT_SCRIPT, context);

    const captured = context.get('extractResult');

    if (captured === null || typeof captured === 'undefined') {
        return null;
    }

    return JSON.parse(String(captured));
}
