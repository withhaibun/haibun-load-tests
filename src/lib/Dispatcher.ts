import { TWorld } from "@haibun/core/build/lib/defs.js";
import { getFromRuntime, actionNotOK, asError, sleep, actionOK } from "@haibun/core/build/lib/util/index.js";
import { getConfigFromBase } from "@haibun/core/build/lib/util/workspace-lib.js";
import { getFeaturesAndBackgrounds } from "@haibun/core/build/phases/collector.js";
import { IWebServer, WEBSERVER, IResponse, IRequest, TRequestHandler } from "@haibun/web-server-express/build/defs.js";
import { TDispatchConfig, TDispatchedResult, TDispatchedTestRunning, TRunMap, TRunningResult, TTestContext, randomID } from "./common.js";
import { TArtifactMessageContext, TBasicMessageContext } from "@haibun/core/build/lib/interfaces/logger.js";

export class Dispatcher {
    startTime = new Date();
    dispatchConfig: TDispatchConfig;
    totalTests: number;
    world: TWorld;
    runTime: number;
    testMap: TRunMap = {};
    dispatchedTests: number = 0;
    testContext: TTestContext;
    runningResults: { [name: string]: TRunningResult } = {};
    cycles = 0;
    redispatch = 0;

    constructor(world: TWorld, dispatchConfig: TDispatchConfig) {
        this.world = world;
        this.dispatchConfig = dispatchConfig;
    }
    async runLoadTests(where: string, totalTests: number, filter = '') {
        const webserver: IWebServer = getFromRuntime(this.world.runtime, WEBSERVER);
        if (!webserver) return actionNotOK('webserver not found', { error: asError('webserver not found') });
        this.testContext = Dispatcher.getTest(where, filter);

        try {
            webserver.addRoute('get', this.dispatchConfig.dispatchRoute, this.dispatch);
            webserver.addRoute('post', this.dispatchConfig.resultsRoute, this.results);
        } catch (error) {
            return actionNotOK('runLoadTests', { error: asError(error) });
        }
        this.totalTests = totalTests;

        this.world.logger.info(`started load tests for ${this.totalTests} tests from ${where}`);

        try {
            while (this.shouldContinue()) {
                await sleep(200);
                this.removeStaleTests();
            }
            const summarized = this.summarizeCompletedResults();
            const summary = JSON.stringify(summarized);
            const html = `<table border="1"><tr>${Object.keys(summarized).map(key => `<th>${key}</th>`).join('')}</tr><tr>${Object.values(summarized).map(value => `<td>${value}</td>`).join('')}</tr></table>`;
            this.world.logger.info('finis', <TArtifactMessageContext>{ topic: { event: 'request', stage: 'endFeature' }, artifact: { type: 'html', content: html, }, tag: this.world.tag });
            const topics = { metrics: { summary, report: { html: summarized.toString() } } };

            return actionOK(topics);
        } catch (error) {
            return actionNotOK('runLoadTests', { error: asError(error) });
        }
    }
    removeStaleTests() {
        const now = new Date().getTime();
        Object.entries(this.testMap).map(([sequence, running]) => {
            if (now - running.startTime > this.dispatchConfig.maxClientTime * 1000) {
                delete this.testMap[sequence];
                this.world.logger.info(`removed stale test ${sequence}`);
            }
        });
    }
    summarizeCompletedResults() {
        const totalRunTime = (new Date().getTime() - this.startTime.getTime()) / 1000;
        const { passed, clientRunTime } = Object.values(this.runningResults).reduce((acc, result) => ({
            passed: result.ok ? acc.passed + 1 : acc.passed,
            clientRunTime: acc.clientRunTime + result.featureTime
        }), { passed: 0, clientRunTime: 0 });
        const numCompleted = this.completed();
        const average = totalRunTime / numCompleted;
        const summarized = { numCompleted, totalRunTime, average, passed, failed: numCompleted - passed, redispatch: this.redispatch };
        this.world.logger.info(`finished load tests ${summarized}`);
        return summarized;
    }
    static getTest(where, filter) {
        const tests = getFeaturesAndBackgrounds([where], [filter]);
        const specl = getConfigFromBase([where]);
        return { specl, tests };
    }
    shouldContinue() {
        this.cycles++;
        if (this.cycles % 500 === 0) {
            this.world.logger.info(`completed ${this.completed()} of ${this.totalTests} tests, ${this.runTime} / ${this.dispatchConfig.maxTotalRuntime} seconds}, ${Object.keys(this.testMap).length} running`);
            for (const [sequence, running] of Object.entries(this.testMap)) {
                const { startTime } = running;
                const featureTime = (new Date().getTime() - startTime) / 1000;
                this.world.logger.info(`running test ${sequence} for ${featureTime} / ${this.dispatchConfig.maxClientTime} seconds`);
            }
        }
        this.runTime = (new Date().getTime() - this.startTime.getTime()) / 1000;
        if (this.runTime > this.dispatchConfig.maxTotalRuntime) {
            throw new Error(`run time ${this.runTime} exceeds max ${this.dispatchConfig.maxTotalRuntime}`);
        }
        const completed = this.completed();
        const sc = completed < this.totalTests;
        if (sc) {
            return sc;
        }
        let reason = completed >= this.totalTests ? 'completed tests ' : '';

        this.world.logger.info(`Finished load tests because ${reason}`);

        return false;
    }
    checkToken(token: string, res: IResponse) {
        if (token !== this.dispatchConfig.token) {
            res.status(403).end(JSON.stringify({ token, tests: undefined }));
            this.world.logger.error(`token mismatch: ${token} !== ${this.dispatchConfig.token} `);
            return false;
        }
        return true;
    }
    // receive results from clients and add to running results. if all results are received, tell client to end.
    results: TRequestHandler = async (req: IRequest, res: IResponse) => {
        const { ok, token, sequence, testID, historyWithMeta }: TDispatchedResult = req.body;
        if (!this.checkToken(token, res)) {
            return;
        }
        if (!testID || this.testMap[sequence]?.testID !== testID) {
            this.world.logger.error(`testID ${testID} vs ${this.testMap[sequence]?.testID} doesn't match sequence ${sequence}`);
            res.status(500).end(JSON.stringify({ continue: this.shouldContinue() }));
            return;
        }
        const { startTime } = this.testMap[sequence];
        const featureTime = (new Date().getTime() - startTime) / 1000;
        delete this.testMap[sequence];
        this.runningResults[sequence] = { ok, startTime, featureTime, testID, historyWithMeta };
        this.world.logger.log(`results ${ok}, finished ${this.completed()} of ${this.totalTests} tests`);
        res.status(200).end(JSON.stringify({ continue: this.shouldContinue() }));
    }
    // receive client requests for more work. if all tests are run, tell client to terminate.
    dispatch: TRequestHandler = async (req: IRequest, res: IResponse) => {
        const token = <string>req.query.token;
        if (!this.checkToken(token, res)) {
            return;
        }
        const clientID = <string>req.query.clientID;
        Object.entries(this.testMap).map(([sequence, running]) => {
            if (running.clientID === clientID) {
                delete this.testMap[sequence];
                this.world.logger.log(`client ${clientID} redispatch, removed test ${sequence}`);
                this.redispatch++;
            }
        });
        const testID = randomID();

        if (this.shouldContinue()) {
            // all tests dispatched, waiting for results
            if (this.dispatchedTests >= this.totalTests) {
                res.end(JSON.stringify({ state: 'pending' }));
                return;
            }

            // dispatch a test
            const sequence = this.dispatchedTests;
            this.testMap[sequence] = { testID, startTime: new Date().getTime(), clientID };
            this.dispatchedTests++;
            const task: TDispatchedTestRunning = {
                testContext: this.testContext,
                state: 'running',
                testID,
                sequence
            };
            // tests are done
            res.end(JSON.stringify(task));
            return;
        }
        res.end(JSON.stringify({ state: 'end' }));
    }
    completed = () => Object.keys(this.runningResults).length;
};
