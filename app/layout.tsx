import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cybershelf — a little space for your books",
  description: "Bring your books together. Make a shelf that feels like you. A quiet home for your library, reading life, and the things in between.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
