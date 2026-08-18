import widgetPackage from "@codepet/pal-widget/package.json";
import { notFound } from "next/navigation";

import { isSandboxPageAllowed } from "@/lib/sandbox-learner";

import { WidgetSandbox } from "./WidgetSandbox";

export default function SandboxPage() {
  if (!isSandboxPageAllowed()) notFound();

  const mode =
    process.env.VERCEL_ENV === "preview"
      ? "fixture"
      : process.env.PAL_SANDBOX_MODE === "persisted"
        ? "persisted"
        : "fixture";

  const revision = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  return (
    <WidgetSandbox
      mode={mode}
      buildInfo={{
        widgetVersion: widgetPackage.version,
        ...(revision ? { revision } : {}),
      }}
    />
  );
}
