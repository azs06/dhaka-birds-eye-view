import type { Metadata } from "next";
import { Anek_Bangla, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ variable: "--font-display", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-mono", weight: ["400", "500", "600"], subsets: ["latin"] });
// Bengali UI and the title wordmark. Anek Bangla carries matching Latin and
// digits, so mixed-script lines stay in one face.
const anekBangla = Anek_Bangla({ variable: "--font-bangla", subsets: ["bengali", "latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Bird's Eye View — Fly over Dhaka",
  description: "Take wing as a living, animated crow and explore a stylized Dhaka from above.",
  // Without an explicit icon the browser probes /favicon.ico and 404s on load.
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${archivo.variable} ${plexMono.variable} ${anekBangla.variable}`}>{children}</body></html>;
}
