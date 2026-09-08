/**
 * 推荐模组数据 — guide 页"推荐模组"section
 * - 5 个客户端 mod (来自 2026-07-29 PDF)
 * - Xaero 的世界地图 + 小地图 共用 Xaero图标.png
 * - pure data: icon 是 string path, bg 是 tailwind class
 */

export interface RecommendedMod {
  name: string;
  en: string;
  desc: string;
  icon: string;
  bg: string;
}

export const RECOMMENDED_MODS: RecommendedMod[] = [
  {
    name: "Xaero 的世界地图",
    en: "Xaero's World Map",
    desc: "流行的大地图，默认按 M 打开全屏的世界地图，可配合Xaero的小地图使用",
    icon: "/icons/guide/Xaero图标.png",
    bg: "bg-sky-100",
  },
  {
    name: "Xaero 的小地图",
    en: "Xaero's Minimap",
    desc: "流行的小地图，在游戏屏幕左上方添加一个小地图，跟随你移动而改变，可配合Xaero的世界地图使用",
    icon: "/icons/guide/Xaero图标.png",  // 跟世界地图共用一个 Xaero 图标
    bg: "bg-violet-100",
  },
  {
    name: "投影",
    en: "Litematica",
    desc: "大型或复杂建筑必备，创建全息蓝图，助你轻松建造建筑",
    icon: "/icons/guide/投影图标.png",
    bg: "bg-slate-100",
  },
  {
    name: "Tweakeroo",
    en: "",
    desc: "超多功能的客户端辅助模组，包括连点器、灵魂出窍、查看潜影盒内容、伪潜行、岩浆视角等功能",
    icon: "/icons/guide/Tweakeroo图标.png",
    bg: "bg-amber-100",
  },
  {
    name: "钠",
    en: "Sodium",
    desc: "强大的渲染引擎暨优化模组，可大幅提升游戏的画面渲染性能，提高帧率",
    icon: "/icons/guide/钠图标.webp",
    bg: "bg-emerald-100",
  },
  {
    name: "地毯",
    en: "Carpet",
    desc: "主流的生电辅助模组，提供游戏机制改进与调试监控等功能",
    icon: "/icons/guide/地毯图标.png",
    bg: "bg-stone-100",
  },
];
