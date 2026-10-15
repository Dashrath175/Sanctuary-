import type { Metadata, Viewport } from "next";
import { Archivo_Narrow, Imbue, Saira_Condensed, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const saira = Saira_Condensed({
  variable: "--font-saira-c",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const archivo = Archivo_Narrow({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const imbue = Imbue({
  variable: "--font-imbue",
  subsets: ["latin"],
  axes: ["opsz"],
});

const shareTech = Share_Tech_Mono({
  variable: "--font-sharetech",
  subsets: ["latin"],
  weight: "400",
});

// on Vercel the production domain is known at build time; social previews resolve against it
const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SANCTUARY",
  description: "Fly the real solar system in your browser: scan worlds, moons and spacecraft at their true positions and build your own survey records.",
  openGraph: {
    title: "SANCTUARY",
    description: "Fly the real solar system in your browser: scan worlds, moons and spacecraft at their true positions and build your own survey records.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05040a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${saira.variable} ${archivo.variable} ${imbue.variable} ${shareTech.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
