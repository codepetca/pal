import { redirect } from "next/navigation";

import { isSandboxPageAllowed } from "@/lib/sandbox-learner";

export default function HomePage() {
  if (isSandboxPageAllowed()) redirect("/sandbox");

  return (
    <main>
      <h1>Pal API</h1>
      <p>Pal learner services are available to configured integrations.</p>
    </main>
  );
}
