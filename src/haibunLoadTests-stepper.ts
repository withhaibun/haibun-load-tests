import { actionNotOK, actionOK, getFromRuntime, asError, intOrError, getStepperOption, findStepperFromOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { TFeaturesBackgrounds, getFeaturesAndBackgrounds } from '@haibun/core/build/phases/collector.js';
import { IRequest, IResponse, IWebServer, TRequestHandler, WEBSERVER } from '@haibun/web-server-express/build/defs.js';
import { AStepper, IHasOptions, TNamed, TWorld } from '@haibun/core/build/lib/defs.js';
import { THistoryWithMeta } from '@haibun/core/build/lib/interfaces/logger.js';
import { StepperClient } from './lib/StepperClient.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';

const DISPATCH_ROUTE = '/dispatch';
const RESULTS_ROUTE = '/results';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';

const defaultBase = 'http://localhost:8123';

const defaultDispatchEndpoint = `${defaultBase}${DISPATCH_ROUTE}`;
const defaultResultsEndpoint = `${defaultBase}${RESULTS_ROUTE}`;

const randomID = () => [Math.random().toString(36).substring(2, 15), Math.random().toString(36).substring(2, 15)].join('-');

export type TDispatchedTest = {
    token: string,
    testID?: string,
    tests: TFeaturesBackgrounds,
    sequence: number
}

export type TDispatchedResult = {
    token: string,
    testID: string,
    sequence: number,
    historyWithMeta: THistoryWithMeta
}

const MAX_TOTAL_RUNTIME = 'MAX_TOTAL_RUNTIME';
const TOKEN = 'TOKEN';

type TRunMap = { [sequence: number]: { testID: string, startTime: number, clientID: string } }

const HaibunLoadTestsStepper = class HaibunLoadTestsStepper extends AStepper implements IHasOptions {
    toDelete: { [name: string]: string } = {};
    totalTests: number = 0;
    dispatchedTests: number = 0;
    completedTests: TDispatchedResult[] = [];
    tests: TFeaturesBackgrounds;
    maxTotalRuntime = 60 * 2;
    maxClientTime = 20;
    maxClientFailures: number = 3;
    runTime: number = 0;
    token = randomID();
    startTime: Date;
    interval: NodeJS.Timeout;
    testMap: TRunMap = {};
    tracksStorage: AStorage;
    stepperClient: StepperClient;

    options = {
        [STORAGE]: {
            desc: 'General storage type',
            parse: (input: string) => stringOrError(input),
        },
        [TRACKS_STORAGE]: {
            required: true,
            altSource: 'STORAGE',
            desc: 'Storage type used for histories',
            parse: (input: string) => stringOrError(input),
        },
        [TOKEN]: {
            required: false,
            desc: 'Secret token for client auth',
            parse: (input: string) => stringOrError(input),
        },
        [MAX_TOTAL_RUNTIME]: {
            required: false,
            desc: 'Maximum total runtime for all tests, in seconds',
            parse: (input: string) => intOrError(input),

        }
    }

    async close() {
        //
    }

    async setWorld(world: TWorld, steppers: AStepper[]) {
        await super.setWorld(world, steppers);
        this.maxTotalRuntime = parseInt(getStepperOption(this, MAX_TOTAL_RUNTIME, this.getWorld().extraOptions)) || this.maxTotalRuntime;
        this.token = getStepperOption(this, TOKEN, this.getWorld().extraOptions) || this.token;
        this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
        this.stepperClient = new StepperClient(defaultDispatchEndpoint, defaultResultsEndpoint, this.token, this.maxClientFailures, this.getWorld(), this.tracksStorage);
    }

    // receive client requests for more work. if all tests are run, tell client to terminate.
    dispatch: TRequestHandler = async (req: IRequest, res: IResponse) => {
        const token = <string>req.query.token;
        if (!this.checkToken(token, res)) {
            return;
        }
        const testID = randomID();
        if (this.shouldContinue()) {
            const sequence = this.dispatchedTests;
            this.testMap[sequence] = { testID, startTime: new Date().getTime(), clientID: req.ip };
            this.dispatchedTests++;
            const task: TDispatchedTest = {
                token,
                testID,
                sequence,
                tests: this.tests
            };
            res.end(JSON.stringify(task));
            return;
        }
        res.end(JSON.stringify({ token, tests: undefined }));
    }
    // receive results from clients and add to running results
    results: TRequestHandler = async (req: IRequest, res: IResponse) => {
        const response = req.body;
        const { token, sequence, testID, historyWithMeta }: { sequence: number, token: string, testID: string, historyWithMeta: THistoryWithMeta } = req.body;
        if (!this.checkToken(token, res)) {
            return;
        }
        if (!testID || this.testMap[sequence]?.testID !== testID) {
            this.getWorld().logger.error(`testID ${testID} vs ${this.testMap[sequence]?.testID} doesn't match sequence ${sequence}`);
            res.status(500).end(JSON.stringify({ continue: this.shouldContinue() }));
            return;
        }
        this.getWorld().logger.log(`results ${historyWithMeta.meta.ok}`);
        console.log(`results ${JSON.stringify(historyWithMeta, null, 2)}`);
        this.completedTests.push(response);
        res.status(200).end(JSON.stringify({ continue: this.shouldContinue() }));
    }
    steps = {
        runLoadTestWithFilter: {
            gwta: 'start load tests with filter {filter} for {totalTests} tests from {where}',
            action: async ({ where, totalTests, filter }: TNamed) => {
                return await this.runLoadTests(where, totalTests, filter)
            },
        },
        startLoadTest: {
            gwta: 'start load tests for {totalTests} tests from {where}',
            action: async ({ where, totalTests }: TNamed) => {
                return await this.runLoadTests(where, totalTests);
            },
        },
        startClient: {
            //'Start load test client using dispatch endpoint and results endpoint
            gwta: 'start load test client',
            action: async () => {
                return await this.stepperClient.runClient();
            },
        },
        summarizeResults: {
            gwta: 'Summarize load test results',
            action: async () => {
                return actionOK();
            },
        },
    };
    async runLoadTests(where: string, totalTests: string, filter = '') {
        const webserver: IWebServer = getFromRuntime(this.getWorld().runtime, WEBSERVER);
        if (!webserver) return actionNotOK('webserver not found', { error: asError('webserver not found') });

        try {
            webserver.addRoute('get', DISPATCH_ROUTE, this.dispatch);
            webserver.addRoute('post', RESULTS_ROUTE, this.results);
        } catch (error) {
            return actionNotOK('runLoadTests', { error: asError(error) });
        }
        this.totalTests = parseInt(totalTests, 10);
        this.tests = HaibunLoadTestsStepper.getTests(where, filter);

        const startTime = new Date();
        this.interval = setInterval(() => {
            this.runTime = (new Date().getTime() - startTime.getTime()) / 1000;
        }, 500);

        return actionOK();
    }
    static getTests(where, filter) {
        return getFeaturesAndBackgrounds([where], [filter]);
    }
    shouldContinue() {
        return this.completedTests.length < this.totalTests && this.runTime < this.maxTotalRuntime;
    }
    checkToken(token: string, res: IResponse) {
        if (token !== this.token) {
            res.status(403).end(JSON.stringify({ token, tests: undefined }));
            this.getWorld().logger.error(`token mismatch: ${token} !== ${this.token}`);
            return false;
        }
        return true;
    }
};

export default HaibunLoadTestsStepper;
