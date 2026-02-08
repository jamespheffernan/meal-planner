"use client";

import dynamic from "next/dynamic";

// Agentation is a purely client-side dev tool (uses DOM/window). Using a
// client-only dynamic import makes it reliably visible in Next app router.
const Agentation = dynamic(
  () => import("agentation").then((m) => m.Agentation),
  { ssr: false },
);

export function AgentationDev() {
  if (process.env.NODE_ENV !== "development") return null;
  return <Agentation />;
}

