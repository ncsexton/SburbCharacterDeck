import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000"
  )
    .split(",")[0]
    .trim();
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = `${protocol}://${host}`;
  const description =
    "Persistent character tracking and tabletop rules reference without combat automation.";

  return {
    title: {
      default: "SBURB Character Manager",
      template: "%s · SBURB Character Manager",
    },
    description,
    openGraph: {
      title: "SBURB Character Manager",
      description,
      type: "website",
      url: origin,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1736,
          height: 907,
          alt: "SBURB Character Manager interface with Health and Pluck meters",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "SBURB Character Manager",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
