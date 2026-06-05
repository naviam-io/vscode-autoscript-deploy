var runtimeGlobals = this as {
    javaType?: <T>(className: string) => T;
};

runtimeGlobals.javaType = function javaType<T>(className: string): T {
    return Java.type<any>(className) as T;
};
