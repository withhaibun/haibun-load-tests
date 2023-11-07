import { runWith } from '@haibun/core/build/lib/run.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { TDispatchedResult, TDispatchedTest } from '../haibunLoadTests-stepper.js';
import { getDefaultOptions, sleep, actionOK } from '@haibun/core/build/lib/util/index.js';
import { TWorld } from '@haibun/core/build/lib/defs.js';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { asActionResult, asHistoryWithMeta } from '@haibun/core/build/lib/LogHistory.js';

type TClientArgs = { token: string, dispatchEndpoint: string, resultsEndpoint: string, world: TWorld, maxFailures: number }

export async function runClient({ token, dispatchEndpoint, resultsEndpoint, world, maxFailures }: TClientArgs) {
    let failures = 0;
    let cont = true;

    // run a new instance of haibun-cli in a child process
    while (cont === true) {
        try {
            const task: TDispatchedTest = await (await fetch(`${dispatchEndpoint}?token=${token}`)).json();
            const { tests, testID, sequence } = task;
            if (tests === undefined) {
                world.logger.log('shutting down');
                cont = false;
                break;
            }
            const { features, backgrounds } = tests;

            const specl = getDefaultOptions();

            const runWorld = getDefaultWorld(sequence).world;
            const startTime = new Date();
            const ran = await runWith({ specl, features, backgrounds, world: runWorld });
            const logHistory = Logger.traceHistory;
            const historyWithMeta = asHistoryWithMeta(logHistory, startTime, `client sequence ${sequence} for test ${testID}`, 0, ran.ok);
            const results: TDispatchedResult = {
                token,
                testID,
                sequence,
                historyWithMeta
            };

            await fetch(resultsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(results)
            });
        } catch (e) {
            failures++;
            world.logger.error(`failures: ${e}`);
            await sleep(500);
        } finally {
            cont = failures < maxFailures;
        }
    }
    return actionOK();
}
