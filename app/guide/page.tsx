import { Fragment } from "react";
import { SectionHeader } from "@/components/guide/section-header";
import { CopyHost } from "@/components/guide/copy-host";
import { InlineLink } from "@/components/guide/inline-link";
import { Tutorial } from "@/components/guide/tutorial";
import { SERVERS } from "@/data/guide/servers";
import { EXTERNAL } from "@/data/guide/external";
import { RECOMMENDED_MODS } from "@/data/guide/mods";
import { IconExternalLink } from "@tabler/icons-react";
/**
 * STEPS 教程步骤数据
 * - images: carousel 内容数组 (panel 第 0 项 + 图顺延到 1..N)
 *   - 第 1 步: [皮肤站面板, 教程1-1, ..., 教程1-5] (6 项, 1/6 是面板)
 *   - 第 2 步: [PCL2 面板] (1 项, 1/1 是面板)
 *   - 第 3 步: [教程3-1, ..., 教程3-8] (8 项, 1/8 是首图)
 *   - 第 4 步: [教程4-1, ..., 教程4-5] (5 项, 1/5 是首图)
 * - textContent: 文字区文案 (用户编辑, 留空显示占位符)
 */
const STEPS = [
  {
    title: "注册 MUA 账号",
    desc: "前往 MUA 皮肤站注册，通过广外邮箱完成高校认证。",
    iconSrc: "/icons/guide/注册皮肤站图标.svg",
    accent: "from-emerald-100/80 to-emerald-100/0",
    textContent: [
      "点击链接前往皮肤站",
      "点击屏幕中央按钮「现在注册」",
      "教程使用广外邮箱注册，其他方式请自行根据说明进行",
      "按照要求填写注册信息",
      <Fragment key="t1-5">点击注册后，前往<InlineLink href="https://info.gdufs.edu.cn/" label="信息门户" className="mx-1" />，如下图点击广外邮箱</Fragment>,
      "进入邮箱后找到MUA User Center发送的邮件，点击邮件中的链接，完成认证",
    ],
    images: [
      {
        type: "panel" as const,
        panel: {
          title: "皮肤站链接",
          subtitle: "本服采用 MUA 验证",
          links: [
            {
              label: "MUA 皮肤站",
              url: "https://skin.mualliance.ltd",
              desc: "Minecraft 高校联盟皮肤站",
              primary: true,
              wide: true,  // 占满第一行
            },
            {
              label: "MUA 粤港澳高联皮肤站",
              url: "https://skin.ghm.mualliance.cn",
              desc: "需邀请码注册, 账号可通用",
            },
            {
              label: "邀请码申请表单",
              url: "https://f.wps.cn/g/v3SthdRK",
              desc: "若无邀请码，请填写申请",
            },
          ],
        },
      },
      { type: "image" as const, src: "/images/tutorial/s1-1.webp" },
      { type: "image" as const, src: "/images/tutorial/s1-2.webp" },
      { type: "image" as const, src: "/images/tutorial/s1-3.webp" },
      { type: "image" as const, src: "/images/tutorial/s1-4.webp" },
      { type: "image" as const, src: "/images/tutorial/s1-5.webp" },
    ],
  },
  {
    title: "安装启动器",
    desc: "推荐 PCL2 启动器，建议在空间较大的硬盘分区下解压缩。",
    iconSrc: "/icons/guide/安装启动器图标.svg",
    accent: "from-sky-100/80 to-sky-100/0",
    textContent: [
      "建议在空间较大的硬盘分区下解压缩，然后在桌面创建快捷方式",
    ],
    images: [
      {
        type: "panel" as const,
        panel: {
          title: "下载链接",
          subtitle: "",
          links: [
            {
              label: "PCL2 启动器",
              url: "https://ltcat.lanzouv.com/b0aj6gsid",
              desc: "蓝奏云网盘",
              password: "密码：pcl2",
            },
          ],
        },
      },
    ],
  },
  {
    title: "安装游戏版本",
    desc: "选择 26.2 安装，把 MUA 的配置按钮拖进启动器。",
    iconSrc: "/icons/guide/安装版本图标.svg",
    accent: "from-violet-100/80 to-violet-100/0",
    textContent: [
      "打开PCL2启动器，点击上方的「下载」按钮",
      "点击打开「正式版」列表，选择「26.2」",
      "可以直接点击「开始下载」，然后等待下载完成",
      "下载完成后点击上方的「启动」按钮，点击左下角的「版本选择」按钮",
      "点击刚刚下载好的版本",
      // 第 6 条 (教程3-6): MUA 用户中心外链
      <Fragment key="t3-6">如图所示, 打开<InlineLink href="https://skin.mualliance.ltd/user" label="MUA 用户中心" className="mx-1" />, 将网页上蓝色的按钮拖进启动器</Fragment>,
      "启动器提示开启第三方登陆，点击「确定」",
      "填入邮箱密码后点击启动游戏「启动游戏」",
    ],
    images: [
      { type: "image" as const, src: "/images/tutorial/s3-1.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-2.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-3.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-4.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-5.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-6.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-7.webp" },
      { type: "image" as const, src: "/images/tutorial/s3-8.webp" },
    ],
  },
  {
    title: "添加服务器",
    desc: "在多人游戏里添加服务器，填入对应服务器的 IP 双击加入。",
    iconSrc: "/icons/guide/添加服务器图标.svg",
    accent: "from-amber-100/80 to-amber-100/0",
    textContent: [
      "游戏启动完成后，点击主标题菜单的「多人游戏」按钮",
      "勾选不再显示此屏幕然后点击「继续」",
      "点击下方「添加服务器」按钮",
      // 第 4 条 (教程4-4): IP 地址 + CopyHost
      <Fragment key="t4-4">
        填入对应的 IP 地址, 然后点击「完成」
        <br />
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[13px] text-slate-500">校园网</span>
            <CopyHost host="mc.gdufscraft.top" />
          </span>
          <span className="inline-flex items-center gap-1.5 sm:pl-2">
            <span className="text-[13px] text-slate-500">公网主线</span>
            <CopyHost host="mc2.gdufscraft.top" />
          </span>
        </span>
      </Fragment>,
      "出现如图所示的信息表示服务器添加完成，双击或者点击加入即可加入服务器游玩",
    ],
    images: [
      { type: "image" as const, src: "/images/tutorial/s4-1.webp" },
      { type: "image" as const, src: "/images/tutorial/s4-2.webp" },
      { type: "image" as const, src: "/images/tutorial/s4-3.webp" },
      { type: "image" as const, src: "/images/tutorial/s4-4.webp" },
      { type: "image" as const, src: "/images/tutorial/s4-5.webp" },
    ],
  },
];

