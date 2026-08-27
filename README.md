# c-bot

웹 브라우저에서 쓰는 코딩 에이전트입니다. 워크스페이스를 고른 뒤 세션에서 파일을 읽고 고치고 명령을 실행합니다. 봇 모드에서는 역할이 다른 에이전트들이 서로 메시지를 주고받으며 일을 나눕니다.

런타임은 [Bun](https://bun.sh)입니다.

## 기능

- 로컬 웹 서버와 앱 셸 (세션/봇 탭, 서버 연결 상태)
- 세션 로그가 대화의 기준이다. 새로고침해도 같은 대화가 복원된다
- 설정에서 모델, Base URL, `XAI_API_KEY`를 넣는다 (키는 서버만 보관)
- 워크스페이스를 고른 뒤에만 코딩 턴을 시작한다
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

브라우저에서 `http://127.0.0.1:3080` 을 엽니다. 새 세션 → 워크스페이스 선택 → 메시지. 설정에서 키를 넣어도 됩니다. 키는 `$CBOT_HOME/.env`에 저장되며 응답에 다시 실리지 않습니다.

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
