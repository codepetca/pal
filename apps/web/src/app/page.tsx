import { redirect } from "next/navigation";

import { isSandboxRuntimeAllowed } from "@/lib/sandbox-learner";

export default function HomePage() {
  if (isSandboxRuntimeAllowed()) redirect("/sandbox");

  return (
    <main>
      <h1>Pal API</h1>
      <p>Pal learner services are available to configured integrations.</p>
    </main>
  );
}
