"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Wola's one <Toaster />, mounted in the root layout (mount it nowhere else —
// a second Toaster duplicates every toast).
//
// - theme="light": Wola is light-only. Sonner's "system" would give people
//   whose OS is in dark mode dark toasts on a light app.
// - Colours come from the design tokens (--color-*): the old shadcn wrapper
//   pointed at --popover/--border, which this project doesn't define.
//   Success/error use the SYSTEM-OWNED state colours, never tenant brand, so a
//   failure can't be mistaken for branding.
// - top-right on desktop; Sonner goes full-width at the top on phones, clear
//   of the bottom dock.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-right"
      richColors
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-surface)",
          "--normal-text": "var(--color-ink)",
          "--normal-border": "var(--color-rule)",
          "--success-bg": "var(--color-approved-wash)",
          "--success-text": "var(--color-approved)",
          "--success-border": "var(--color-success-100)",
          "--error-bg": "var(--color-rejected-wash)",
          "--error-text": "var(--color-rejected)",
          "--error-border": "var(--color-error-200)",
          "--info-bg": "var(--color-info-50)",
          "--info-text": "var(--color-info-700)",
          "--info-border": "var(--color-info-200)",
          "--border-radius": "0.875rem",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
