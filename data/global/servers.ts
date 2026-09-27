/**
 * MC 服务器数据 — 全站"唯一真相源" (Single Source of Truth)
 *
 * 之前散落在三处, 同一个 host / label 写 3 遍:
 *   - lib/server/status.ts          SERVER_TARGETS        (status card / API)
 *   - data/guide/servers.ts         SERVERS               (guide 页服务器列表)
 *   - components/global/footer.tsx  SERVER_GROUPS         (footer 服务器地址)
 *
 * 现在统一在这里:
 *   - status -> lib/server/status.ts          从 SERVERS 派生 SERVER_TARGETS (附加 port)
 *   - guide  -> app/guide/page.tsx            从 SERVERS + GROUP_META 渲染服务器列表卡
 *   - footer -> components/global/footer.tsx  从 SERVERS 派生 SERVER_GROUPS
 *
 * 改一处即可同步到全站。文件无副作用 (无 node:*, 无 hook, 无浏览器 API),
 * 客户端和服务端都能直接 import。
 */

export type ServerGroup = "survival" | "hemc";

/**
 * 单个 MC 服务器条目 — 各视图按需取字段, 不需要的字段可以不填。
 *
 * 字段语义说明:
 *   id          稳定 id, status key + React key 都用这个
 *   group       分组: status card 按 group 折叠, guide 按 group 分卡
 *   label       status card 显示的完整 label (survival 组带 "群组服 " 前缀, hemc 组无前缀)
 *               e.g. "群组服 校园网" / "群组服 公网主线" / "联合群组门户"
 *   line        guide item / footer line 显示的简称 (不带前缀)
 *               e.g. "校园网" / "公网主线" / "联合群组门户"
 *   host        MC 服务器地址 (无协议前缀)
 *   desc        status card 副文本 (主要 hemc 用版本号 "- 1.21", survival 通常空)
 *   campusOnly  校园网专用 (公网 ping 不通, status 查询短路返回"仅校园网可访问")
 *   order       组内排序 (小在前)
 *   recommended 推荐线路 (guide: emerald 点 / footer: 推荐徽章 + 浅 emerald)
 *   fallback    备线/应急 (guide: slate-300 灰点, 跟普通 slate-400 区分"非主推")
 *   bandwidth   带宽说明 (footer line 副标题)
 *   version     MC 版本/用途 (footer server 副标题)
 *   note        guide 页 item 副文本 (跟 bandwidth / version 不同: 比如"3M 带宽，仅作应急"比
 *               单纯的"3M"信息更完整, 单独存, 改一处不影响 footer)
 */
export interface ServerEntry {
  id: string;
  group: ServerGroup;
  label: string;
  line: string;
  host: string;
  desc?: string;
  campusOnly?: boolean;
  order: number;
  recommended?: boolean;
  fallback?: boolean;
  bandwidth?: string;
  version?: string;
  note?: string;
}

export const SERVERS: ServerEntry[] = [
  {
    id: "survival-campus",
    group: "survival",
    label: "群组服 校园网",
    line: "校园网",
    host: "mc.gdufscraft.top",
    campusOnly: true,
    order: 0,
    recommended: true,
    bandwidth: "无限带宽",
    version: "26.2 原版",
    note: "无限带宽",
  },
  {
    id: "survival-main",
    group: "survival",
    label: "群组服 公网主线",
    line: "公网主线",
    host: "mc2.gdufscraft.top",
    order: 1,
    recommended: true,
    bandwidth: "24M",
    version: "26.2 原版",
    note: "24M 带宽",
  },
  {
    id: "survival-backup",
    group: "survival",
    label: "群组服 公网备线",
    line: "公网备线",
    host: "mc3.gdufscraft.top",
    order: 2,
    fallback: true,
    bandwidth: "3M",
    version: "26.2 原版",
    note: "3M 带宽，仅作应急",
  },
  {
    id: "gh-mua",
    group: "hemc",
    label: "联合群组门户",
    line: "联合群组门户",
    host: "mc.ghmmua.net",
    desc: "- 1.21",
    order: 0,
    bandwidth: "联合服务器",
    version: "联合门户群组",
    note: "- 1.21",
  },
  {
    id: "hemc",
    group: "hemc",
    label: "大学城复原项目",
    line: "大学城复原项目",
    host: "hemc.ghmmua.net",
    desc: "- 1.20.1",
    order: 1,
    bandwidth: "联合服务器",
    version: "大学城复原项目",
    note: "- 1.20.1",
  },
];

/**
 * 服务器分组 UI 元数据 — status card / guide 卡片共用。
 * 之前在 status-constants.ts hardcode, 现在跟 SERVERS 同源。
 *
 * 字段语义:
 *   label       status card 紧凑 label (跟 desc 拼接, e.g. "纯净生存 · 镜像创造" + "· 小游戏 - 26.2")
 *   desc        status card 副文本 (e.g. "· 小游戏 - 26.2")
 *   guideTitle  guide 卡片 h3 标题 (比 status 更完整, e.g. "纯净生存 镜像创造 小游戏 - 26.2")
 *   guideDesc   guide 卡片 p 描述 (更描述性, e.g. "群组服间可通过 /server 指令快捷切换")
 *   icon        图标 SVG 路径
 *   needMUA     是否需要 MUA 联合群组验证
 */
export interface GroupMeta {
  key: ServerGroup;
  label: string;
  desc: string;
  guideTitle: string;
  guideDesc: string;
  icon: string;
  needMUA: boolean;
}

export const GROUP_META: Record<ServerGroup, GroupMeta> = {
  survival: {
    key: "survival",
    label: "纯净生存 · 镜像创造",
    desc: "· 小游戏 - 26.2",
    guideTitle: "纯净生存 镜像创造 小游戏 - 26.2",
    guideDesc: "群组服间可通过 /server 指令快捷切换",
    icon: "/icons/home/生存服图标.svg",
    needMUA: true,
  },
  hemc: {
    key: "hemc",
    label: "粤高联 · 联合服务器",
    desc: "",
    guideTitle: "粤高联 · 联合服务器",
    guideDesc: "广东高校 MC 联盟联合服务器",
    icon: "/icons/home/粤高联图标.svg",
    needMUA: true,
  },
};

/**
 * 全站统一的组展示顺序 — status card / guide / footer 都按这个顺序渲染。
 * 之前散落多处 (status-card.tsx 的 GROUP_ORDER, 其它地方靠 SERVERS 数组顺序),
 * 挪到这里做单一来源。
 */
export const GROUP_ORDER: ServerGroup[] = ["survival", "hemc"];