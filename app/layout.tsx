import type { Metadata } from "next";
import { Nav } from "@/components/ui";
import { ProjectSwitcher } from "@/components/project-switcher";
import { GlobalDropdownDismiss } from "./global-dropdown-dismiss";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO System",
  description: "生成式答案影响力管理系统"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <GlobalDropdownDismiss />
        <div className="shell">
          <div className="sidebar">
            <Nav />
            <ProjectSwitcher />
          </div>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
