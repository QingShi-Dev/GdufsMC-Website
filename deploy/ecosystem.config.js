/**
 * PM2 配置 — 跨平台 (Linux 用 H:\GDUFSMC-web, Windows 用 H:\GDUFSMC-web)
 *
 * 设计:
 * - 单实例 fork 模式 (校园服务器 2G RAM 撑不起 cluster 多实例)
 * - max-old-space-size 限制 Node 堆, 给系统留内存
 * - max_memory_restart 350M — 超过自动重启 (防止内存泄漏堆积)
 * - 错误日志和合并日志分开, 方便按日期清理
 *
 * 用法:
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save             # 保存当前进程列表
 *   pm2-startup install  # Windows: 装成 Windows 服务 (需 NSSM)
 *   pm2 startup          # Linux: 生成开机自启命令
 *
 * 路径: cwd / 日志路径根据 OS 自动选 (process.platform === 'win32')
 */

// PM2 用 CommonJS 加载 ecosystem.config.js, 不能用 ESM import
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';
const PROJECT_DIR = IS_WINDOWS ? 'H:\\GDUFSMC-web' : 'H:\GDUFSMC-web';
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');

module.exports = {
  apps: [
    {
      name: "gdufsmc",
      cwd: PROJECT_DIR,
      // next start 在 Next.js 16 的入口
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      // 单实例, fork 模式
      instances: 1,
      exec_mode: "fork",
      // 内存限制 — 校园服务器 2G RAM, 给系统留约 500M
      max_memory_restart: "350M",
      // 限制 Node 堆, 给 V8 余地, 给系统留够
      node_args: ["--max-old-space-size=384"],
      // 环境变量
      env: {
        NODE_ENV: "production",
        // 时区: 校园服务器默认是 Asia/Shanghai, 显式声明
        TZ: "Asia/Shanghai",
        // logger 级别: prod 默认 info, 调试时改 LOG_LEVEL=debug
        LOG_LEVEL: "info",
        // 端口硬编码, 跟 Caddy/PM2 反代一致
        PORT: "3000",
      },
      // 日志 — 放项目 logs/ 自包含 (Windows PM2 默认会拼 .log 后缀)
      log_file: path.join(LOGS_DIR, 'gdufsmc-combined.log'),
      error_file: path.join(LOGS_DIR, 'gdufsmc-error.log'),
      out_file: path.join(LOGS_DIR, 'gdufsmc-out.log'),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // 合并日志: 单文件, 按天 logrotate
      merge_logs: true,
      // 自动重启策略
      //   - min_uptime 30s: 启动 30s 内崩溃算"启动失败", 直接停掉不再重试
      //     (防止应用 bug 导致每秒重启一次刷 PM2 日志)
      //   - max_restarts 10: 总共 10 次启动失败才停 (防止无限重启循环)
      //   - restart_delay 2s: 两次重启间隔, 给系统喘息
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: 30000,
      // 崩溃时 dump 内存, 方便排查
      kill_timeout: 5000,
      listen_timeout: 8000,
    },
  ],
};
