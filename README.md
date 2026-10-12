# 화면 자동 끄기/켜기

정해진 시각에 **모니터만** 끄고 켭니다. 컴퓨터는 계속 동작하므로 밤새 다운로드나 자동화 작업을 돌릴 때 적합합니다.

## macOS

```bash
cd mac
./install.sh 23:00 07:30   # 매일 23:00에 끄고 07:30에 켬
./uninstall.sh             # 예약 삭제
```

- 끄기: `pmset displaysleepnow` (`screen_off.sh`)
- 켜기: `caffeinate -u -t 2` (`screen_on.sh`)
- launchd(`~/Library/LaunchAgents`)에 등록되며, 로그인한 상태에서 동작합니다.
- 바로 테스트: `./screen_off.sh` 실행 → 몇 초 뒤 터미널에서 `sleep 5; ./screen_on.sh`

## Windows

**간편 사용(GUI):** `windows` 폴더의 `ScreenTimer.bat`을 더블클릭하면 설정 창이 열립니다. 시각을 고르고 **예약 저장**을 누르면 끝입니다.

명령어로 쓰려면 PowerShell에서 실행합니다(NirCmd 같은 별도 프로그램 설치 불필요).

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File install.ps1 -Off 23:00 -On 07:30
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

- 끄기: `SC_MONITORPOWER` 메시지로 모니터 끄기 (`screen_off.ps1`)
- 켜기: 마우스를 1픽셀 움직였다 되돌려 화면 깨우기 (`screen_on.ps1`)
- 작업 스케줄러에 `ScreenOff`, `ScreenOn` 작업으로 등록됩니다. 로그인한 사용자 세션에서만 동작합니다.
- 실행 순간 PowerShell 창이 아주 잠깐 깜빡일 수 있습니다.

## 주의

- 화면 잠금/암호가 설정돼 있으면 켜진 뒤 잠금 화면이 보입니다.
- 컴퓨터가 **잠자기** 상태로 들어가면 예약이 실행되지 않습니다. 절전 설정에서 잠자기를 끄거나 충분히 길게 두세요.
