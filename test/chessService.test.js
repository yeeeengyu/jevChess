import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getGame, playHumanMove, retryJev } from '../services/chessService.js';

const move = (version, from, to) => ({ version, move: { from, to } });
const pick = (id) => async () => ({ selectedMoveId: id });

test('human move and mock JEV complete a turn', async () => {
  const game = createGame();
  assert.equal(game.legalMoves.length, 20);
  const next = await playHumanMove(game.gameId, move(game.version, 'e2', 'e4'));
  assert.equal(next.phase, 'human_turn');
  assert.equal(next.turn, 'w');
  assert.equal(next.jev.source, 'mock');
  assert.ok(next.jev.selectedMove.id);
  const output = next.jev.output;
  assert.equal(output.selectedMoveId, next.jev.selectedMove.id);
  assert.equal(output.candidates.length, 20);
  assert.ok(output.candidates.every((candidate) => candidate.probability === 0.05));
  assert.ok(output.candidates.some((candidate) => candidate.moveId === output.selectedMoveId));
  assert.ok(Math.abs(output.candidates.reduce((sum, candidate) => sum + candidate.probability, 0) - 1) < 1e-6);
});

test('invalid or missing probability data does not break a legal selection', async () => {
  for (const corrupt of [
    () => undefined,
    () => [],
    (list) => list.map((candidate) => ({ ...candidate, probability: 0.9 })),
    (list) => list.map((candidate) => ({ ...candidate, moveId: 'e2e4' })),
    (list) => list.map((candidate) => ({ ...candidate, probability: '0.05' }))
  ]) {
    const game = createGame();
    const state = await playHumanMove(game.gameId, move(0, 'e2', 'e4'), async ({ legalMoves }) => ({
      selectedMoveId: 'e7e5',
      candidates: corrupt(legalMoves.map((candidate) => ({ moveId: candidate.id, probability: 1 / legalMoves.length })))
    }));
    assert.equal(state.phase, 'human_turn');
    assert.deepEqual(state.jev.output, { selectedMoveId: 'e7e5' });
    assert.ok(state.jev.outputWarning);
  }
});

test('illegal moves and stale versions never change the position', async () => {
  const game = createGame();
  await assert.rejects(playHumanMove(game.gameId, move(0, 'e2', 'e5')), { code: 'ILLEGAL_MOVE' });
  await assert.rejects(playHumanMove(game.gameId, move(99, 'e2', 'e4')), { code: 'VERSION_CONFLICT' });
  assert.equal(getGame(game.gameId).fen, game.fen);
});

test('bad JEV responses preserve the human move and retry only black', async () => {
  for (const provider of [pick('e2e4'), async () => null, async () => { throw new Error('API failed'); }]) {
    const game = createGame();
    const failed = await playHumanMove(game.gameId, move(0, 'e2', 'e4'), provider);
    assert.equal(failed.phase, 'jev_error');
    assert.equal(failed.turn, 'b');
    assert.equal(failed.board[4][4].type, 'p');
    await assert.rejects(playHumanMove(game.gameId, move(failed.version, 'd2', 'd4')), { code: 'INVALID_PHASE' });
    const recovered = await retryJev(game.gameId, { version: failed.version }, pick('e7e5'));
    assert.equal(recovered.phase, 'human_turn');
    assert.equal(recovered.fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  }
});

test('an in-flight JEV turn rejects duplicate requests', async () => {
  const game = createGame();
  let finish;
  const pending = playHumanMove(game.gameId, move(0, 'e2', 'e4'), () => new Promise((resolve) => { finish = resolve; }));
  const thinking = getGame(game.gameId);
  assert.equal(thinking.phase, 'jev_thinking');
  await assert.rejects(playHumanMove(game.gameId, move(thinking.version, 'd2', 'd4')), { code: 'INVALID_PHASE' });
  finish({ selectedMoveId: 'e7e5' });
  assert.equal((await pending).phase, 'human_turn');
});

test('black checkmate ends the game and rejects further moves', async () => {
  const game = createGame();
  const first = await playHumanMove(game.gameId, move(0, 'f2', 'f3'), pick('e7e5'));
  const end = await playHumanMove(game.gameId, move(first.version, 'g2', 'g4'), pick('d8h4'));
  assert.deepEqual(end.result, { reason: 'checkmate', winner: 'b' });
  assert.equal(end.phase, 'finished');
  assert.deepEqual(end.legalMoves, []);
  await assert.rejects(playHumanMove(game.gameId, move(end.version, 'a2', 'a3')), { code: 'INVALID_PHASE' });
});

test('white checkmate does not call JEV again', async () => {
  let state = createGame();
  for (const [from, to, black] of [['e2', 'e4', 'e7e5'], ['d1', 'h5', 'b8c6'], ['f1', 'c4', 'g8f6']]) {
    state = await playHumanMove(state.gameId, move(state.version, from, to), pick(black));
  }
  let called = false;
  state = await playHumanMove(state.gameId, move(state.version, 'h5', 'f7'), async () => { called = true; });
  assert.deepEqual(state.result, { reason: 'checkmate', winner: 'w' });
  assert.equal(called, false);
});

test('threefold repetition uses the entire game history', async () => {
  let state = createGame();
  for (let i = 0; i < 2; i++) {
    state = await playHumanMove(state.gameId, move(state.version, 'g1', 'f3'), pick('g8f6'));
    state = await playHumanMove(state.gameId, move(state.version, 'f3', 'g1'), pick('f6g8'));
  }
  assert.equal(state.phase, 'finished');
  assert.equal(state.result.reason, 'threefold_repetition');
});
