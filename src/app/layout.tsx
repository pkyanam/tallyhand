import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import dynamic from "next/dynamic";

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
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon-maskable.svg", type: "image/svg+xml" }],
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
  // configured. The publishable key comes from runtime server env so it can
  // be rotated without rebuilding (unlike NEXT_PUBLIC_* vars).
  const clerkKey =
    process.env.TALLY_AUTH === "clerk"
      ? process.env.CLERK_PUBLISHABLE_KEY
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
            <ClerkAuthProvider publishableKey={clerkKey}>{children}</ClerkAuthProvider>
          ) : (
            children
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
