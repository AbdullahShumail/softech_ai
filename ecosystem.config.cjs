module.exports = {
  apps: [
    {
      name: 'b2b-outreach-bot',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      time: true,
    },
  ],
};
