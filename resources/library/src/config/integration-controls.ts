/// <reference path="../../globals.d.ts" />
/// <reference path="../../manage-facade.d.ts" />

import { applyValues, requireKeys, valueOrDefault } from '../core/util';

export function addIntegrationControls(owner: psdi.mbo.MboRemote, relationship: string, controls: MaximoIntegrationControl[]): void {
    const controlSet = owner.getMboSet(relationship);
    controls.forEach(function (control: MaximoIntegrationControl): void {
        applyValues(controlSet.add(), [['IFACECONTROL', control.control]]);
    });
}

export class MaximoIntegrationControl {
    static _keys = ['control'];

    control: string;
    _retain: any = [];

    constructor(input: any) {
        requireKeys(MaximoIntegrationControl, input, 'integration control');
        this.control = input.control;
        this._retain = valueOrDefault(input._retain, this._retain);
    }
}
