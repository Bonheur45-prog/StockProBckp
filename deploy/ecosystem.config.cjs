// PM2 process list. Start with:  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// Secrets live in each app's own .env file (never in this file, never in git).
module.exports = {
  apps: [
    {
      name: "stockpro-api",
      cwd: "/srv/stockpro/server",
      script: "src/server.js",
      env: { NODE_ENV: "production", PORT: 5000 },
      max_memory_restart: "300M", // restart on a leak instead of letting the box swap
    },
    {
      name: "sagec-cms",
      cwd: "/srv/sagec-cms",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      env: { NODE_ENV: "production", NODE_OPTIONS: "--no-deprecation --max-old-space-size=700" },
      max_memory_restart: "900M",
    },
  ],
};
