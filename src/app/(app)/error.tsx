"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <Card className="max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected error occurred in this view."}
          </p>
          <Button type="button" onClick={reset}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
