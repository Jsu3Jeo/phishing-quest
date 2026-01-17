import { Suspense } from "react";
import GameClient from "./GameClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-white/70">กำลังเปิดเกม…</div>}>
      <GameClient />
    </Suspense>
  );
}
