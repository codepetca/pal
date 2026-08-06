import widgetPackage from "@codepet/pal-widget/package.json";
import { notFound } from "next/navigation";

import { isSandboxRuntimeAllowed } from "@/lib/sandbox-learner";

import { WidgetSandbox } from "./WidgetSandbox";

export default function SandboxPage() {
  if (!isSandboxRuntimeAllowed()) notFound();

  const revision = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  return (
    <WidgetSandbox
      buildInfo={{
        source: process.env.VERCEL_ENV === "preview"
          ? "Protected preview"
          : "Local workspace",
        widgetVersion: widgetPackage.version,
        ...(revision ? { revision } : {}),
      }}
    />
  );
}
