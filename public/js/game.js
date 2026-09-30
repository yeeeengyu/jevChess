const $ = (id) => document.getElementById(id);
const pieces = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
const names = { k: '킹', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
let state = null;
let selected = null;
let promotionMoves = null;
let busy = false;
let synchronized = true;
let pollTimer;
let notice = '';
const JEV_PREVIEW_MS = 3000;
let jevPreview = null;
let previewTimer;

function storedGameId() { try { return sessionStorage.getItem('jevchess-game'); } catch { return null; } }
function remember(id) { try { sessionStorage.setItem('jevchess-game', id); } catch { /* Storage may be disabled. */ } }

async function request(url, body) {
  const response = await fetch(url, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok && !data.gameId) {
    const error = new Error(data.error?.message || '요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function accept(next) {
  if (state && (state.gameId !== next.gameId || next.version < state.version)) return;
  const showPreview = state && next.jev.status === 'completed' && next.jev.beforeMove
    && next.jev.beforeMove.fen !== state.jev.beforeMove?.fen;
  if (showPreview || (jevPreview && next.version !== state?.version)) {
    clearTimeout(previewTimer);
    jevPreview = showPreview ? next.jev.beforeMove : null;
    if (jevPreview) {
      previewTimer = setTimeout(() => {
        jevPreview = null;
        render();
      }, JEV_PREVIEW_MS);
    }
  }
  state = next;
  synchronized = true;
  selected = null;
  promotionMoves = null;
  render();
  clearTimeout(pollTimer);
  if (state.phase === 'jev_thinking') pollTimer = setTimeout(() => refresh(state.gameId), 700);
}

function render() {
  $('board').replaceChildren();
  const canMove = state?.phase === 'human_turn' && !busy && !jevPreview && synchronized;
  const targets = canMove ? state.legalMoves.filter((move) => move.from === selected) : [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = `${'abcdefgh'[file]}${8 - rank}`;
      const piece = (jevPreview?.board || state?.board)?.[rank][file];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `square ${(rank + file) % 2 ? 'dark' : ''}${selected === square ? ' selected' : ''}${targets.some((move) => move.to === square) ? ' legal' : ''}`;
      button.disabled = !canMove;
      button.setAttribute('aria-label', `${square}${piece ? ` ${piece.color === 'w' ? '백색' : '흑색'} ${names[piece.type]}` : ' 빈 칸'}`);
      if (piece) {
        const span = document.createElement('span');
        span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}-piece`;
        span.textContent = pieces[piece.color][piece.type];
        button.append(span);
      }
      const coordinate = document.createElement('span');
      coordinate.className = 'coordinate';
      coordinate.textContent = square;
      button.append(coordinate);
      button.addEventListener('click', () => chooseSquare(square, piece));
      $('board').append(button);
    }
  }
  $('turn').textContent = jevPreview ? 'Black · JEV' : state ? (state.result ? '게임 종료' : state.turn === 'w' ? 'White · 당신' : 'Black · JEV') : '—';
  $('jev-status').textContent = jevPreview ? '선택 완료 · 3초 후 보드 반영' : busy ? '요청 처리 중…' : ({ idle: '대기', thinking: '선택 중…', completed: '선택 완료', error: '오류 · 재시도 가능' }[state?.jev.status] || '대기');
  $('jev-move').textContent = state?.jev.selectedMove?.san || '—';
  const output = state?.jev.output;
  const outputText = output ? JSON.stringify(output, null, 2) : '아직 응답이 없습니다.';
  // Keep the JSON and its scroll position while the board updates.
  if ($('jev-output').textContent !== outputText) {
    $('jev-output').textContent = outputText;
    $('jev-output').scrollTop = 0;
  }
  const chosen = output?.candidates?.find((candidate) => candidate.moveId === output.selectedMoveId);
  $('jev-distribution').textContent = state?.jev.outputWarning || (chosen
    ? `합법 수 ${output.candidates.length}개 · ${state.jev.selectedMove.san} 선택 확률 ${(chosen.probability * 100).toFixed(2)}%`
    : '첫 응답을 기다리고 있습니다.');
  const reasons = { stalemate: '스테일메이트', insufficient_material: '기물 부족', threefold_repetition: '3회 반복', fifty_moves: '50수 규칙', draw: '무승부' };
  $('game-status').textContent = jevPreview ? (jevPreview.inCheck ? '체크' : '진행 중') : !state ? '준비 중' : state.result
    ? (state.result.reason === 'checkmate' ? `체크메이트 · ${state.result.winner === 'w' ? 'White' : 'Black'} 승리` : `무승부 · ${reasons[state.result.reason]}`)
    : state.inCheck ? '체크' : '진행 중';
  $('message').textContent = notice || state?.error?.message || '';
  $('retry').hidden = state?.phase !== 'jev_error';
  $('retry').disabled = busy || !!jevPreview || !synchronized;
  $('new-game').disabled = busy || !!jevPreview;
  $('promotion').hidden = !promotionMoves;
}

function chooseSquare(square, piece) {
  const moves = state.legalMoves.filter((move) => move.from === selected && move.to === square);
  promotionMoves = null;
  if (moves.length) {
    if (moves.some((move) => move.promotion)) { promotionMoves = moves; render(); }
    else submit('moves', { move: { from: selected, to: square } });
    return;
  }
  selected = piece?.color === 'w' && selected !== square ? square : null;
  render();
}

async function refresh(id) {
  try {
    const next = await request(`/api/games/${encodeURIComponent(id)}`);
    if (state && state.gameId !== id) return;
    notice = '';
    accept(next);
  } catch (error) {
    if (state && state.gameId !== id) return;
    synchronized = false;
    notice = error.status === 404 ? error.message : '상태를 확인할 수 없습니다. 연결 후 다시 확인합니다.';
    render();
    if (error.status !== 404) pollTimer = setTimeout(() => refresh(id), 2000);
  }
}

async function submit(endpoint, fields = {}) {
  if (busy || jevPreview || !synchronized) return;
  const id = state.gameId;
  const version = state.version;
  busy = true;
  notice = '';
  promotionMoves = null;
  render();
  try {
    accept(await request(`/api/games/${id}/${endpoint}`, { version, ...fields }));
  } catch (error) {
    notice = error.message;
    // Never resend a human move after an uncertain response.
    synchronized = false;
    await refresh(id);
    if (synchronized) notice = error.message;
  } finally {
    busy = false;
    render();
  }
}

async function newGame() {
  if (busy || jevPreview) return;
  busy = true;
  clearTimeout(pollTimer);
  notice = '';
  render();
  try {
    const next = await request('/api/games', {});
    state = null;
    remember(next.gameId);
    accept(next);
  } catch (error) { notice = error.message; }
  finally { busy = false; render(); }
}

$('new-game').addEventListener('click', newGame);
$('retry').addEventListener('click', () => submit('jev-retry'));
document.querySelectorAll('[data-promotion]').forEach((button) => button.addEventListener('click', () => {
  const move = promotionMoves?.find((candidate) => candidate.promotion === button.dataset.promotion);
  if (move) submit('moves', { move: { from: move.from, to: move.to, promotion: move.promotion } });
}));
render();
const previousGame = storedGameId();
if (previousGame) refresh(previousGame);
else newGame();
