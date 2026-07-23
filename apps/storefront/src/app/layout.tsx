import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Header } from "@/components/layout/header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "Óptica — Lentes a tu medida",
    template: "%s | Óptica",
  },
  description:
    "Compra lentes oftálmicos graduados online. Amplia selección de monturas, envío gratis.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
