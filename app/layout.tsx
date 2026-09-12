import type { Metadata } from "next";
import { HeaderNav } from "@/components/global/header-nav";
import { Footer } from "@/components/global/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "云城像素社 - GdufsMC",
  description: "广外我的世界同好交流会网站，实时查看服务器状态、地图概览、往期活动与游玩帮助。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="zh-CN">
        <body className="min-h-screen flex flex-col antialiased">
          <HeaderNav />
          <main className="flex-1">{children}</main>
          <Footer />
        </body>
      </html>
  );
}
