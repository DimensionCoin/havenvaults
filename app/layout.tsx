import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import PrivyProviders from "@/providers/PrivyProvider"; 
import { UserProvider } from "@/providers/UserProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Haven",
  description: "Send USDC by email and grow your savings with Solana DeFi.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* subtle lime glow */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
        </div>

        <Toaster position="top-right" />

        <PrivyProviders>
          <UserProvider>
            <div className="min-h-screen flex flex-col">
              <main className="flex-1">
                <div className="mx-auto w-full">{children}</div>
              </main>

              <footer className="border-t border-border">
                <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted-foreground">
                  © {new Date().getFullYear()} Haven
                </div>
              </footer>
            </div>
          </UserProvider>
        </PrivyProviders>
      </body>
    </html>
  );
}
