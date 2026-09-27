/**
 * 4 步教程数据 — guide 页"逐步教程"section
 * - 从 app/guide/page.tsx 拆出, 让 page 只负责渲染
 * - images: carousel 内容数组 (panel 第 0 项 + 图顺延到 1..N)
 *   - 第 1 步: [皮肤站面板, 教程1-1, ..., 教程1-5] (6 项, 1/6 是面板)
 *   - 第 2 步: [PCL2 面板] (1 项, 1/1 是面板)
 *   - 第 3 步: [教程3-1, ..., 教程3-8] (8 项, 1/8 是首图)
 *   - 第 4 步: [教程4-1, ..., 教程4-5] (5 项, 1/5 是首图)
 * - textContent: 文字区文案 (用户编辑, 留空显示占位符)
 *
 * 文件用 .tsx 是因为 textContent 里包含 JSX (Fragment / InlineLink / CopyHost)。
 * 不加 "use client" — 这里只是数据 + JSX-as-ReactNode, 真正消费在 client 组件 <Tutorial>。
 */

import { Fragment } from "react";
import { CopyHost } from "@/components/guide/copy-host";
import { InlineLink } from "@/components/guide/inline-link";
import type { Step } from "@/components/guide/tutorial";

export const STEPS: Step[] = [
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
            <span className="text-[14px] text-slate-600">校园网</span>
            <CopyHost host="mc.gdufscraft.top" />
          </span>
          <span className="inline-flex items-center gap-1.5 sm:pl-2">
            <span className="text-[14px] text-slate-600">公网主线</span>
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