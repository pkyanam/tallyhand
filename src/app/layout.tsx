import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import dynamic from "next/dynamic";
import { effectiveAuth, clerkPublishableKey, parseStorage } from "@/lib/mode";

// Code-split: the @clerk/nextjs client bundle only loads when the app
// actually runs with TALLY_AUTH=clerk. Local mode never downloads it.
const ClerkAuthProvider = dynamic(() =>
  import("./clerk-auth-provider").then((m) => m.ClerkAuthProvider),
);

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
  title: "Tallyhand — Track, invoice, done",
  description:
    "Free, open-source, local-first time tracking and invoicing for independent contractors.",
  manifest: "/manifest.webmanifest",
  applicationName: "Tallyhand",
  icons: {
    icon: [{ url: "/brand/icon-32.png", type: "image/png", sizes: "32x32" }, { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/brand/icon-180.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Tallyhand",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Clerk is strictly opt-in: only wrap when the hosted Clerk auth mode is
  // configured (explicit TALLY_AUTH=clerk, or auto-detected from Clerk keys).
  // The publishable key comes from runtime server env so it can
  // be rotated without rebuilding (unlike NEXT_PUBLIC_* vars).
  const clerkKey =
    effectiveAuth() === "clerk" ? clerkPublishableKey() : undefined;
  const convexUrl = parseStorage() === "convex"
    ? process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL
    : undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {clerkKey ? (
            <ClerkAuthProvider publishableKey={clerkKey} convexUrl={convexUrl} admissionEnabled={Boolean(process.env.AGENTSUB_MERCHANT_ID || process.env.AGENTSUB_OFFER_ID || process.env.AGENTSUB_MERCHANT_KEY)}>{children}</ClerkAuthProvider>
          ) : (
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
