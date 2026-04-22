import Link from "next/link";
import { ArrowRight, Clock, FileText, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.8 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.5-1.5 7.8-5.8 7.8-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-foreground" />
          <span className="font-semibold tracking-tight">Tallyhand</span>
        </div>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a
              href="https://github.com/"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
            >
              <GithubIcon className="mr-1.5 h-4 w-4" />
              GitHub
            </a>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard">
              Launch app
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-12 md:pt-20">
        <div className="max-w-2xl">
          <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs text-muted-foreground">
            MIT-licensed · Local-first · No account required
          </span>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            Track, invoice, done.
          </h1>
          <p className="mt-5 text-balance text-lg text-muted-foreground">
            Tallyhand is a free, open-source time tracker and invoice generator
            for independent contractors. Your data lives on your device. No
            SaaS, no integrations, no surprises.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/dashboard">
                Launch app
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="https://github.com/" target="_blank" rel="noreferrer">
                <GithubIcon className="mr-1.5 h-4 w-4" />
                Star on GitHub
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <Feature
            icon={Clock}
            title="Track time the honest way"
            body="Start a timer in one keystroke. The Stop Prompt catches the details while they're still fresh — no blank form before you begin."
          />
          <Feature
            icon={ListChecks}
            title="One ledger, everything"
            body="Time and expenses in one chronological view. Filter, search, select, and turn selections straight into invoices."
          />
          <Feature
            icon={FileText}
            title="Invoices from selections"
            body="Pick the entries that need billing. A polished PDF, rendered entirely in your browser, in seconds."
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground">
          <div>© Tallyhand. MIT-licensed.</div>
          <div>Local-first · Offline-ready · No tracking.</div>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border p-5">
      <Icon className="h-5 w-5" />
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
