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
  title: "Pulse | Portfolio Terminal",
  description: "High-performance wealth management terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col bg-background`}
      >
        <main className="flex-1 pb-16 relative">
          {children}
        </main>

        {/* Bottom Navigation Placeholder */}
        <nav className="fixed bottom-0 w-full h-16 bg-white border-t border-slate-200 flex items-center justify-around z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          <div className="text-slate-500 text-sm font-medium">Nav Item 1</div>
          <div className="text-slate-500 text-sm font-medium">Nav Item 2</div>
          <div className="text-slate-500 text-sm font-medium">Nav Item 3</div>
        </nav>
      </body>
    </html>
  );
}
