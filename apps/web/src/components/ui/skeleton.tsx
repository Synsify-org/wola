import { cn } from "@/lib/utils";

/** A pulsing placeholder block. Decorative: screen readers get the parent's
 *  aria-busy / "Loading" label instead of dozens of empty shapes. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-gray-100", className)}
      {...props}
    />
  );
}

export { Skeleton };
