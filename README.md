# c-bot

웹 브라우저에서 쓰는 코딩 에이전트입니다. 워크스페이스를 고른 뒤 세션에서 파일을 읽고 고치고 명령을 실행합니다. 봇 모드에서는 역할이 다른 에이전트들이 서로 메시지를 주고받으며 일을 나눕니다.

런타임은 [Bun](https://bun.sh)입니다.

## 기능

- 로컬 웹 서버와 앱 셸 (세션/봇 탭, 서버 연결 상태)
- 세션 로그가 대화의 기준이다. 새로고침해도 같은 대화가 복원된다
- 설정에서 OpenAI 호환 LLM을 연결하고, **연결 테스트**로 키가 수락되는지 확인한다. 기본은 SpaceXAI(xAI)
- **프로젝트 열기**: 폴더를 열면 이후 세션이 그 프로젝트에 묶인다. 세션 목록도 프로젝트별로 나뉜다
- 도구: `read_file`, `write_file`, `edit_file`, `list_dir`, `grep`, `glob`, `bash`, `todo_write`
- `bash`는 기본 승인 대기. 허용/거절은 대화 카드에서 한다

- 봇 로스터: 핸들/역할이 있는 프로필과 정규 Bot Chat
- 봇은 `message_agent`로 서로 메시지를 보낸다. 전달은 fire-and-forget이고 attribution은 서버가 붙인다

## 요구 사항

- [Bun](https://bun.sh) 1.4 이상 (`bun --version`)
- 모델 턴을 쓰려면 SpaceXAI(xAI) API 키

## 실행

```sh
bun install
cp .env.example .env   # 필요하면 XAI_API_KEY를 채운다
bun run dev
```

브라우저에서 `http://127.0.0.1:3080` 을 엽니다.

1. **설정 → LLM 연결**에서 API 키를 넣고 **연결 테스트**를 누릅니다. 저장한 키는 `$CBOT_HOME/.env`에만 남고 브라우저로 다시 내려오지 않습니다.
2. **프로젝트 열기**로 작업할 폴더를 고릅니다. 대화 상자에 **실행한 폴더 열기**가 있으면 `bun run dev`를 켠 저장소가 바로 열립니다. 새 세션은 그 폴더에서 진행됩니다.
3. 메시지를 보냅니다.

저장소 루트 `.env`의 `XAI_API_KEY`도 서버가 읽습니다 (`bun run dev`의 cwd와 무관하게 저장소 루트를 연다).

```sh
bun test
bun run typecheck
```

## 환경 변수

시크릿과 프로세스 위치만 환경 변수로 둡니다. 값은 `.env`에 넣고 커밋하지 않습니다. 이름은 [`.env.example`](.env.example)과 같습니다.

모델 id, Base URL, 승인 모드는 `$CBOT_HOME/config.yaml`입니다. 기본 모델은 `grok-4.6`, 기본 Base URL은 `https://api.x.ai/v1`, 기본 승인 모드는 `prompt`입니다.

| 이름 | 기본값 | 의미 |
|---|---|---|
| `XAI_API_KEY` | (없음) | SpaceXAI(xAI) API 키 |
| `CBOT_HOME` | `~/.c-bot` | 런타임 데이터 루트 (세션 DB, config.yaml, .env) |
| `CBOT_HOST` | `127.0.0.1` | 서버 바인드 주소 |
| `CBOT_PORT` | `3080` | 서버 포트 |

## 라이선스

[MIT](LICENSE)
