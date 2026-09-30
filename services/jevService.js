const ENDPOINT = 'https://jevtypesafeai.com/api/v1/decide';

export class JevError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Inject fetch in tests to avoid paid API calls.
export async function selectMove({ fen, legalMoves }, {
  fetchImpl = fetch, apiKey = process.env.JEV_KEY, model = process.env.JEV_MODEL || 'jev-latest'
} = {}) {
  if (!apiKey?.trim()) throw new JevError('JEV_KEY_MISSING', '.env의 JEV_KEY를 설정하고 서버를 재시작해 주세요.');
  if (typeof fen !== 'string' || !Array.isArray(legalMoves) || !legalMoves.length || legalMoves.length > 255) {
    throw new JevError('JEV_INPUT_INVALID', 'JEV에 전달할 체스 상태가 올바르지 않습니다.');
  }
  let data;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model, state: { fen, sideToMove: 'black', legalMoves },
        questions: { move: {
          type: 'choice',
          instructions: 'Choose the strongest legal chess move for Black in the supplied FEN. Prefer checkmate, avoid losing material, and improve the position. Choose exactly one of the supplied move IDs.',
          criteria: Object.fromEntries(legalMoves.map((move) => [move.id,
            `${move.san}: ${move.from} to ${move.to}${move.promotion ? `, promote to ${move.promotion}` : ''}`]))
        } }
      })
    });
    if (!response.ok) {
      const messages = {
        400: 'JEV가 요청 형식을 거부했습니다.',
        401: 'JEV API 키가 유효하지 않습니다. 키를 확인하고 서버를 재시작해 주세요.',
        402: 'JEV 크레딧이 부족합니다. 충전 후 다시 요청해 주세요.',
        403: 'JEV 계정의 API 접근이 허용되지 않았습니다.',
        429: 'JEV 요청 한도에 도달했습니다. 잠시 후 다시 요청해 주세요.'
      };
      throw new JevError(`JEV_HTTP_${response.status}`, messages[response.status] || 'JEV API 오류입니다. 잠시 후 다시 요청해 주세요.');
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof JevError) throw error;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new JevError('JEV_TIMEOUT', 'JEV 응답이 15초 안에 도착하지 않았습니다. 다시 요청해 주세요.');
    }
    if (error instanceof SyntaxError) throw new JevError('JEV_INVALID_JSON', 'JEV 응답이 올바른 JSON이 아닙니다.');
    throw new JevError('JEV_CONNECTION_FAILED', 'JEV 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
  }
  const answer = data?.answers?.move;
  if (answer?.type !== 'choice' || !legalMoves.some((move) => move.id === answer.choice)) {
    throw new JevError('JEV_INVALID_CHOICE', 'JEV가 합법 수 목록에 없는 선택을 반환했습니다. 다시 요청해 주세요.');
  }
  const probabilities = answer.probabilities;
  return {
    selectedMoveId: answer.choice,
    model: typeof data.model === 'string' ? data.model.slice(0, 100) : undefined,
    confidence: Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1 ? answer.confidence : undefined,
    candidates: probabilities && typeof probabilities === 'object' && !Array.isArray(probabilities)
      ? Object.entries(probabilities).map(([moveId, probability]) => ({ moveId, probability })) : undefined
  };
}
