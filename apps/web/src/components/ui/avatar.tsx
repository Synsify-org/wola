"use client";
import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { AVATAR_TINTS, initialsOf, tintIndexFor } from "@/lib/people";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
} as const;

/** A person: initials on a stable tint. Wola holds no profile photos, so the
 *  fallback IS the avatar; an `src` is still honoured if one is ever added. */
function Avatar({
  name,
  src,
  size = "sm",
  className,
  ...props
}: Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, "children"> & {
  name: string | null | undefined;
  src?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn("relative flex shrink-0 overflow-hidden rounded-full", SIZES[size], className)}
      {...props}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        aria-hidden
        className={cn(
          "flex size-full items-center justify-center rounded-full font-semibold tracking-tight",
          AVATAR_TINTS[tintIndexFor(name)],
        )}
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
