import { execSync } from 'child_process';

import { runWith } from '@haibun/core/build/lib/run.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { TDispatchedResult, TDispatchedTest } from '../haibunLoadTests-stepper.js';
import { getDefaultOptions, sleep, actionOK } from '@haibun/core/build/lib/util/index.js';
import { getDefaultWorld } from '@haibun/core/build/lib/test/lib.js';
import { TRACKS_FILE, asHistoryWithMeta } from '@haibun/core/build/lib/LogHistory.js';
import { THistoryWithMeta } from '@haibun/core/build/lib/interfaces/logger.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/domain-storage.js';
import { HAIBUN, TWorld  } from '@haibun/core/build/lib/defs.js';

type TClientArgs = { token: string, dispatchEndpoint: string, resultsEndpoint: string, world: TWorld, maxFailures: number }

export class StepperClient {
    dispatchEndpoint: string;
    token: string;
    resultsEndpoint: string;
    maxFailures: number;
    world: TWorld;
    tracksStorage: AStorage;

    constructor(dispatchEndpoint: string, resultsEndpoint: string, token: string, maxFailures: number, world: TWorld, tracksStorage: AStorage) {
        this.dispatchEndpoint = dispatchEndpoint;
        this.token = token;
        this.resultsEndpoint = resultsEndpoint;
        this.maxFailures = maxFailures;
        this.world = world;
        this.tracksStorage = tracksStorage;
    }
    async runClient() {
        let failures = 0;
        let cont = true;

        while (cont === true) {
            try {
                const task: TDispatchedTest = await this.getTask();
                const { tests, testID, sequence } = task;
                if (tests === undefined) {
                    this.world.logger.log('shutting down');
                    cont = false;
                    break;
                }
                const cmd = `npm run client-test`;
                const env = Object.entries(process.env).reduce((a, [k, v]) => (k.startsWith(HAIBUN) ? a : { ...a, [k]: v }), { HAIBUN_KEY: testID });
                const output = execSync(cmd, {
                    env
                });

                const dir = await this.tracksStorage.ensureCaptureLocation({ ...this.world, mediaType: EMediaTypes.json }, 'tracks', TRACKS_FILE);
                console.log('\n\ndir', dir, output.toString());
                const historyWithMeta: THistoryWithMeta = JSON.parse(this.tracksStorage.readFile(dir, 'utf-8'));
                await this.postResult(historyWithMeta, testID, sequence);
            } catch (e) {
                failures++;
                this.world.logger.error(`failures: ${e}`);
                await sleep(500);
            } finally {
                cont = failures < this.maxFailures;
            }
        }
        return actionOK();
    }

    // FIXME remove this
    async xrunClient({ token, dispatchEndpoint, resultsEndpoint, world, maxFailures }: TClientArgs) {
        let failures = 0;
        let cont = true;

        // run a new instance of haibun-cli in a child process
        while (cont === true) {
            try {
                const task: TDispatchedTest = await (await fetch(`${dispatchEndpoint}?token=${token}`)).json();
                const { tests, testID, sequence } = task;
                console.log('wwx', tests);
                if (tests === undefined) {
                    world.logger.log('shutting down');
                    cont = false;
                    break;
                }
                const { features, backgrounds } = tests;

                const specl = getDefaultOptions();

                const runWorld = getDefaultWorld(sequence).world;
                const startTime = new Date();
                Logger.traceHistory = [];
                const ran = await runWith({ specl, features, backgrounds, world: runWorld });
                console.log('xxw', ran.failure);
                const logHistory = Logger.traceHistory;
                const historyWithMeta = asHistoryWithMeta(logHistory, startTime, `client sequence ${sequence} for test ${testID}`, 0, ran.ok);

                await this.postResult(historyWithMeta, testID, sequence);
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

    async getTask() {
        return await (await fetch(`${this.dispatchEndpoint}?token=${this.token}`)).json();
    }
    async postResult(historyWithMeta: THistoryWithMeta, testID, sequence) {
        const results: TDispatchedResult = {
            token: this.token,
            testID,
            sequence,
            historyWithMeta
        };
        await fetch(this.resultsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(results)
        });
    }

}