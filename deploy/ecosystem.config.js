/**
 * PM2 配置 — 跑在 2c0.5g 机器上, 必须保守
 *
 * 设计:
 * - 单实例 fork 模式 (0.5g RAM 撑不起 cluster 多实例)
 * - max-old-space-size 限制 Node 堆, 给系统留内存
 * - max_memory_restart 350M — 超过自动重启 (防止内存泄漏堆积)
 * - 错误日志和合并日志分开, 方便按日期清理
 *
 * 用法:
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save             # 保存当前进程列表
 *   pm2 startup          # 生成开机自启命令
 */

module.exports = {
  apps: [
    {
      name: "gdufsmc",
      cwd: "/opt/gdufsmc",
      // next start 在 Next.js 16 的入口
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      // 单实例, fork 模式
      instances: 1,
      exec_mode: "fork",
      // 内存限制 — 0.5g 系统要给 nginx/ssh/系统留约 150M
      max_memory_restart: "350M",
      // 限制 Node 堆, 给 V8 余地, 给系统留够
      node_args: ["--max-old-space-size=384"],
      // 环境变量
      env: {
        NODE_ENV: "production",
        // 时区: 阿里云默认是 Asia/Shanghai, 显式声明
        TZ: "Asia/Shanghai",
        // logger 级别: prod 默认 info, 调试时改 LOG_LEVEL=debug
        LOG_LEVEL: "info",
        // 端口硬编码, 跟 nginx 反代一致
        PORT: "3000",
      },
      // 日志 — 放 /opt/gdufsmc/logs/ 自包含 (ubuntu 有写权限)
      // 不放 /var/log/pm2 是因为非 root 用户无法在 /var/log 下建目录
      log_file: "/opt/gdufsmc/logs/gdufsmc-combined.log",
      error_file: "/opt/gdufsmc/logs/gdufsmc-error.log",
      out_file: "/opt/gdufsmc/logs/gdufsmc-out.log",
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
