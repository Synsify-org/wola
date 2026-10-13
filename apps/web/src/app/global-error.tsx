"use client";
import { useEffect } from "react";

// Replaces the whole document if the ROOT layout itself fails, so it can't rely
// on the app's stylesheet: styles are inline and it uses no app components.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · Wola</title>
        <meta name="robots" content="noindex" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#f4f7f5",
          color: "#14201a",
          fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
          padding: "4rem 1.5rem",
        }}
      >
        <main style={{ maxWidth: 440, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>Wola is temporarily unavailable</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#5b6b62", fontSize: "0.9375rem", lineHeight: 1.5 }}>
            Something went wrong on our side. Please try again in a moment. Nothing you entered has been submitted.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#16a34a",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "0.625rem 1.5rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#8a978f" }}>Reference: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