/* ----------------------------- 视觉资源 ----------------------------- */

export default function HelpPage() {
  return (
    <div className="pt-24 pb-12 sm:pb-20 relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-4 relative">
        <SectionHeader
          title="如何加入我们的 MC 服务器"
          description="四个步骤，轻松入服。"
          theme="light"
          className="mt-6 md:mt-14"
        />

        {/* 联系我们 — 微信群 + QQ群 二维码 (顶部, 进来就能加群) */}
        <div className="mt-10 md:mt-18">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4 bg-">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/玩家社群图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">玩家社群</span>
            <span className="text-slate-500 text-[16px] sm:text-[17px] ml-1.5">扫码加入</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {/* 微信群 */}
            <div className="group relative p-4 sm:p-6 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all overflow-hidden">
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 w-44 h-44 rounded-full bg-gradient-to-br from-emerald-100/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity blur-3xl"
              />
              <div className="relative flex flex-col sm:flex-row gap-5">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-44 h-44 sm:w-44 sm:h-44 rounded-xl overflow-hidden bg-slate-50 border border-slate-200/80 p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地二维码，无需 next/image 优化 */}
                    <img
                      src="/images/contact/微信联系方式.webp"
                      alt="微信小助手二维码"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2 sm:mb-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 本地小图标 */}
                      <img
                        src="/icons/global/微信图标.svg"
                        alt=""
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="font-semibold text-base sm:text-[17px] text-slate-900">微信小助手</div>
                  </div>
                  <p className="text-[14px] sm:text-[15px] text-slate-600 leading-relaxed">
                    添加好友后，小助手会将你拉入群聊
                    <br />
                    群公告包含重要信息，入群后请及时阅读
                  </p>
                  <div className="mt-3.5 hidden sm:flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-[13px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5 font-mono px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      推荐
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* QQ群 */}
            <div className="group relative p-4 sm:p-6 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-sky-300/90 hover:shadow-lg hover:shadow-sky-500/10 hover:-translate-y-0.5 transition-all overflow-hidden">
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 w-44 h-44 rounded-full bg-gradient-to-br from-sky-100/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity blur-3xl"
              />
              <div className="relative flex flex-col sm:flex-row gap-5">
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <div className="w-44 h-44 sm:w-44 sm:h-44 rounded-xl overflow-hidden bg-slate-50 border border-slate-200/80 p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地二维码，无需 next/image 优化 */}
                    <img
                      src="/images/contact/QQ联系方式.webp"
                      alt="QQ群二维码"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2 sm:mb-3">
                    <div className="w-9 h-9 rounded-lg bg-sky-100 flex items-center justify-center flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 本地小图标 */}
                      <img
                        src="/icons/global/QQ图标.svg"
                        alt=""
                        className="w-5 h-5"
                      />
                    </div>
                    <div className="font-semibold text-base sm:text-[17px] text-slate-900">QQ 群</div>
                  </div>
                  <p className="text-[14px] sm:text-[15px] text-slate-600 leading-relaxed">
                    主要用于存放文件
                    <br />
                    交流推荐微信群
                  </p>
                  <div className="mt-3.5 hidden sm:flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-[13px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5 font-mono px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                      <span className="w-2 h-2 rounded-full bg-sky-500" />
                      备选
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4 步教程 — 左侧步骤列表 + 右侧手动轮播 */}
        <div className="mt-14">
          <div className="mb-5 flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">逐步教程</span>
            <br className="flex md:hidden" />
            <span className="text-slate-500 text-[16px] sm:text-[17px] md:ml-1.5">
              本教程以注册 MUA 皮肤站，配置 PCL2 启动器为例
            </span>
          </div>
          <Tutorial steps={STEPS} />
        </div>

        {/* 皮肤站已合并到 4 步流程的第 1 步 carousel 文字区 (Tutorial links) */}

        {/* 服务器地址 — 4 卡片 grid (跟首页 FEATURES 同结构) */}
        <div className="mt-16">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/服务器列表图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">服务器列表</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SERVERS.filter((g) => g.group !== "整合包 · BetterMC5").map((g) => (
              <div
                key={g.group}
                className="group relative px-5 py-3 sm:p-6.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-50 via-white to-emerald-50 border border-slate-200 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
                  <img src={g.icon} alt="" aria-hidden="true" className="w-9 h-9" />
                </div>
                <h3 className="text-[16px] sm:text-[17px] font-bold text-slate-800 mb-1.5">
                  {g.group}
                </h3>
                <p className="text-[13px] sm:text-[14px] text-slate-500 leading-relaxed mb-4">{g.desc}</p>
                <div className="space-y-2.5">
                  {g.items.map((it) => {
                    const dotClass = it.primary
                      ? "bg-emerald-500"
                      : it.warn
                      ? "bg-slate-300"
                      : "bg-slate-400";
                    return (
                      <div key={it.host} className="flex items-start gap-2">
                        <span
                          className={`mt-2 w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[14px] sm:text-[15px] font-semibold text-slate-600 tracking-wide">
                              {it.tag}
                            </span>
                            <CopyHost host={it.host} />
                          </div>
                          <div className="text-[12px] sm:text-[13px] text-slate-400 mt-0.5 leading-snug">
                            {it.note}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 推荐模组 (来自 PDF "如何加入服务器" 第三节) — 3 col 网格 */}
        <div className="mt-16">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/推荐模组图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <div className={"flex flex-col items-start sm:flex-row sm:items-center sm:gap-2"}>
              <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">推荐模组</span>
              <span className="text-slate-500 text-[15px] sm:text-[16px] md:ml-1.5">
                需在版本安装时选择 Fabric
              </span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {RECOMMENDED_MODS.map((m) => {
              return (
                <div
                  key={m.name}
                  className="group relative p-3 sm:p-5.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all overflow-hidden"
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-lg ${m.bg} flex items-center justify-center group-hover:scale-110 transition-transform overflow-hidden`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态资源 */}
                      <img src={m.icon} alt="" aria-hidden="true" className="w-6 h-6 object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[16px] sm:text-[17px] text-slate-800 leading-tight">
                        {m.name}
                      </div>
                      <div className="hidden sm:flex text-[13px] font-mono text-slate-500 mt-0.5">
                        {m.en}
                      </div>
                      <div className="text-[14px] sm:text-[15px] text-slate-600 mt-2 leading-relaxed">
                        {m.desc}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 配套资源 — 白卡 + 浅 hover */}
        <div className="mt-16 md:mb-4">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/相关链接图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">相关链接</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {EXTERNAL.map((e) => (
              <a
                key={e.url}
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center gap-3 sm:gap-4 p-2 sm:p-4 rounded-xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-blue-300/90 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5 transition-all"
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-blue-50 transition-all">
                  <IconExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-500 transition-colors" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] sm:text-[16px] font-medium text-slate-800 group-hover:text-blue-500 truncate">
                    {e.label}
                  </div>
                  <div className="text-[13px] sm:text-[14px] text-slate-500 truncate">{e.desc}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
