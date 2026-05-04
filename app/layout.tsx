import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Retouching Brief Assistant",
  description: "Claude-powered retouching task breakdown"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-50 antialiased">
        {children}
      </body>
    </html>
  );
}

