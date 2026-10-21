// PM2 ka config: backend ko chalu rakhta hai, crash par dobara uthata hai, server reboot par bhi
module.exports = {
  apps: [
    {
      name: 'watchtogether-api',
      script: 'src/server.js',
      cwd: __dirname,
      // Ek hi process: rate limits, rooms ki queue aur screen-share ka hisaab memory mein hai.
      // Kai process chalane ke liye pehle Redis jaisi shared cheez chahiye (Socket.IO Redis adapter).
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      kill_timeout: 5000,
      time: true, // logs mein samay likho
    },
  ],
};