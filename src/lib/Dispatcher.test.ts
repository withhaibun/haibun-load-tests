import { Dispatcher } from "./Dispatcher.js";

describe('haibunLoadTests tests', () => {
  it('finds tests', async () => {
    const tests = await Dispatcher.getTest('./local-tests/client', '');
    expect(tests).toBeDefined();
  });
});
