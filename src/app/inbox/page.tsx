import { Suspense } from "react";
import InboxClient from "./InboxClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-white/70">กำลังเปิด Inbox…</div>}>
      <InboxClient />
    </Suspense>
  );
}
