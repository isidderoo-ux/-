/* pm2 설정: pm2 start ecosystem.config.js  /  pm2 save */
module.exports = {
  apps: [{
    name: 'church-lightshow',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,            // Socket.IO 상태를 메모리에 두므로 반드시 1개
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '250M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,                       // HTTPS 역방향 프록시가 바라볼 내부 포트
      ADMIN_PASSWORD: '여기에-운영자-비밀번호',   // ★ 반드시 변경
      LEAD_MS: 600,                     // 명령 예약 지연(ms). 와이파이가 불안하면 800~1000
      // 서버가 직접 HTTPS를 처리하려면 아래 두 줄 주석 해제 (역방향 프록시 사용 시 불필요)
      // SSL_CERT: '/volume1/certs/fullchain.pem',
      // SSL_KEY:  '/volume1/certs/privkey.pem',
    },
  }],
};
