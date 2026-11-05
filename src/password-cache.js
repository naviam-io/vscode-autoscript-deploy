// @ts-nocheck

/**
 * Holds the password of one environment for the session, so the user is not asked again for every
 * command. It is only returned for the host, port, context and user it was entered or read for, so
 * it is never sent to another environment.
 */
function createPasswordCache() {
    let owner;
    let value;
    const ownerOf = (env) => JSON.stringify([env.host, env.port, env.context, env.username]);

    return {
        get(env) {
            return owner === ownerOf(env) ? value : undefined;
        },
        set(env, password) {
            owner = ownerOf(env);
            value = password;
        },
        clear() {
            owner = undefined;
            value = undefined;
        }
    };
}

module.exports = { createPasswordCache };
