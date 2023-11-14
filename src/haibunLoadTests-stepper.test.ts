// import { testWithDefaults } from '@haibun/core/build/lib/test/lib.js';

import haibunLoadTests from './haibunLoadTests-stepper.js';

describe('haibunLoadTests tests', () => {
  it('finds tests', async () => {
    const tests = await haibunLoadTests.getTest('./local-tests/client', '');
    expect(tests).toBeDefined();
  });
});
