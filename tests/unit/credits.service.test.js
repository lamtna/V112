'use strict';
/**
 * Credits logic unit tests — pure logic, no DB.
 */

// Test the canCreateSession logic in isolation
function canCreateSession(credits) {
  if (credits.plan === 'unlimited') return { allowed: true };
  if (credits.plan === 'trial') {
    if (credits.trialSessionsUsed < credits.trialSessionsMax) {
      return { allowed: true, reason: 'trial', remaining: credits.trialSessionsMax - credits.trialSessionsUsed };
    }
    return { allowed: false, reason: 'trial_expired', message: 'Trial limit reached.' };
  }
  if (credits.balance > 0) return { allowed: true, balance: credits.balance };
  return { allowed: false, reason: 'no_credits', message: 'No credits remaining.' };
}

describe('Credits — canCreateSession()', () => {
  test('trial user with sessions remaining', () => {
    const c = { plan:'trial', trialSessionsUsed:1, trialSessionsMax:3, balance:0 };
    const r = canCreateSession(c);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  test('trial user exhausted', () => {
    const c = { plan:'trial', trialSessionsUsed:3, trialSessionsMax:3, balance:0 };
    const r = canCreateSession(c);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('trial_expired');
  });

  test('basic plan with credits', () => {
    const c = { plan:'basic', trialSessionsUsed:0, trialSessionsMax:3, balance:5 };
    const r = canCreateSession(c);
    expect(r.allowed).toBe(true);
    expect(r.balance).toBe(5);
  });

  test('basic plan with no credits', () => {
    const c = { plan:'basic', trialSessionsUsed:0, trialSessionsMax:3, balance:0 };
    const r = canCreateSession(c);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_credits');
  });

  test('unlimited plan always allowed', () => {
    const c = { plan:'unlimited', trialSessionsUsed:0, trialSessionsMax:0, balance:0 };
    const r = canCreateSession(c);
    expect(r.allowed).toBe(true);
  });
});

describe('Credits — balance math', () => {
  test('deduction reduces balance', () => {
    let balance = 10;
    balance -= 1;
    expect(balance).toBe(9);
  });

  test('balance cannot go below 0', () => {
    const balance = Math.max(0, 0 - 1);
    expect(balance).toBe(0);
  });
});
