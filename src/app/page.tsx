import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg font-semibold tracking-tight">
          Tallyhand
        </span>
        <Button asChild variant="ghost" size="sm">
          <a
            href="https://github.com/pkyanam/tallyhand"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <GithubIcon className="mr-1.5 h-4 w-4" />
            GitHub
          </a>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6">
        <div className="max-w-xl py-16">
          <h1 className="font-display text-balance text-5xl font-semibold tracking-tight md:text-6xl">
            Tallyhand
          </h1>
          <p className="mt-6 text-balance text-lg leading-relaxed text-muted-foreground">
            Time tracking and invoicing for independent contractors. Your data
            lives on your device — no account, no subscription, nothing to
            lose.
          </p>
          <div className="mt-10">
            <Button asChild size="lg">
              <Link href="/dashboard">
                Launch app
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 text-xs text-muted-foreground">
          <span>MIT-licensed.</span>
          <span>Local-first · Offline-ready.</span>
        </div>
      </footer>
    </div>
  );
}
