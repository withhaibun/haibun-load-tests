import { getFromRuntime, actionNotOK, asError, sleep, actionOK } from "@haibun/core/build/lib/util/index.js";
import { getConfigFromBase } from "@haibun/core/build/lib/util/workspace-lib.js";
import { getFeaturesAndBackgrounds } from "@haibun/core/build/phases/collector.js";
import { IWebServer, WEBSERVER, IResponse, IRequest, TRequestHandler } from "@haibun/web-server-express/build/defs.js";
import { TDispatchConfig, TDispatchedResult, TDispatchedTestRunning, TRunMap, TRunningResult, TTestContext, randomID } from "./common.js";
import { TArtifactMessageContext } from "@haibun/core/build/lib/interfaces/logger.js";
import { TWorld } from "@haibun/core/build/lib/defs.js";

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
    requestsByClientID: { [clientID: string]: { dispatched: number, pending: number, locked: number, completed: number, redispatch: 0, stale: 0, mismatch: 0 } } = {};
    static lock = false;

    updateClientCount(clientID: string, field: string) {
        if (!this.requestsByClientID[clientID]) {
            this.requestsByClientID[clientID] = { dispatched: 0, pending: 0, locked: 0, completed: 0, redispatch: 0, stale: 0, mismatch: 0 };
        }
        this.requestsByClientID[clientID][field]++;
    }
    constructor(world: TWorld, dispatchConfig: TDispatchConfig) {
        this.world = world;
        this.dispatchConfig = dispatchConfig;
    }
    async runLoadTests(where: string, totalTests: number, filter = '') {
        const webserver: IWebServer = getFromRuntime(this.world.runtime, WEBSERVER);
        if (!webserver) return actionNotOK('webserver not found', { error: asError('webserver not found') });
        this.testContext = Dispatcher.getTest(where, filter);

        try {
            const lockRoute: TRequestHandler = async (req, res, next) => {
                while (Dispatcher.lock) {
                    await sleep(100);
                    const clientID = <string>req.query.clientID;
                    this.updateClientCount(clientID, 'locked');
                }
                Dispatcher.lock = true;
                next();
            };

            webserver.addRoute('get', this.dispatchConfig.dispatchRoute, lockRoute, this.dispatchTest);
            webserver.addRoute('post', this.dispatchConfig.resultsRoute, this.receiveResults);
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
            const dispatchTotal = Object.values(this.requestsByClientID).reduce((acc, value) => acc + value.dispatched, 0);
            const completeTotal = Object.values(this.requestsByClientID).reduce((acc, value) => acc + value.dispatched, 0);
            const summarized = { ...this.summarizeCompletedResults(), dispatchTotal, completeTotal };
            const summary = JSON.stringify(summarized);
            const mainReport = `<table border="1"><tr>${Object.keys(summarized).map(key => `<th>${key}</th>`).join('')}</tr><tr>${Object.values(summarized).map(value => `<td>${value}</td>`).join('')}</tr></table>`;

            this.world.logger.info('results', <TArtifactMessageContext>{ topic: { event: 'request', stage: 'endFeature' }, artifact: { type: 'html', content: mainReport, }, tag: this.world.tag });
            this.world.logger.info('client report', <TArtifactMessageContext>{ topic: { event: 'request', stage: 'endFeature' }, artifact: { type: 'html', content: this.clientReport(), }, tag: this.world.tag });
            const topics = { metrics: { summary, report: { html: summarized.toString() } } };

            return actionOK(topics);
        } catch (error) {
            return actionNotOK('runLoadTests', { error: asError(error) });
        }
    }
    clientReport = () => `<table border="1">${Object.entries(this.requestsByClientID).map(([key, value]) => `<tr><td>${key}</td><td>${JSON.stringify(value)}</td></tr>`).join('')}</table>`;
    removeStaleTests() {
        const now = new Date().getTime();
        Object.entries(this.testMap).map(([sequence, running]) => {
            if (now - running.startTime > this.dispatchConfig.maxClientTime * 1000) {
                this.updateClientCount(running.clientID, 'stale');
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
        const summarized = {
            numCompleted,
            totalRunTime,
            average,
            passed,
            failed: numCompleted - passed,
            clients: Object.keys(this.requestsByClientID).length
        };
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
    receiveResults: TRequestHandler = async (req: IRequest, res: IResponse) => {
        const { ok, token, sequence, testID, historyWithMeta }: TDispatchedResult = req.body;
        if (!this.checkToken(token, res)) {
            return;
        }
        const { startTime, clientID } = this.testMap[sequence];
        if (!testID || this.testMap[sequence]?.testID !== testID) {
            this.world.logger.error(`testID ${testID} vs ${this.testMap[sequence]?.testID} doesn't match sequence ${sequence}`);
            this.updateClientCount(clientID, 'missmatch');
            res.status(500).end(JSON.stringify({ continue: this.shouldContinue() }));
            return;
        }
        this.updateClientCount(clientID, 'completed');
        const featureTime = (new Date().getTime() - startTime) / 1000;
        delete this.testMap[sequence];
        this.runningResults[sequence] = { ok, startTime, featureTime, testID, historyWithMeta };
        this.world.logger.log(`results ${ok}, finished ${this.completed()} of ${this.totalTests} tests`);
        res.status(200).end(JSON.stringify({ continue: this.shouldContinue() }));
    }
    // receive client requests for more work. if all tests are run, tell client to terminate.
    dispatchTest: TRequestHandler = async (req: IRequest, res: IResponse) => {
        try {
            this.doDispatchTest(req, res);
        } finally {
            Dispatcher.lock = false;
        }
    }
    doDispatchTest(req: IRequest, res: IResponse) {
        const token = <string>req.query.token;
        if (!this.checkToken(token, res)) {
            return;
        }
        const clientID = <string>req.query.clientID;
        Object.entries(this.testMap).map(([sequence, running]) => {
            if (running.clientID === clientID) {
                delete this.testMap[sequence];
                this.world.logger.log(`client ${clientID} redispatch, removed test ${sequence}`);
                this.updateClientCount(clientID, 'redispatch');
            }
        });

        if (this.shouldContinue()) {
            const considering = this.completed() + this.running();
            if (considering >= this.totalTests) {
                this.updateClientCount(clientID, 'pending');
                res.end(JSON.stringify({ state: 'pending' }));
                return;
            }

            // dispatch a test
            this.updateClientCount(clientID, 'dispatched');
            const testID = randomID();
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
    running = () => Object.keys(this.testMap).length;
};
