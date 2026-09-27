import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Daily Finance Brief", template: "%s · Daily Finance Brief" },
  description: "The day's most important finance and market news, explained.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#111315" },
  ],
};

// Runs before the page is painted, so a saved light/dark choice never "flashes" the wrong colours.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              Daily Finance Brief
            </Link>
            <nav className="nav">
              <Link href="/">Today</Link>
              <Link href="/archive">Archive</Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <div className="container">
          {children}
          <footer className="site-footer">For personal learning; not investment advice.</footer>
        </div>
      </body>
    </html>
  );
}
