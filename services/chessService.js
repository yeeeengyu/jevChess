import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { selectMove } from './jevService.js';

const games = new Map();

export class GameError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function legalMoves(chess) {
  return chess.moves({ verbose: true }).map(({ san, from, to, promotion }) => ({
    id: from + to + (promotion || ''), san, from, to, promotion: promotion || null
  }));
}

function structuredOutput(response, available) {
  const output = { selectedMoveId: response.selectedMoveId };
  if (response.candidates === undefined) {
    return { output, outputWarning: '선택 확률이 제공되지 않았습니다.' };
  }
  const candidates = response.candidates;
  const ids = new Set(available.map((move) => move.id));
  const valid = Array.isArray(candidates) && candidates.length === available.length
    && candidates.every((candidate) => candidate && ids.has(candidate.moveId)
      && Number.isFinite(candidate.probability) && candidate.probability >= 0 && candidate.probability <= 1)
    && new Set(candidates.map((candidate) => candidate.moveId)).size === available.length
    && Math.abs(candidates.reduce((sum, candidate) => sum + candidate.probability, 0) - 1) < 0.000001;
  if (!valid) return { output, outputWarning: '후보 확률 검증에 실패했습니다. 확률은 표시하지 않습니다.' };
  output.candidates = candidates.map(({ moveId, probability }) => ({
    moveId, san: available.find((move) => move.id === moveId).san, probability
  }));
  return { output, outputWarning: null };
}

function result(chess) {
  if (chess.isCheckmate()) {
    return { reason: 'checkmate', winner: chess.turn() === 'w' ? 'b' : 'w' };
  }
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial()) return { reason: 'insufficient_material', winner: null };
  if (chess.isThreefoldRepetition()) return { reason: 'threefold_repetition', winner: null };
  if (chess.isDrawByFiftyMoves()) return { reason: 'fifty_moves', winner: null };
  if (chess.isDraw()) return { reason: 'draw', winner: null };
  return null;
}

function findGame(id) {
  const game = games.get(id);
  if (!game) throw new GameError(404, 'GAME_NOT_FOUND', '게임이 없습니다. New Game을 눌러 주세요.');
  return game;
}

function snapshot(game) {
  const outcome = result(game.chess);
  return {
    gameId: game.id,
    version: game.version,
    fen: game.chess.fen(),
    board: game.chess.board(),
    turn: game.chess.turn(),
    phase: game.phase,
    inCheck: game.chess.inCheck(),
    result: outcome,
    legalMoves: outcome ? [] : legalMoves(game.chess),
    jev: { ...game.jev },
    error: game.error
  };
}

export function createGame() {
  const game = {
    id: randomUUID(), chess: new Chess(), version: 0, phase: 'human_turn',
    jev: { status: 'idle', selectedMove: null, source: 'mock' }, error: null
  };
  games.set(game.id, game);
  return snapshot(game);
}

export function getGame(id) {
  return snapshot(findGame(id));
}

function checkRequest(game, body, phase) {
  if (!body || !Number.isSafeInteger(body.version) || body.version < 0) {
    throw new GameError(400, 'INVALID_VERSION', '올바른 version이 필요합니다.');
  }
  if (game.version !== body.version) {
    throw new GameError(409, 'VERSION_CONFLICT', '게임 상태가 바뀌었습니다. 최신 상태를 불러옵니다.');
  }
  if (game.phase !== phase) {
    throw new GameError(409, 'INVALID_PHASE', '지금은 이 요청을 처리할 수 없습니다.');
  }
}

async function playJev(game, chooseMove) {
  // Set the phase before awaiting: concurrent requests cannot start another turn.
  game.phase = 'jev_thinking';
  game.jev.status = 'thinking';
  game.error = null;
  game.version += 1;
  const fen = game.chess.fen();
  const beforeMove = { fen, board: game.chess.board(), inCheck: game.chess.inCheck() };
  const available = legalMoves(game.chess);
  try {
    // A copy prevents a provider from changing the authoritative candidate list.
    const response = await chooseMove({ fen, legalMoves: available.map((move) => ({ ...move })) });
    const selected = available.find((move) => move.id === response?.selectedMoveId);
    if (!selected) throw new Error('JEV returned a move outside legalMoves.');
    if (game.chess.fen() !== fen || game.chess.turn() !== 'b') {
      throw new Error('Position changed during JEV turn.');
    }
    const current = legalMoves(game.chess).find((move) => move.id === selected.id);
    if (!current) throw new Error('JEV move is no longer legal.');
    const { output, outputWarning } = structuredOutput(response, available);
    game.chess.move({ from: current.from, to: current.to, ...(current.promotion && { promotion: current.promotion }) });
    game.jev = {
      status: 'completed', selectedMove: { id: current.id, san: current.san },
      source: 'mock', beforeMove, output, outputWarning
    };
    game.phase = result(game.chess) ? 'finished' : 'human_turn';
  } catch {
    // The human move remains committed. Retry only the black turn.
    game.phase = 'jev_error';
    game.jev.status = 'error';
    game.error = { code: 'JEV_FAILED', message: 'JEV가 유효한 수를 반환하지 못했습니다. 다시 요청해 주세요.', retryable: true };
  }
  game.version += 1;
  return snapshot(game);
}

export async function playHumanMove(id, body, chooseMove = selectMove) {
  const game = findGame(id);
  checkRequest(game, body, 'human_turn');
  const move = body.move;
  if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to)
      || typeof move.from !== 'string' || typeof move.to !== 'string'
      || (move.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(move.promotion))) {
    throw new GameError(400, 'INVALID_MOVE', '출발 칸, 도착 칸, 프로모션 값을 확인해 주세요.');
  }
  const selected = legalMoves(game.chess).find((candidate) =>
    candidate.from === move.from && candidate.to === move.to && candidate.promotion === (move.promotion || null));
  if (game.chess.turn() !== 'w' || !selected) {
    throw new GameError(422, 'ILLEGAL_MOVE', '둘 수 없는 수입니다. 프로모션 선택도 확인해 주세요.');
  }
  game.chess.move(move);
  if (result(game.chess)) {
    game.phase = 'finished';
    game.version += 1;
    return snapshot(game);
  }
  return playJev(game, chooseMove);
}

export async function retryJev(id, body, chooseMove = selectMove) {
  const game = findGame(id);
  checkRequest(game, body, 'jev_error');
  return playJev(game, chooseMove);
}
