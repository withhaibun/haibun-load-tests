import { actionOK, intOrError, getStepperOption, findStepperFromOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStepper, IHasOptions, TNamed, TWorld } from '@haibun/core/build/lib/defs.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';

import { StepperClient } from './lib/StepperClient.js';
import { Dispatcher } from './lib/Dispatcher.js';
import { TClientConfig, TDispatchConfig, randomID } from './lib/common.js';

const DISPATCH_ROUTE = '/dispatch';
const RESULTS_ROUTE = '/results';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';

const NUM_TESTS = 'NUM_TESTS';
const MAX_TOTAL_RUNTIME = 'MAX_TOTAL_RUNTIME';
const MAX_CLIENT_RUNTIME = 'MAX_CLIENT_RUNTIME';
const TOKEN = 'TOKEN';
const DISPATCHER_ADDRESS = 'DISPATCHER_ADDRESS';

const HaibunLoadTestsStepper = class HaibunLoadTestsStepper extends AStepper implements IHasOptions {
    dispatchConfig: TDispatchConfig
    clientConfig: TClientConfig;

    options = {
        [NUM_TESTS]: {
            desc: 'Number of tests to run',
            parse: (input: string) => intOrError(input),
        },
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
        [MAX_CLIENT_RUNTIME]: {
            required: false,
            desc: 'Maximum accepted runtime for a client tests, in seconds',
            parse: (input: string) => intOrError(input),
        },
        [MAX_TOTAL_RUNTIME]: {
            required: false,
            desc: 'Maximum total runtime for all tests, in seconds',
            parse: (input: string) => intOrError(input),
        },
        [DISPATCHER_ADDRESS]: {
            required: false,
            desc: 'Address of dispatcher',
            parse: (input: string) => stringOrError(input),
        }
    }
    numTests: number;

    async setWorld(world: TWorld, steppers: AStepper[]) {
        await super.setWorld(world, steppers);
        const tracksStorage = findStepperFromOption<AStorage>(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
        const token = getStepperOption(this, TOKEN, this.getWorld().extraOptions) || randomID();
        this.numTests = parseInt(getStepperOption(this, NUM_TESTS, this.getWorld().extraOptions) || '1', 10);
        const dispatcherAddress = getStepperOption(this, DISPATCHER_ADDRESS, this.getWorld().extraOptions) || 'http://localhost:8123';

        const maxClientTime = parseInt(getStepperOption(this, MAX_CLIENT_RUNTIME, this.getWorld().extraOptions)) || 30;
        this.dispatchConfig = {
            maxClientTime,
            token,
            maxTotalRuntime: parseInt(getStepperOption(this, MAX_TOTAL_RUNTIME, this.getWorld().extraOptions)) || this.numTests * maxClientTime / 3,
            dispatchRoute: DISPATCH_ROUTE,
            resultsRoute: RESULTS_ROUTE
        };

        const defaultDispatchEndpoint = `${dispatcherAddress}${DISPATCH_ROUTE}`;
        const defaultResultsEndpoint = `${dispatcherAddress}${RESULTS_ROUTE}`;

        this.clientConfig = {
            maxClientTime,
            token,
            maxFailures: 10,
            maxClientFailures: 3,
            dispatchEndpoint: defaultDispatchEndpoint,
            resultsEndpoint: defaultResultsEndpoint,
            stepperNames: steppers.map((s) => s.constructor.name),
            tracksStorage
        }
    }

    steps = {
        runLoadTestWithFilter: {
            gwta: 'dispatch load tests with filter {filter} from {where}',
            action: async ({ where, filter }: TNamed) => {
                const dispatcher = new Dispatcher(this.getWorld(), this.dispatchConfig);
                return await dispatcher.runLoadTests(where, this.numTests, filter)
            },
        },
        startLoadTest: {
            gwta: 'dispatch load tests from {where}',
            action: async ({ where }: TNamed) => {
                const dispatcher = new Dispatcher(this.getWorld(), this.dispatchConfig);
                return await dispatcher.runLoadTests(where, this.numTests)
            },
        },
        startClient: {
            gwta: 'start load test client',
            action: async () => {
                const stepperClient = new StepperClient(this.getWorld(), this.clientConfig);
                return await stepperClient.runClient();
            },
        },
        summarizeResults: {
            gwta: 'Summarize load test results',
            action: async () => {
                return actionOK();
            },
        },
    };
}
export default HaibunLoadTestsStepper;
