# JevChess
Express + EJS로 구현한 간단한 Jev 상대 체스 웹 프로젝트입니다.  
사람은 White, Jev는 Black으로 시작합니다.  

## 실행
**NodeJS 20.12 이상이 필요합니다.**  

- 프로젝트 클론
```github
# HTTPS
git clone https://github.com/yeeeengyu/jevChess.git

# SSH
git clone git@github.com:yeeeengyu/jevChess.git 
```
- 환경변수
```dotenv
JEV_KEY= jev 발급 키
JEV_MODEL= Jev 모델버전, 기본적으로는 최신모델 권장
PORT=3000
```

- 프로젝트 실행
```bash
npm test && npm start
```

## 원리
합법 수를 백엔드 통해 계산한 후, Jev를 사용하여 다음 수를 결정합니다.  
이때 합법 수는 백엔드에서 검증한 후에 전달합니다.  

게임이 끝나지 않았을 때, 각각의 합법 수를 복제하여 선택마다의 결과 ( FEN )와 특징을 계산하고 JEV에 전달합니다.  

화면상에서는 JEV의 선택을 Raw JSON으로 표시해주고, 3초 후에 화면에 반영합니다.  

체스의 기본적인 룰 ( 스테일메이트 · 체크메이트 · 50수 규칙 · 프로모션 등 ) 모두 적용이 가능하고, 이 과정에서 Stockfish같은 별도 모델을 사용하지 않습니다.