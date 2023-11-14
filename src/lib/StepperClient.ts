import { exec } from 'child_process';

import { runWith } from '@haibun/core/build/lib/run.js';
import Logger from '@haibun/core/build/lib/Logger.js';
import { getDefaultOptions, sleep, actionOK } from '@haibun/core/build/lib/util/index.js';
import { getCreateSteppers, getDefaultWorld, testWithDefaults } from '@haibun/core/build/lib/test/lib.js';
import { TRACKS_FILE, asHistoryWithMeta } from '@haibun/core/build/lib/LogHistory.js';
import { THistoryWithMeta } from '@haibun/core/build/lib/interfaces/logger.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { EMediaTypes } from '@haibun/domain-storage/build/domain-storage.js';
import { AStepper, HAIBUN, TWorld } from '@haibun/core/build/lib/defs.js';
import { TFeaturesBackgrounds } from '@haibun/core/build/phases/collector.js';

import { TDispatchedResult, TDispatchedTest, TTestContext } from '../haibunLoadTests-stepper.js';

export class StepperClient {
    dispatchEndpoint: string;
    token: string;
    resultsEndpoint: string;
    maxFailures: number;
    world: TWorld;
    tracksStorage: AStorage;
    steppers: AStepper[];
    stepperNames: any;

    constructor(dispatchEndpoint: string, resultsEndpoint: string, token: string, maxFailures: number, world: TWorld, tracksStorage: AStorage, steppers: AStepper[]) {
        this.dispatchEndpoint = dispatchEndpoint;
        this.token = token;
        this.resultsEndpoint = resultsEndpoint;
        this.maxFailures = maxFailures;
        this.world = world;
        this.tracksStorage = tracksStorage;
        this.stepperNames = steppers.map((s) => s.constructor.name);
    }
    async runClient() {
        let failures = 0;
        let cont = true;

        while (cont === true) {
            await sleep(900);
            try {
                const task: TDispatchedTest = await this.getTask();
                console.log('tt', task.state);
                if (task.state === 'pending') {
                    continue;
                } else if (task.state === 'end') {
                    this.world.logger.log('shutting down');
                    cont = false;
                    continue;
                }
                const { testContext: testContext, testID, sequence } = task;
                const startTime = new Date();
                const { ok, logHistory } = await this.runTest(testContext, sequence, testID);
                const historyWithMeta = asHistoryWithMeta(logHistory, startTime, `client sequence ${sequence} for test ${testID}`, 0, ok);

                await this.postResult(historyWithMeta, testID, sequence);
            } catch (e) {
                failures++;
                console.error(e);
                this.world.logger.error(`failure: ${e}`);
                if (failures >= this.maxFailures) {
                    cont = false;
                    this.world.logger.info(`shutdown due to ${failures} failures`);
                };
            } finally {
            }
        }
        return actionOK();
    }

    async runTest(testContext: TTestContext, sequence: number, testID: string) {
        const { features, backgrounds } = testContext.tests;
        const { specl } = testContext;

        const extraOptions = {
            ...this.world.extraOptions,
            HAIBUN_O_OUTREVIEWS_TRACKS_STORAGE: 'StorageFS',
        }
        // delete extraOptions.HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TOKEN;
        // delete extraOptions.HAIBUN_O_OUTREVIEWS_STORAGE;
        // delete extraOptions.HAIBUN_O_HAIBUNLOADTESTSSTEPPER_TRACKS_STORAGE;

        const world = getDefaultWorld(sequence).world;
        world.extraOptions = extraOptions;
        console.log('kk',);
        const { ok, tag, shared, topics, featureResults, failure } = await runWith({ specl, world, features, backgrounds }).catch(e => { console.error(e); throw (e); });
        console.log('kk2', ok);
        console.log('xxw', ok, failure);
        const logHistory = Logger.traceHistory;
        Logger.traceHistory = [];
        return { logHistory, ok };
    }

    private async execTest(folder: string, sequence: number, testID: string) {
        const cmd = `npm run ${folder}`;
        const env = Object.entries(process.env).reduce((a, [k, v]) => (k.startsWith(HAIBUN) ? a : { ...a, [k]: v }), { HAIBUN_KEY: testID });

        const child = exec(cmd, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
            console.error(`stderr: ${stderr}`);
        });

        child.stdout.on('data', (data) => {
            console.log(data);
        });

        child.stderr.on('data', (data) => {
            console.error(data);
        });

        await new Promise((resolve, reject) => {
            child.on('close', (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    reject(`Command failed with exit code ${code}`);
                }
            });
        }).catch((e) => {
            console.error(e);
            throw e;
        });

        const dir = await this.tracksStorage.ensureCaptureLocation({ ...this.world, mediaType: EMediaTypes.json }, 'tracks', TRACKS_FILE);
        console.log('\n\ndir', dir);
        const historyWithMeta: THistoryWithMeta = JSON.parse(this.tracksStorage.readFile(dir, 'utf-8'));
        return historyWithMeta;
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