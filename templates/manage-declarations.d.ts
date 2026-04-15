declare module manage {
    export class Array<T> {
        constructor();
        length: number;
        [index: number]: T;
    }
}
