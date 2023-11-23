import { runWith } from '@haibun/core/build/lib/run.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { sleep, actionOK } from '@haibun/core/build/lib/util/index.js';
import { getDefaultWorld, } from '@haibun/core/build/lib/test/lib.js';
import { AStepper, TExtraOptions, TWorld } from '@haibun/core/build/lib/defs.js';

import { TClientConfig, TDispatchedResult, TDispatchedTest, TTestContext, randomID } from './common.js';
import { THistoryWithMeta } from '@haibun/core/build/lib/interfaces/logger.js';
import { asHistoryWithMeta } from '@haibun/core/build/lib/LogHistory.js';

export class StepperClient {
    world: TWorld;
    steppers: AStepper[];
    stepperNames: any;
    clientConfig: TClientConfig;
    clientID = randomID()

    constructor(world: TWorld, clientConfig: TClientConfig) {
        this.world = world;
        this.clientConfig = clientConfig;
    }
    async runClient() {
        let failures = 0;
        let cont = true;

        while (cont === true) {
            await sleep(200);
            try {
                const task: TDispatchedTest = await this.getTask();
                if (task.state === 'pending') {
                    continue;
                } else if (task.state === 'end') {
                    this.world.logger.log('shutting down');
                    cont = false;
                    continue;
                }
                const { testContext: testContext, testID, sequence } = task;
                const startTime = new Date();
                const { ok, logHistory } = await this.runTest(testContext, sequence);
                const historyWithMeta = asHistoryWithMeta(logHistory, startTime, `client sequence ${sequence} for test ${testID}`, 0, ok);

                cont = await this.postResult({ historyWithMeta, ok, testID, sequence });
            } catch (e) {
                failures++;
                this.world.logger.error(`failure: ${e}`);
                if (failures >= this.clientConfig.maxFailures) {
                    cont = false;
                    this.world.logger.info(`shutdown due to ${failures} failures`);
                };
            } finally {
            }
        }
        return actionOK();
    }

    async runTest(testContext: TTestContext, sequence: number) {
        const { features, backgrounds } = testContext.tests;
        const { specl } = testContext;

        const extraOptions: TExtraOptions = {
            ...this.world.extraOptions,
            HAIBUN_O_OUTREVIEWS_TRACKS_STORAGE: 'StorageFS',
        }
        // delete extraOptions.HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TOKEN;
        // delete extraOptions.HAIBUN_O_OUTREVIEWS_STORAGE;
        // delete extraOptions.HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TRACKS_STORAGE;
        extraOptions.HAIBUN_O_WEBPLAYWRIGHT_STORAGE = 'StorageFS';

        const world = getDefaultWorld(sequence).world;
        world.extraOptions = extraOptions;
        const { ok, tag, shared, topics, featureResults, failure } = await runWith({ specl, world, features, backgrounds }).catch(e => { console.error(e); throw (e); });
        const logHistory = Logger.traceHistory;
        Logger.traceHistory = [];
        return { logHistory, ok };
    }

    async getTask() {
        const res = (await fetch(`${this.clientConfig.dispatchEndpoint}?token=${this.clientConfig.token}&clientID=${this.clientID}`));
        const payload = await res.json();
        return payload;
    }
    async postResult(result: { historyWithMeta: THistoryWithMeta, ok: boolean, testID: string, sequence: number }) {
        const results: TDispatchedResult = {
            token: this.clientConfig.token,
            ...result
        };
        const res = await fetch(this.clientConfig.resultsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(results)
        });
        const { continue: cont } = await res.json();
        return cont;
    }
}
