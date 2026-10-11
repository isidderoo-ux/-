# 에어컨 요청 텔레그램 봇

텔레그램 봇에서 **위치(9개 구역 + 추가 장소 3곳)** → **🥶 추워요 / 🥵 더워요**를 누르면
담당자 단톡방에 알림이 가는 봇입니다.

```
직원 화면                         담당자가 받는 메시지
📍 지금 계신 곳을 눌러주세요.        🥶 [5구역] 추워요
[1구역][2구역][3구역]               → 온도를 올리거나 바람을 약하게 해주세요
[4구역][5구역][6구역]               시간: 10/11 14:03
[7구역][8구역][9구역]
[의자석][로비][단상]
```

- 요청한 사람 정보(이름·아이디)는 저장하지도, 담당자에게 보내지도 않습니다.
- 같은 구역에서 같은 요청이 2분 안에 또 오면 알림을 한 번만 보냅니다.

두 가지 방식이 있습니다. **사람이 많이 쓰면 Cloudflare Workers를 쓰세요.**

| | `worker.js` (Cloudflare Workers) | `Code.gs` (구글 Apps Script) |
|---|---|---|
| 반응 속도 | 거의 즉시 | 1~3초 |
| 비용 | 무료 (하루 10만 건) | 무료 |

## Cloudflare Workers 설치

### 1. Worker 만들기
1. https://dash.cloudflare.com 가입/로그인
2. 왼쪽 **Compute (Workers) → Workers & Pages → Create → Start with Hello World!**
3. 이름(예: `aircon-bot`) 입력 → **Deploy**
4. **Edit code** → 기존 코드를 모두 지우고 `worker.js` 내용을 붙여넣기 → **Deploy**

### 2. 봇 토큰 넣기 (비밀 변수)
1. Worker 화면 → **Settings → Variables and Secrets → Add**
2. Type: **Secret**, Name: `BOT_TOKEN`, Value: 봇 토큰 → **Deploy**

### 3. 중복 방지 저장소 연결
1. 왼쪽 **Storage & Databases → KV → Create** → 이름 `aircon-cooldown`
2. Worker 화면 → **Settings → Bindings → Add → KV namespace**
3. Variable name: `COOLDOWN`, KV namespace: `aircon-cooldown` → **Deploy**

### 4. 텔레그램과 연결
브라우저에서 `https://<워커주소>/setup` 을 엽니다. (예: `https://aircon-bot.내아이디.workers.dev/setup`)
✅ 표시 3개가 나오면 끝입니다. 이때부터 Apps Script 쪽은 더 이상 쓰이지 않습니다.

### 설정 바꾸기
Worker 화면 → **Edit code** → `worker.js` 위쪽 설정 수정 → **Deploy**. (다시 `/setup` 할 필요 없음)

| 설정 | 설명 |
|---|---|
| `MANAGER_CHAT_ID` | 담당자 단톡방 ID. 방에서 `/id@봇아이디` 를 보내면 알려줍니다 |
| `GRID_ZONES` / `EXTRA_ZONES` | 구역·추가 장소 이름 |
| `ZONE_MANAGERS` | 특정 장소만 다른 담당자에게: `{ '로비': '123456789' }` |
| `COOLDOWN_SECONDS` | 같은 요청을 다시 알리기까지 시간(초, 60 이상) |

봇이 반응하지 않으면 `/setup` 을 다시 열어 ⚠️/❌ 표시를 확인하거나,
Worker 화면 → **Logs** 에서 오류를 확인하세요.

---

# (대안) 구글 Apps Script 설치

## 설치 (10분)

### 1. 텔레그램 봇 만들기
1. 텔레그램에서 **@BotFather** 검색 → `/newbot` 입력
2. 봇 이름과 아이디(예: `our_aircon_bot`)를 정하면 **토큰**을 줍니다. (`123456:ABC...` 형태)

### 2. Apps Script에 코드 넣기
1. https://script.google.com 접속 → **새 프로젝트**
2. 기본으로 있는 코드를 지우고 `Code.gs` 내용을 통째로 붙여넣기
3. 맨 위 `BOT_TOKEN` 에 1번에서 받은 토큰 입력 → 저장(💾)

### 3. 웹 앱으로 배포
1. 오른쪽 위 **배포 → 새 배포** → 톱니바퀴에서 **웹 앱** 선택
2. 실행 사용자: **나**, 액세스 권한: **모든 사용자** → **배포**
3. 권한 승인 창이 뜨면 허용 ("확인되지 않은 앱" 경고가 나오면 **고급 → 이동**)
4. 나온 **웹 앱 URL**(`.../exec`)을 복사해서 `WEB_APP_URL` 에 입력 → 저장

### 4. 텔레그램과 연결
1. 위쪽 함수 선택 칸에서 **setWebhook** 선택 → **실행**
2. 실행 로그에 `ok: true` 가 보이면 연결 완료

### 5. 담당자 지정
1. 담당자 단톡방을 만들고 봇을 초대 (담당자가 한 명이면 그 사람이 봇에게 직접 대화)
2. 그 방에서 `/id` 입력 → 봇이 알려주는 숫자를 `MANAGER_CHAT_ID` 에 입력 → 저장
3. **배포 → 배포 관리 → ✏️(수정) → 버전: 새 버전 → 배포** (URL은 그대로 유지됩니다)

### 6. 직원들에게 공유
`https://t.me/봇아이디` 링크를 공유하거나 QR 코드로 만들어 붙여두세요.
직원은 봇을 열고 **시작**을 누르면 됩니다.

## 바꾸고 싶을 때

`Code.gs` 위쪽 설정에서 바꾼 뒤, **꼭 3단계의 "새 버전으로 배포"를 다시 해야** 반영됩니다.

| 설정 | 설명 |
|---|---|
| `GRID_ZONES` | 3×3 구역 이름 (예: `'창가 앞'`) |
| `EXTRA_ZONES` | 추가 장소 이름. 개수를 늘려도 3개씩 줄 바꿈됩니다 |
| `ZONE_MANAGERS` | 특정 장소만 다른 담당자에게: `{ '로비': '123456789' }` |
| `COOLDOWN_SECONDS` | 같은 요청을 다시 알리기까지 시간(초) |

## 봇이 반응하지 않으면
- 함수 선택 칸에서 **checkWebhook** 실행 → 로그의 `last_error_message` 확인
- 코드를 고친 뒤 **새 버전으로 배포**했는지 확인
- Apps Script 왼쪽 **실행** 메뉴에서 오류 기록 확인
