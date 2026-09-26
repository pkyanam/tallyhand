"use client";

/**
 * Magic-link request form for TALLY_AUTH=builtin.
 * Posts to /api/auth/builtin/request and shows the outcome (inbox vs logs).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Loader2, CheckCircle2, TerminalSquare } from "lucide-react";

const Schema = z.object({ email: z.string().email("Enter a valid email address") });
type FormValues = z.infer<typeof Schema>;

export function BuiltinLoginForm() {
  const [result, setResult] = useState<{ emailed: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(Schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/auth/builtin/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult({ emailed: data.emailed, message: data.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mail className="h-5 w-5" /> Sign in to Tallyhand
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a one-time login link. No password to remember.
        </p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            {...register("email")}
          />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </span>
          ) : (
            "Send login link"
          )}
        </button>
      </form>
      {result && (
        <div className="rounded-md border bg-muted/50 p-3 text-sm flex gap-2">
          {result.emailed ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
          ) : (
            <TerminalSquare className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
