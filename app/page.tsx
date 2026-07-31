import { ServerStatusCard } from "@/components/server-status-card";
import { HomeMotionWrap } from "@/components/home-motion-wrap";
import Link from "next/link";

const FEATURES = [
    {
        icon: "/icons/home/生存服图标.svg",
        title: "纯净生存 · 原版",
        desc: "原汁原味的 Minecraft 体验，兼容大多数 Fabric 辅组模组，已具备较为完整的生电体系，更多生电、建组内容等你来解锁。",
    },
    {
        icon: "/icons/home/航空学图标.svg",
        title: "创造 · 机械动力航空学",
        desc: "整合包拖动一键安装，创造模式体验机械、飞行主题玩法，自由释放想象力，翱翔于科技世界的天空。",
    },
    {
        icon: "/icons/home/整合包图标.svg",
        title: "整合包生存 · BetterMC5",
        desc: "探索休闲向生存服务器，BMC5 400+模组，为你带来更多新奇体验。\n（本周目游戏已结束，游戏地图择期放出，敬请关注）",
    },
    {
        icon: "/icons/home/粤高联图标.svg",
        title: "粤高联联合",
        desc: "广东高校 MC 联盟联合服务器，打通多校节点，畅享跨校联机体验。\n（需按实际情况切换游戏版本，详情请关注对应社群）",
    },
];

export default function Home() {
    return (
        <HomeMotionWrap>
            {/* ============== Hero：桌面 2 列 / 移动端堆叠 ============== */}
            <section className="relative pt-28 pb-14 sm:pt-32 sm:pb-16 px-6 sm:px-8 lg:px-8 overflow-hidden">
                {/* 像素方块装饰 */}
                <div
                    aria-hidden="true"
                    className="absolute inset-0 opacity-[0.06]"
                    style={{
                        backgroundImage:
                            "linear-gradient(rgba(15,23,42,1) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,1) 1px, transparent 1px)",
                        backgroundSize: "32px 32px",
                        maskImage:
                            "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
                        WebkitMaskImage:
                            "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
                    }}
                />
                <div
                    aria-hidden="true"
                    className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-sky-200/50 blur-3xl"
                />
                <div
                    aria-hidden="true"
                    className="absolute top-40 -right-20 w-72 h-72 rounded-full bg-emerald-200/50 blur-3xl"
                />

                <div className="relative max-w-6xl mx-auto">
                    <div className="grid lg:grid-cols-[1.1fr_1fr] gap-14 lg:gap-14 items-center">
                        {/* 左：标题 + 副 + CTAs（移动端先显示） */}
                        <div className="text-center lg:text-left order-1 lg:order-1">
                            {/* 顶部小框：Minecraft 高校联盟成员 */}
                            <div className="text-2xl sm:text-2xl lg:text-3xl font-light text-slate-500 mb-2">
                                欢迎来到
                                <a href="https://www.mualliance.cn/" target="_blank" className="inline-flex items-center gap-1.5 px-2.5 py-1 ml-2 mb-3 text-[13px] font-mono text-emerald-600 bg-white/60 rounded-sm">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地 40x20 小图标，无需 next/image 优化 */}
                                    <img src="/icons/home/MUA图标.png" alt="" className="w-10 h-5 flex-shrink-0"/>
                                    Minecraft 高校联盟成员
                                </a>
                            </div>


                            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-5 leading-[1.05]">
                                <span className="bg-gradient-to-br from-sky-300 via-emerald-400 to-amber-300 bg-clip-text text-transparent">
                                  云城像素社
                                </span>
                            </h1>

                            <p className="text-base sm:text-lg text-slate-600 max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed">
                                广外人自己的 Minecraft 服务器
                                <span className="hidden sm:inline mx-2 text-slate-300"> · </span>
                                <br className="sm:hidden" />
                                多服世界 · 跨校联机 · 长期运营
                            </p>

                            <div className="flex flex-col sm:flex-row justify-center items-center lg:items-start gap-3 lg:justify-start">
                                <Link
                                    href="/help"
                                    className="w-full sm:w-auto px-7 py-3 rounded-full bg-emerald-400 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
                                >
                                    开始游玩
                                </Link>
                                <Link
                                    href="/map"
                                    className="w-full sm:w-auto px-7 py-3 rounded-full bg-white/80 hover:bg-gray-100 text-slate-700 font-semibold border border-slate-200 hover:border-slate-300 transition-colors backdrop-blur-sm"
                                >
                                    浏览世界地图
                                </Link>
                            </div>
                        </div>

                        {/* 右：实时状态卡（移动端先显示） */}
                        <div className="w-full max-w-xl mx-auto lg:max-w-none order-2 lg:order-2">
                            <ServerStatusCard />
                        </div>
                    </div>
                </div>
            </section>

            {/* ============== 服务器简介 ============== */}
            <section
                id="server-intro"
                className="relative py-14 sm:py-20 px-4 sm:px-6 lg:px-8"
            >
                <div className="relative max-w-4xl mx-auto">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-2">
                            组织简介
                        </h2>
                        <p className="text-sm text-slate-500">
                            关于云城像素社
                        </p>
                    </div>

                    <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed text-center">
                        <p>
                            云城像素社是广外学生自发建设的 MC 同好交流会（非学校官方社团），成立于2024年12月。
                            我们的宗旨是为广外 MC 玩家打造一个创意交流的平台，无论是建筑、红石电路还是模组玩法，都能在这里自由探索和分享。
                        </p>
                        <p className="mt-4">
                            作为粤港澳地区首个拥有独立皮肤站的 MC 学生组织，我们不仅实现了个性化皮肤管理，还成功接入MUA Union生态，是带头成立了粤港澳大湾区官方皮肤站的成员之一。
                        </p>
                    </div>

                    {/* 玩家合照 — 极窄边框相纸感 + 默认做旧, hover 还原鲜艳 */}
                    <figure className="mt-10 md:mt-16 mx-auto max-w-3xl bg-white p-2  shadow-md border border-slate-200/50">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
                        <img
                            src="/images/group/group-photo.webp"
                            alt="云城像素社成员合照"
                            className="w-full ring-1 ring-slate-200/80 sepia-[0.2] brightness-95 contrast-95 transition-all duration-700 ease-out hover:sepia-0 hover:brightness-100 hover:contrast-100 hover:scale-[1.005] cursor-pointer"
                        />
                    </figure>
                </div>
            </section>

            {/* ============== 特性区 ============== */}
            <section className="relative py-16 sm:py-20 px-4 sm:px-6 lg:px-8 md:mb-4">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-12">
                        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-2">
                            服务器简介
                        </h2>
                        <p className="text-sm text-slate-500">
                            多元选择，校盟集结
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:pb-5">
                        {FEATURES.map((f) => (
                            <div
                                key={f.title}
                                className="group relative p-5 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all"
                            >
                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-50 via-white to-emerald-50 border border-slate-200 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={f.icon}
                                        alt=""
                                        aria-hidden="true"
                                        className="w-9 h-9"
                                    />
                                </div>
                                <h3 className="text-sm font-bold text-slate-800 mb-1.5">
                                    {f.title}
                                </h3>
                                <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap">
                                    {f.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </HomeMotionWrap>
    );
}
