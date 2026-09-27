import { SectionHeader } from "@/components/guide/section-header";
import { CopyHost } from "@/components/guide/copy-host";
import { Tutorial } from "@/components/guide/tutorial";
import { STEPS } from "@/data/guide/steps";
import { EXTERNAL } from "@/data/guide/external";
import { RECOMMENDED_MODS } from "@/data/guide/mods";
import { SERVERS, GROUP_META, GROUP_ORDER } from "@/data/global/servers";
import { IconExternalLink } from "@tabler/icons-react";

/* ----------------------------- 视觉资源 ----------------------------- */

export default function HelpPage() {
  return (
    <div className="pt-24 pb-12 sm:pb-20 relative overflow-hidden cursor-default">
      <div className="mx-auto max-w-6xl px-4 relative">
        <SectionHeader
          title="如何加入我们的 MC 服务器"
          description="四个步骤，轻松入服。"
          theme="light"
          className="mt-6 md:mt-14 px-1 sm:px-0"
        />

        {/* 联系我们 — 微信群 + QQ群 二维码 (顶部, 进来就能加群) */}
        <div className="mt-10 md:mt-18">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4 px-1 sm:px-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/玩家社群图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">玩家社群</span>
            <span className="text-slate-500 text-[16px] sm:text-[17px] ml-1.5">扫码加入</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 px-1.5 sm:px-0">
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
                    <div className="font-semibold text-base sm:text-[17px] text-slate-800">微信小助手</div>
                  </div>
                  <p className="text-[14px] sm:text-[15px] text-slate-600 leading-relaxed">
                    添加好友后，小助手会将你拉入群聊
                    <br />
                    群公告包含重要信息，入群后请及时阅读
                  </p>
                  <div className="mt-3.5 hidden sm:flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-[13px] text-slate-600">
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
                    <div className="font-semibold text-base sm:text-[17px] text-slate-800">QQ 群</div>
                  </div>
                  <p className="text-[14px] sm:text-[15px] text-slate-600 leading-relaxed">
                    主要用于存放文件
                    <br />
                    交流推荐微信群
                  </p>
                  <div className="mt-3.5 hidden sm:flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-[13px] text-slate-600">
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
        <div className="mt-14 px-1.5 sm:px-0">
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

        {/* 服务器地址 — 卡片 grid (跟首页 FEATURES 同结构) */}
        <div className="mt-16">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4 px-1 sm:px-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/服务器列表图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">服务器列表</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 px-1.5 sm:px-0">
            {GROUP_ORDER.map((groupKey) => {
              const meta = GROUP_META[groupKey];
              const items = SERVERS
                .filter((s) => s.group === groupKey)
                .sort((a, b) => a.order - b.order);
              // 当前 group 无 servers 时 (例如以后新增一个 group 但 SERVERS 里还没填), 不渲染卡片
              if (items.length === 0) return null;
              return (
                <div
                  key={groupKey}
                  className="group relative px-5 py-3 sm:p-6.5 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all"
                >
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-50 via-white to-emerald-50 border border-slate-200 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
                    <img src={meta.icon} alt="" aria-hidden="true" className="w-9 h-9" />
                  </div>
                  <h3 className="text-[16px] sm:text-[17px] font-bold text-slate-800 mb-1.5">
                    {meta.guideTitle}
                  </h3>
                  {meta.guideDesc && (
                    <p className="text-[13px] sm:text-[14px] text-slate-500 leading-relaxed mb-4">{meta.guideDesc}</p>
                  )}
                  <div className="space-y-2.5">
                    {items.map((it) => {
                      const dotClass = it.recommended
                        ? "bg-emerald-500"
                        : it.fallback
                        ? "bg-slate-300"
                        : "bg-slate-400";
                      return (
                        <div key={it.id} className="flex items-start gap-2">
                          <span
                            className={`mt-2 w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[14px] sm:text-[15px] font-semibold text-slate-700 tracking-wide">
                                {it.line}
                              </span>
                              <CopyHost host={it.host} />
                            </div>
                            {it.note && (
                              <div className="text-[12px] sm:text-[13px] text-slate-500 mt-0.5 leading-snug">
                                {it.note}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 推荐模组 (来自 PDF "如何加入服务器" 第三节) — 3 col 网格 */}
        <div className="mt-16">
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4 px-1 sm:px-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/推荐模组图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <div className={"flex flex-col items-start sm:flex-row sm:items-center sm:gap-2"}>
              <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">推荐模组</span>
              <span className="text-slate-500 text-[15px] sm:text-[16px] md:ml-1.5">
                需在版本安装时选择 Fabric
              </span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 px-1.5 sm:px-0">
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
          <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-4 px-1 sm:px-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地静态 SVG */}
            <img src="/icons/guide/相关链接图标.svg" alt="" aria-hidden="true" className="w-8 h-8 sm:w-8.5 sm:h-8.5" />
            <span className="text-[18px] sm:text-[19px] font-semibold text-slate-800">相关链接</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 px-1.5 sm:px-0">
            {EXTERNAL.map((e) => (
              <a
                key={e.url}
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center gap-3 sm:gap-4 px-3.5 py-2 sm:p-4 rounded-xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-blue-300/90 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5 transition-all"
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
