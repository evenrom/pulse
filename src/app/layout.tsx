import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pulse Terminal",
  description: "Portfolio Terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col bg-slate-950 text-slate-50`}
      >
        <main className="flex-1 pb-16 relative">
          {children}
        </main>

        {/* Bottom Navigation Placeholder */}
        <nav className="fixed bottom-0 w-full h-16 bg-slate-900 border-t border-slate-800 flex items-center justify-around z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.5)]">
          <div className="text-slate-400 text-sm font-medium hover:text-slate-200 transition-colors cursor-pointer">Dashboard</div>
          <div className="text-slate-400 text-sm font-medium hover:text-slate-200 transition-colors cursor-pointer">Holdings</div>
          <div className="text-slate-400 text-sm font-medium hover:text-slate-200 transition-colors cursor-pointer">Settings</div>
        </nav>
      </body>
    </html>
  );
}