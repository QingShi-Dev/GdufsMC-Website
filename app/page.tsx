import { StatusCard } from "@/components/home/status-card";
import { HomeMotion } from "@/components/home/home-motion";
import Link from "next/link";

const FEATURES = [
    {
        icon: "/icons/home/生存服图标.svg",
        title: "群组服 · 纯净生存",
        desc: "采用 Fabric 服务端，支持主流生电辅组模组。\n目前，生存服已具备较为完整的生电体系，更多生电、建筑玩法等你解锁。",
    },
    {
        icon: "/icons/home/创造服图标.svg",
        title: "群组服 · 镜像创造",
        desc: "使用和生存服相同的配置、地图，主要服务于建筑设计和机器测试，在这里请尽情发挥自己的创造天赋。",
    },
    {
        icon: "/icons/home/小游戏服图标.svg",
        title: "群组服 · 小游戏",
        desc: "包含纯指令实现的40+小游戏，每周六晚8点举办小游戏派对，欢迎游玩。\n（具体时间会根据情况调整，详情请关注微信群）",
    },
    {
        icon: "/icons/home/粤高联图标.svg",
        title: "粤高联联合服",
        desc: "广东高校 MC 联盟联合服务器，打通多校节点，畅享跨校体验。\n（需按实际情况切换游戏版本，详情请关注对应社群）",
    },
];

export default function Home() {
    return (
        <HomeMotion>
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
                            <div className="text-2xl sm:text-2xl lg:text-3xl font-light text-slate-600 sm:text-slate-500 mb-2">
                                欢迎来到
                                <a href="https://www.mualliance.cn/" target="_blank" className="inline-flex items-center gap-1.5 px-2.5 py-1 ml-2 mt-1.5 mb-2 md:mb-3 text-[14px] font-mono text-emerald-600 bg-white/60 rounded-sm">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- 本地 40x20 小图标，无需 next/image 优化 */}
                                    <img src="/icons/home/MUA图标.png" alt="" className="w-10 h-5 flex-shrink-0"/>
                                    Minecraft 高校联盟成员
                                </a>
                            </div>


                            <h1 className="text-[52px] sm:text-6xl lg:text-[80px] font-bold tracking-tight mb-4 sm:mb-5 leading-[1.05]">
                                <span className="bg-gradient-to-br from-sky-300 via-emerald-400 to-amber-300 bg-clip-text text-transparent">
                                  云城像素社
                                </span>
                            </h1>

                            <p className="text-base sm:text-[18px] text-slate-600 max-w-xl mx-auto sm:pl-1 lg:mx-0 mb-8 leading-relaxed">
                                广外人自己的 Minecraft 服务器
                                <span className="hidden sm:inline mx-2 text-slate-300"> · </span>
                                <br className="sm:hidden" />
                                多服世界 · 跨校联机 · 长期运营
                            </p>

                            <div className="flex flex-col sm:flex-row justify-center items-center lg:items-start gap-3 lg:justify-start">
                                <Link
                                    href="/guide"
                                    className="w-full sm:w-auto px-7 py-3 rounded-full text-[18px] sm:text-[20px] bg-emerald-400 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
                                >
                                    开始游玩
                                </Link>
                                <Link
                                    href="/map"
                                    className="w-full sm:w-auto px-7 py-3 rounded-full text-[18px] sm:text-[20px] bg-white/80 hover:bg-gray-100 text-slate-700 font-semibold border border-slate-200 hover:border-slate-300 transition-colors backdrop-blur-sm"
                                >
                                    浏览世界地图
                                </Link>
                            </div>
                        </div>

                        {/* 右：实时状态卡（移动端先显示） */}
                        <div className="w-full max-w-xl mx-auto lg:max-w-none order-2 lg:order-2">
                            <StatusCard />
                        </div>
                    </div>
                </div>
            </section>

            {/* ============== 服务器简介 ============== */}
            <section
                id="server-intro"
                className="relative py-10 sm:py-20 px-4 sm:px-6 lg:px-8"
            >
                <div className="relative max-w-4xl mx-auto">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-2">
                            组织简介
                        </h2>
                        <p className="text-sm md:text-[16px] text-slate-500">
                            关于云城像素社
                        </p>
                    </div>

                    <div className="md:text-[19px] px-3 sm:px-0 prose prose-slate max-w-none text-slate-600 leading-relaxed text-center">
                        <p>
                            云城像素社是广外学生自发建设的 MC 同好交流会（非学校官方社团），成立于2024年12月。
                            目前聊天群内已添加超过二百人，包含数十名活跃玩家。
                            我们的宗旨是为广外 MC 玩家打造一个创意交流的平台，无论是建筑、红石电路还是模组玩法，都能在这里自由探索和分享。
                        </p>
                        <p className="mt-4">
                            作为粤港澳地区首个拥有独立皮肤站的 MC 学生组织，我们不仅实现了个性化皮肤管理，还成功接入MUA Union生态，是带头成立粤港澳大湾区官方皮肤站的成员之一。
                            欢迎所有热爱方块的广外人加入我们，一起创造无限可能！
                        </p>
                    </div>

                    {/* 玩家合照 */}
                    <figure className="mt-8 md:mt-16 mx-auto max-w-3xl bg-white/70 p-2 shadow-sm border border-slate-200/70 duration-700 ease-out hover:scale-[1.005] transition-all">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 本地图 */}
                        <img
                            src="/images/group/group-photo.webp"
                            alt="云城像素社成员合照"
                            className="w-full ring-1 ring-slate-200/80"
                        />
                    </figure>
                </div>
            </section>

            {/* ============== 特性区 ============== */}
            <section className="relative py-12 sm:pt-20 sm:pb-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-8 md:mb-12">
                        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-2">
                            服务器简介
                        </h2>
                        <p className="text-sm md:text-[16px] text-slate-500">
                            群组服间可通过 /server 指令快捷切换
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:pb-5">
                        {FEATURES.map((f) => (
                            <div
                                key={f.title}
                                className="group relative px-5 py-4 sm:p-6 rounded-2xl bg-white/70 backdrop-blur-sm border border-slate-200/70 hover:border-emerald-300/90 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 transition-all"
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
                                <h3 className="text-[17px] sm:text-[18px] font-bold text-slate-800 mb-2.5">
                                    {f.title}
                                </h3>
                                <p className="text-[15px] sm:text-[16px] text-slate-500 leading-relaxed whitespace-pre-wrap">
                                    {f.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        </HomeMotion>
    );
}
