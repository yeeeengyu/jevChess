# JevChess

Express + EJS + vanilla JavaScript 기반 체스 실험입니다. 사람은 White,
JEV Choice API는 Black의 합법 수 중 하나를 선택합니다.

## 실행

Node.js 20.12 이상이 필요합니다.

```sh
npm install
npm start
```

http://localhost:3000 에 접속합니다. 자동 재시작은 `npm run dev`입니다.
프로젝트 루트의 `.env`를 서버 시작 시 읽습니다. 기존 파일을 덮어쓰지 말고 다음 변수를 설정합니다.

```dotenv
JEV_KEY=발급받은_키
JEV_MODEL=jev-latest
PORT=3000
```

키는 브라우저에 전달하지 않습니다. `.env`는 Git 제외 대상입니다.
키 변경 후 서버를 재시작합니다. 키가 없으면 mock으로 대체하지 않고 오류를 표시합니다.

## 게임 흐름

1. 백색 말과 이동할 칸을 클릭합니다. 프로모션은 우측에서 선택합니다.
2. 서버가 버전·차례·합법성을 검증하고 사람의 수를 적용합니다.
3. 게임이 끝나지 않았다면 FEN과 전체 합법 수를 JEV에 전달합니다.
4. JEV의 선택을 다시 검증하고 적용합니다.
5. 우측 JSON에 선택된 수, 응답 모델, confidence, 후보별 probability를 표시합니다.
6. 사람의 이동까지 적용된 보드를 3초간 보여준 뒤 JEV 이동을 표시합니다.
   서버 상태는 이미 확정되어 있으며, 이 시간에는 이동과 New Game이 잠깁니다.
7. JSON은 이동 후에도 남고 다음 JEV 응답 때 갱신됩니다.

체크메이트, 스테일메이트, 기물 부족, 3회 반복, 50수 규칙을 처리합니다.
반복·50수 무승부는 별도 청구 없이 자동 종료합니다.
게임 ID는 sessionStorage, 게임과 기보 이력은 서버 메모리에 있습니다.
같은 탭에서 새로고침하면 복구되지만 서버 재시작 시 게임은 사라집니다.

## 실제 JEV 연결

`services/jevService.js`의 `selectMove({ fen, legalMoves })`에서 호출합니다.

- 제공자: JevTypeSafeAI의 hosted API (TypeSafe 공식 API와 별개의 서비스)
- 주소: `POST https://jevtypesafeai.com/api/v1/decide`
- 인증: `Authorization: Bearer <JEV_KEY>`
- 질문: `questions.move.type = "choice"`
- 후보: `criteria`의 키에 이동 ID, 값에 SAN과 출발·도착 칸
- 모델 출력: `answers.move.choice`, `probabilities`, `confidence`
- 내부 결과: `{ selectedMoveId, candidates, model, confidence }`

출력 패널은 API 응답을 위 내부 포맷으로 정리한 JSON입니다. SAN은 서버가 생성합니다.
확률은 API가 반환한 수치를 그대로 사용하며 무작위 숫자나 균등 확률로 대체하지 않습니다.
이는 질문의 후보에 대한 모델의 분포로, 체스 승률이나 엔진 평가값이 아닙니다.
confidence는 후보 확률과 구분하여 표시합니다.

후보 확률을 표시하려면 모든 합법 수가 중복 없이 포함되고 각 값이 0~1,
합계가 1이어야 합니다(허용 오차 0.000001). 확률 누락·오류 시 유효한 수는
적용하되 확률을 표시하지 않고 안내합니다.

문서: https://www.jevtypesafeai.com/typesafe/docs

## 오류와 재시도

요청당 제한은 15초입니다. 인증·잔액·호출 한도·연결·JSON·선택 오류를 처리합니다.
실패하면 `jev_error` 상태에서 사람의 수를 유지하고 `JEV 다시 요청` 버튼을 표시합니다.
재시도는 Black 턴만 다시 호출합니다. 유료 호출이 반복되지 않도록 자동 재시도와
랜덤 fallback은 없습니다. 실제 플레이와 수동 재시도는 API 사용량을 발생시킵니다.
통신 결과가 불확실할 때 브라우저는 수를 재전송하지 않고 게임 상태를 조회합니다.

## API

| 요청 | 역할 |
| --- | --- |
| `GET /` | EJS 페이지 |
| `POST /api/games` | 새 게임 생성 (201) |
| `GET /api/games/:gameId` | 현재 상태 |
| `POST /api/games/:gameId/moves` | 사람 이동 + JEV 턴 |
| `POST /api/games/:gameId/jev-retry` | 실패한 JEV 턴 재시도 |

이동 본문: `{"version":0,"move":{"from":"e2","to":"e4"}}`.
프로모션일 때 move에 `"promotion":"q"` 등을 추가합니다.
재시도 본문은 현재 `version`을 담습니다.
JEV 실패는 502와 최신 게임 스냅샷, 충돌은 409, 불법 수는 422,
잘못된 입력은 400, 없는 게임은 404입니다.

## 파일과 테스트

- `app.js`: 환경변수 로드, Express와 EJS 설정
- `routes/gameRoutes.js`: 페이지·게임 API
- `services/chessService.js`: 상태·규칙·응답 검증·턴 진행
- `services/jevService.js`: 실제 JEV API 호출과 오류 변환
- `views/index.ejs`, `public/js/game.js`, `public/css/style.css`: 화면
- `.env.example`: 비밀값 없는 설정 예시
- `test/chessService.test.js`, `test/jevService.test.js`: 핵심 동작과 API 계약 검증

`npm test`는 테스트 응답을 주입하므로 실제 API와 키를 사용하지 않으며 비용이 없습니다.

DB, 로그인, WebSocket, Stockfish, Undo, rate limiting, Origin 처리,
게임 만료 cleanup은 포함하지 않습니다. 단일 서버 프로세스용이며,
이전 게임은 서버 재시작까지 메모리에 남습니다.
