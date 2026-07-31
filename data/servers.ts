/**
 * 服务器组数据 — help 页"服务器地址"section
 * - 4 个 server 组 (纯生存 / 机械动力 / BMC / 粤高联)
 * - BMC 当前在 help 页被 filter 隐藏 (服务暂停), 数据保留方便恢复
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
    group: "纯净生存 · 原版 1.21.8",
    icon: "/icons/home/生存服图标.svg",
    desc: "玩家大本营，主营生电、建筑",
    items: [
      { tag: "校园网", host: "mc.gdufscraft.top", note: "无限带宽", primary: true },
      { tag: "公网主线", host: "mc2.gdufscraft.top", note: "24M 带宽", primary: true },
      { tag: "公网备线", host: "mc3.gdufscraft.top", note: "3M 带宽，仅作应急", warn: true },
    ],
  },
  {
    group: "航空学创造 · 1.21.1-NeoForge",
    icon: "/icons/home/航空学图标.svg",
    desc: "机械动力：航空学体验服，进群获取整合包",
    items: [
      { tag: "校园网", host: "create.gdufscraft.top", note: "无限带宽", primary: true },
      { tag: "公网主线", host: "create2.gdufscraft.top", note: "24M 带宽", primary: true },
      { tag: "公网备线", host: "create3.gdufscraft.top", note: "3M 带宽，仅作应急", warn: true },
    ],
  },
  {
    group: "整合包 · BetterMC5",
    icon: "/icons/home/整合包图标.svg",
    desc: "目前暂时不需要 MUA 或正版验证",
    items: [{ tag: "公网", host: "bmc.gdufscraft.top", note: "无需 MUA / 正版" }],
  },
  {
    group: "粤高联 · 联合服务器",
    icon: "/icons/home/粤高联图标.svg",
    desc: "广东高校联合的真实比例大学城",
    items: [
      { tag: "联合群组门户", host: "mc.ghm-mua.org", note: "1.21" },
      { tag: "复原项目", host: "hemc.ghm-mua.org", note: "1.20.1" },
    ],
  },
];
