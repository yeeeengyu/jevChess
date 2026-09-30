import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createGame, getGame, playHumanMove, retryJev, analyzeLegalMoves } from '../services/chessService.js';

const move = (version, from, to) => ({ version, move: { from, to } });
const pick = (id) => async () => ({ selectedMoveId: id });

test('human move and injected provider complete a turn', async () => {
  const game = createGame();
  assert.equal(game.legalMoves.length, 20);
  const next = await playHumanMove(game.gameId, move(game.version, 'e2', 'e4'), async ({ legalMoves }) => ({
    selectedMoveId: 'e7e5', candidates: legalMoves.map((move) => ({ moveId: move.id, probability: 1 / legalMoves.length }))
  }));
  assert.equal(next.phase, 'human_turn');
  assert.equal(next.turn, 'w');
  assert.equal(next.jev.source, 'jev');
  assert.ok(next.jev.selectedMove.id);
  assert.equal(next.jev.selectedMove.resultingFen, next.fen);
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
  assert.equal(end.jev.selectedMove.features.gameOverAfterMove, true);
  assert.equal(end.jev.selectedMove.features.givesCheck, true);
  assert.equal(end.jev.selectedMove.features.resultingLegalMoveCount, 0);
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
  assert.equal(state.jev.selectedMove.features.gameOverAfterMove, true);
});

test('all candidates have independent resulting positions without changing the source', () => {
  const chess = new Chess();
  chess.move('e4');
  const fen = chess.fen();
  const history = chess.history();
  const moves = chess.moves({ verbose: true });
  const analyzed = analyzeLegalMoves(chess);
  assert.deepEqual(analyzed.map((move) => move.id), moves.map((move) => move.from + move.to + (move.promotion || '')));
  for (const candidate of analyzed) {
    const copy = new Chess(fen);
    copy.move({ from: candidate.from, to: candidate.to, ...(candidate.promotion && { promotion: candidate.promotion }) });
    assert.equal(candidate.resultingFen, copy.fen());
    assert.equal(candidate.features.resultingLegalMoveCount, copy.moves().length);
    assert.equal(candidate.features.opponentInCheck, copy.inCheck());
  }
  assert.equal(chess.fen(), fen);
  assert.deepEqual(chess.history(), history);
});

test('capture, en passant, check, castling and all promotions are described correctly', () => {
  const capture = analyzeLegalMoves(new Chess('r3k3/8/8/8/8/8/8/R3K3 w - - 0 1')).find((move) => move.id === 'a1a8');
  assert.equal(capture.features.capture, true);
  assert.equal(capture.features.capturedPiece, 'r');
  assert.equal(capture.features.givesCheck, true);
  const ep = analyzeLegalMoves(new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).find((move) => move.id === 'e5d6');
  assert.equal(ep.features.capture, true);
  assert.equal(ep.features.capturedPiece, 'p');
  assert.equal(new Chess(ep.resultingFen).get('d5'), undefined);
  const castleMoves = analyzeLegalMoves(new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'));
  for (const id of ['e1g1', 'e1c1']) assert.equal(castleMoves.find((move) => move.id === id).features.isCastle, true);
  assert.equal(castleMoves.find((move) => move.id === 'e1d1').features.isCastle, false);
  const promotions = analyzeLegalMoves(new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1')).filter((move) => move.isPromotion || move.promotion);
  assert.equal(promotions.length, 4);
  for (const candidate of promotions) {
    assert.equal(candidate.features.isPromotion, true);
    assert.equal(new Chess(candidate.resultingFen).get('a8').type, candidate.promotion);
  }
});

test('analysis failure rejects the entire turn and leaves the human move intact', async (t) => {
  const originalMove = Chess.prototype.move;
  const log = t.mock.method(console, 'error', () => {});
  const game = createGame();
  const patch = t.mock.method(Chess.prototype, 'move', function (move, ...rest) {
    if (move.from === 'e7' && move.to === 'e5') throw new Error('Simulated candidate failure');
    return originalMove.call(this, move, ...rest);
  });
  let called = false;
  const failed = await playHumanMove(game.gameId, move(0, 'e2', 'e4'), async () => { called = true; });
  patch.mock.restore();
  assert.equal(called, false);
  assert.equal(failed.phase, 'jev_error');
  assert.equal(failed.error.code, 'JEV_ANALYSIS_FAILED');
  assert.equal(failed.fen, new Chess().move('e4').after);
  assert.equal(log.mock.callCount(), 1);
  const recovered = await retryJev(game.gameId, { version: failed.version }, pick('e7e5'));
  assert.equal(recovered.phase, 'human_turn');
});

test('JEV sees every analyzed move and cannot modify the authoritative analysis', async () => {
  const game = createGame();
  let expected;
  const next = await playHumanMove(game.gameId, move(0, 'e2', 'e4'), async ({ fen, legalMoves }) => {
    assert.equal(getGame(game.gameId).fen, fen);
    assert.equal(legalMoves.length, 20);
    assert.ok(legalMoves.every((move) => move.resultingFen && move.features));
    const selected = legalMoves.find((move) => move.id === 'e7e5');
    expected = selected.resultingFen;
    selected.resultingFen = 'tampered';
    selected.features.capture = true;
    return { selectedMoveId: 'e7e5' };
  });
  assert.equal(next.fen, expected);
  assert.equal(next.jev.selectedMove.resultingFen, expected);
  assert.equal(next.jev.selectedMove.features.capture, false);
});
