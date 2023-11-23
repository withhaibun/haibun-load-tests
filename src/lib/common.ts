import { TSpecl } from "@haibun/core/build/lib/defs.js";
import { THistoryWithMeta } from "@haibun/core/build/lib/interfaces/logger.js";
import { TFeaturesBackgrounds } from "@haibun/core/build/phases/collector.js";
import { AStorage } from "@haibun/domain-storage/build/AStorage.js";

export type TRunMap = { [sequence: number]: { testID: string, startTime: number, clientID: string } }
export type TDispatchConfig = {
    token: string;
    dispatchRoute: string;
    resultsRoute: string;
    maxClientTime: number,
    maxTotalRuntime: number;
}

export type TClientConfig = {
    maxClientTime: number,
    maxClientFailures: number;
    dispatchEndpoint: string;
    token: string;
    resultsEndpoint: string;
    maxFailures: number;
    tracksStorage: AStorage;
    stepperNames: string[];
}

export const randomID = () => [Math.random().toString(36).substring(2, 15), Math.random().toString(36).substring(2, 15)].join('-');

export type TDispatchedTestRunning = {
    testID?: string,
    state: 'running';
    testContext: TTestContext;
    sequence: number;
}

export type TTestContext = { tests: TFeaturesBackgrounds, specl: TSpecl };

export type TDispatchedTest = TDispatchedTestPending | TDispatchedTestRunning | TDispatchedTestEnd;


export type TDispatchedTestPending = {
    state: 'pending'
}
type TDispatchedTestEnd = {
    testID?: string,
    state: 'end';
}

export type TDispatchedResult = {
    token: string,
    testID: string,
    sequence: number,
    historyWithMeta: THistoryWithMeta,
    ok: boolean,
}

export type TDispatchedResultResponse = {
    continue: boolean
}

export type TRunningResult = {
    ok: boolean,
    startTime: number,
    featureTime: number,
    testID: string,
    historyWithMeta: THistoryWithMeta
}