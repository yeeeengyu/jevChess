import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMove } from '../services/jevService.js';

const input = { fen: 'test-position', legalMoves: [
  { id: 'g8f6', san: 'Nf6', from: 'g8', to: 'f6', promotion: null },
  { id: 'e7e5', san: 'e5', from: 'e7', to: 'e5', promotion: null }
] };

test('Choice API request and response preserve model probabilities', async () => {
  const result = await selectMove(input, { apiKey: 'test-key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://jevtypesafeai.com/api/v1/decide');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const body = JSON.parse(options.body);
    assert.equal(body.state.fen, input.fen);
    assert.equal(body.questions.move.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.move.criteria), ['g8f6', 'e7e5']);
    return { ok: true, json: async () => ({ model: 'jev-test', answers: { move: {
      type: 'choice', choice: 'g8f6', confidence: 0.8, probabilities: { g8f6: 0.7, e7e5: 0.3 }
    } } }) };
  } });
  assert.equal(result.selectedMoveId, 'g8f6');
  assert.equal(result.confidence, 0.8);
  assert.equal(result.model, 'jev-test');
  assert.deepEqual(result.candidates, [{ moveId: 'g8f6', probability: 0.7 }, { moveId: 'e7e5', probability: 0.3 }]);
});

test('missing key, HTTP failures, timeout, bad JSON and illegal choice fail safely', async () => {
  await assert.rejects(selectMove(input, { apiKey: '' }), { code: 'JEV_KEY_MISSING' });
  for (const status of [401, 402, 403, 429, 502]) {
    await assert.rejects(selectMove(input, { apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status }) }), { code: `JEV_HTTP_${status}` });
  }
  for (const [error, code] of [
    [new DOMException('timeout', 'TimeoutError'), 'JEV_TIMEOUT'],
    [new SyntaxError('bad JSON'), 'JEV_INVALID_JSON'],
    [new TypeError('connection failed'), 'JEV_CONNECTION_FAILED']
  ]) {
    await assert.rejects(selectMove(input, { apiKey: 'test-key', fetchImpl: async () => { throw error; } }), { code });
  }
  await assert.rejects(selectMove(input, { apiKey: 'test-key', fetchImpl: async () => ({
    ok: true, json: async () => ({ answers: { move: { type: 'choice', choice: 'e2e4' } } })
  }) }), { code: 'JEV_INVALID_CHOICE' });
});
