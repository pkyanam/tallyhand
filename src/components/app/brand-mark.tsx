import Image from "next/image";
import { cn } from "@/lib/utils";
/** Original supplied artwork: never invert it in dark mode. */
export function BrandMark({ className, size = 44 }: { className?: string; size?: number }) {
  return <Image src="/brand/icon-192.png" alt="" width={size} height={size} priority unoptimized className={cn("shrink-0 object-contain mix-blend-multiply dark:mix-blend-normal", className)} />;
}
