"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = (props: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  // Build props object, filtering undefined to satisfy exactOptionalPropertyTypes
  const entries = Object.entries(props).filter(([, v]) => v !== undefined)
  if (resolvedTheme != null) {
    entries.push(["theme", resolvedTheme as ToasterProps["theme"]])
  }

  return (
    <Sonner
      {...(Object.fromEntries(entries))}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
    />
  )
}

export { Toaster }
