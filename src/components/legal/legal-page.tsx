import Link from "next/link";
import type { ReactNode } from "react";
export function LegalPage({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return <main className="mx-auto max-w-3xl px-6 py-12 sm:py-20">
    <nav aria-label="Public information" className="mb-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm"><Link href="/" className="font-display text-2xl font-semibold">Tallyhand</Link><Link href="/docs" className="underline">Documentation</Link><Link href="/support" className="underline">Support</Link><Link href="/privacy" className="underline">Privacy</Link><Link href="/terms" className="underline">Terms</Link></nav>
    <p className="text-sm text-muted-foreground">Tallyhand by Belweave · Effective October 2, 2026</p>
    <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">{title}</h1><p className="mt-5 text-lg leading-relaxed text-muted-foreground">{summary}</p>
    <div className="mt-10 space-y-9 text-sm leading-7 [&_a]:underline [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_p+p]:mt-3">{children}</div>
    <footer className="mt-14 border-t pt-6 text-sm text-muted-foreground">Belweave · <a href="mailto:info@belweave.com" className="underline">info@belweave.com</a> · <a href="https://github.com/pkyanam/tallyhand" className="underline">Open-source project</a></footer>
  </main>;
}
