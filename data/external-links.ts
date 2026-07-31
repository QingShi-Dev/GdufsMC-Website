/**
 * 外部链接数据 — help 页"相关链接"section
 * pure data, 渲染成 EXTERNAL 卡片
 */

export interface ExternalLink {
  label: string;
  url: string;
  desc: string;
}

export const EXTERNAL: ExternalLink[] = [
  { label: "oopz 语音房间", url: "https://oopz.cn/i/ag6RZr", desc: "组队开黑语音" },
  { label: "服务器工业概况 · 腾讯文档", url: "https://docs.qq.com/sheet/DQ0hYakNWVm9Rdmd0", desc: "查看生电概况" },
  { label: "MUA 官网", url: "https://www.mualliance.cn", desc: "Minecraft 高校联盟" },
  { label: "MUA 皮肤站", url: "https://skin.mualliance.ltd", desc: "MUA 认证通道" },
  { label: "MUA 粤港澳高联皮肤站", url: "https://skin.ghm.mualliance.cn", desc: "需邀请码，认证互通" },
  { label: "邀请码申请表单", url: "https://f.wps.cn/g/v3SthdRK", desc: "没邀请码点这里" },
];
