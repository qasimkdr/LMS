import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  resolveEffectiveLifecycleStatus,
  type LifecycleSchoolState,
} from './subscriptionLifecycle.js';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

const state = (
  patch: Partial<LifecycleSchoolState> = {},
): LifecycleSchoolState => ({
  status: 'ACTIVE',
  trialEndsAt: null,
  subscriptionEnd: day(10),
  graceEndsAt: null,
  ...patch,
});

const originalTerminalPolicy = process.env.SUBSCRIPTION_AFTER_GRACE_STATUS;

beforeEach(() => {
  delete process.env.SUBSCRIPTION_AFTER_GRACE_STATUS;
});

after(() => {
  if (originalTerminalPolicy === undefined) {
    delete process.env.SUBSCRIPTION_AFTER_GRACE_STATUS;
  } else {
    process.env.SUBSCRIPTION_AFTER_GRACE_STATUS = originalTerminalPolicy;
  }
});

test('ACTIVE school remains active before subscription expiry', () => {
  assert.equal(resolveEffectiveLifecycleStatus(state(), NOW), 'ACTIVE');
});

test('ACTIVE school enters grace immediately when subscription expires', () => {
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ subscriptionEnd: day(-1), graceEndsAt: null }),
      NOW,
    ),
    'GRACE_PERIOD',
  );
});

test('ACTIVE school honors a future configured grace deadline', () => {
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ subscriptionEnd: day(-2), graceEndsAt: day(3) }),
      NOW,
    ),
    'GRACE_PERIOD',
  );
});

test('expired configured grace resolves to read-only by default', () => {
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ subscriptionEnd: day(-8), graceEndsAt: day(-1) }),
      NOW,
    ),
    'READ_ONLY',
  );
});

test('TRIAL school enters grace immediately when trial expires', () => {
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ status: 'TRIAL', trialEndsAt: day(-1), subscriptionEnd: null }),
      NOW,
    ),
    'GRACE_PERIOD',
  );
});

test('GRACE_PERIOD remains active until its deadline', () => {
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ status: 'GRACE_PERIOD', subscriptionEnd: day(-4), graceEndsAt: day(2) }),
      NOW,
    ),
    'GRACE_PERIOD',
  );
});

test('expired grace can resolve to suspended by platform policy', () => {
  process.env.SUBSCRIPTION_AFTER_GRACE_STATUS = 'SUSPENDED';
  assert.equal(
    resolveEffectiveLifecycleStatus(
      state({ status: 'GRACE_PERIOD', subscriptionEnd: day(-8), graceEndsAt: day(-1) }),
      NOW,
    ),
    'SUSPENDED',
  );
});

test('terminal lifecycle states are never softened by dates', () => {
  for (const status of ['READ_ONLY', 'SUSPENDED', 'CANCELLED'] as const) {
    assert.equal(
      resolveEffectiveLifecycleStatus(
        state({ status, subscriptionEnd: day(10), graceEndsAt: day(20) }),
        NOW,
      ),
      status,
    );
  }
});
