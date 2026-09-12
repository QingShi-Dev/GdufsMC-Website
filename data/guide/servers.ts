/**
 * 服务器组数据 — guide 页"服务器地址"section
 * - 4 个 server 组 (纯生存 / 机械动力 / BMC / 粤高联)
 * - BMC 当前在 guide 页被 filter 隐藏 (服务暂停), 数据保留方便恢复
 * - pure data: icon 是 string path, items 是纯结构
 */

export interface ServerItem {
  tag: string;
  host: string;
  note: string;
  /** 主推 (校园网) — 浅 emerald 点 */
  primary?: boolean;
  /** 备线 — 灰点 */
  warn?: boolean;
}

export interface ServerGroup {
  group: string;
  icon: string;
  desc: string;
  items: ServerItem[];
}

export const SERVERS: ServerGroup[] = [
  {
    group: "纯净生存 镜像创造 小游戏 - 26.2",
    icon: "/icons/home/生存服图标.svg",
    desc: "群组服间可通过 /server 指令快捷切换",
    items: [
      { tag: "校园网", host: "server.gdufscraft.top", note: "无限带宽", primary: true },
      { tag: "公网主线", host: "mc2.gdufscraft.top", note: "24M 带宽", primary: true },
      { tag: "公网备线", host: "mc3.gdufscraft.top", note: "3M 带宽，仅作应急", warn: true },
    ],
  },
  {
    group: "粤高联 · 联合服务器",
    icon: "/icons/home/粤高联图标.svg",
    desc: "广东高校 MC 联盟联合服务器",
    items: [
      { tag: "联合群组门户", host: "server.ghm-mua.org", note: "- 1.21" },
      { tag: "复原项目", host: "hemc.ghm-mua.org", note: "- 1.20.1" },
    ],
  },
];
