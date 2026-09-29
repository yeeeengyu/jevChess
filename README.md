# JevChess

Express + EJS + vanilla JavaScript로 만든 작은 체스 실험입니다. 사람은 White,
mock JEV는 Black입니다. mock은 서버가 제공한 합법 수 중 하나를 무작위로 선택합니다.
실제 JEV API는 호출하지 않습니다.

## 실행

Node.js 20 이상이 필요합니다.

```sh
npm install
npm start
```

브라우저에서 http://localhost:3000 을 엽니다. 개발 중 자동 재시작은 `npm run dev`,
기본 검증은 `npm test`로 실행합니다. 다른 포트는 `PORT=3001 npm start`로 지정합니다.

## 사용

- 백색 말을 클릭한 뒤 표시된 이동 가능 칸을 클릭합니다.
- 프로모션은 우측 패널에서 퀸·룩·비숍·나이트를 선택합니다.
- JEV 처리 중에는 이동이 잠깁니다.
- JEV 응답 후 선택한 수를 먼저 표시하고, 사람의 이동까지 적용된 보드를 3초간
  보여준 뒤 JEV의 이동을 반영합니다. 이 시간에는 이동과 New Game이 잠깁니다.
  서버는 즉시 수를 확정하며 표시 지연만 브라우저에서 처리합니다.
- 우측 JSON 패널에 직전 응답의 selectedMoveId와 전체 후보의 moveId, SAN,
  probability를 표시합니다. JSON은 이동 후에도 남아 다음 응답 때 갱신됩니다.
  mock의 선택 확률은 모든 후보에 동일한 `1 / legalMoves.length`이며,
  승률이나 실제 모델의 선호도가 아닙니다.
- JEV 실패 시 사람의 수를 유지하고 `JEV 다시 요청` 버튼을 표시합니다.
- `New Game`은 새 게임을 만듭니다.
- 게임 ID는 브라우저 sessionStorage에, 게임과 기보 이력은 서버 메모리에 유지됩니다.
  같은 탭 새로고침은 복구되지만 서버를 재시작하면 게임이 사라집니다.

## 파일

- `app.js`: Express, EJS, 정적 파일 및 공통 오류 처리
- `routes/gameRoutes.js`: 페이지와 게임 API
- `services/chessService.js`: 메모리 게임, 규칙 검증, 종료 판정, JEV 턴 및 재시도
- `services/jevService.js`: 교체 가능한 mock 선택 함수
- `views/index.ejs`: 기본 화면
- `public/js/game.js`: CSS Grid 보드 렌더링, 클릭 이동, API 요청 및 재동기화
- `public/css/style.css`: 반응형 화면 스타일
- `test/chessService.test.js`: Node 내장 테스트만 사용한 핵심 흐름 검증
- `package.json`, `package-lock.json`: 실행 설정 및 의존성 버전
- `.gitignore`: 의존성·비밀값 제외

## API와 흐름

| 요청 | 역할 |
| --- | --- |
| `GET /` | EJS 페이지 |
| `POST /api/games` | 새 게임 생성 (201) |
| `GET /api/games/:gameId` | 현재 상태 조회 |
| `POST /api/games/:gameId/moves` | 사람 이동 + mock JEV 응답 |
| `POST /api/games/:gameId/jev-retry` | 오류 상태의 Black 턴 재시도 |

이동 본문은 `{"version":0,"move":{"from":"e2","to":"e4"}}` 형식입니다.
프로모션이면 move에 `"promotion":"q"` 등을 추가합니다.
재시도 본문은 `{"version":2}`처럼 현재 버전을 담습니다.

1. 서버가 버전·차례·좌표·합법성을 검증합니다.
2. 사람의 수를 적용하고 종료라면 즉시 반환합니다.
3. FEN과 전체 legalMoves를 mock에 전달합니다.
4. selectedMoveId가 원래 목록과 현재 합법 수에 있는지 재검증합니다.
5. JEV 수를 적용하고 체크·종료 상태를 포함한 스냅샷을 반환합니다.

실패한 JEV 턴은 HTTP 502와 `phase: "jev_error"`인 스냅샷을 반환합니다.
사람의 수는 되돌리지 않습니다. 재시도는 Black만 다시 처리하며 자동 재시도나
랜덤 fallback은 없습니다. mock 자체의 무작위 선택과 실패 fallback은 다른 개념입니다.
버전 충돌·중복 요청은 409, 불법 이동은 422, 잘못된 요청은 400, 없는 게임은 404입니다.
통신 결과가 불확실하면 클라이언트는 이동을 재전송하지 않고 상태를 조회합니다.

체크메이트, 스테일메이트, 기물 부족, 3회 반복, 50수 규칙을 처리합니다.
MVP에서는 반복·50수 무승부를 별도 청구 없이 자동 종료합니다.

## 실제 JEV 연결

`services/jevService.js`의 `selectMove({ fen, legalMoves })` 본문을 실제 호출로 교체합니다.
입출력 계약은 유지합니다.

```text
입력: { fen, legalMoves: [{ id, san, from, to, promotion }, ...] }
최소 출력: { selectedMoveId: "g8f6" }
후보 포함 출력: { selectedMoveId: "g8f6", candidates: [{ moveId: "g8f6", san: "Nf6", probability: 0.05 }, ...] }
```

후보 확률은 선택 사항입니다. 제공하면 모든 합법 수를 중복 없이 포함하고 각 확률이
0~1, 합계가 1이어야 합니다(허용 오차 0.000001). 서버에서 검증하며 SAN은 서버 값을
사용합니다. 확률 누락·오류 시 유효한 선택은 적용하되 확률은 표시하지 않고 안내합니다.
실제 모델이 확률을 제공하지 않으면 임의의 숫자로 채우지 않습니다.

ID는 출발 칸 + 도착 칸 + 선택적 프로모션입니다(예: `a7a8q`).
실패 시 예외를 던지고 서버의 `jev_error` 처리에 맡깁니다.
실제 API 연결 때는 이 함수 내부에 요청 타임아웃과 JSON 파싱을 추가해야 합니다.
API 키는 서버 환경변수에만 둡니다. `chessService.js`의 반환값 검증은 유지합니다.
연결 후 서비스의 `source: 'mock'`과 화면의 mock 안내 문구도 갱신합니다.

오류 경로는 테스트에서 빈 응답·불법 ID·API 예외를 주입해 검증합니다.
정상 mock은 항상 합법 수를 반환하므로 일반 플레이에서는 오류가 의도적으로 발생하지 않습니다.

## 범위

DB, 로그인, WebSocket, Stockfish, Undo, rate limiting, Origin 처리, 게임 만료 cleanup,
후보 점수 차트는 없습니다(선택 확률 JSON은 표시합니다). 단일 서버 프로세스를 전제로 하며 외부 공개용 보안 구성은
포함하지 않습니다. 새 게임을 만들더라도 이전 게임은 서버 재시작까지 메모리에 남습니다.
