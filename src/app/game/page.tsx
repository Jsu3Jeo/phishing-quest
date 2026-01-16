import dynamicImport from "next/dynamic";

export const dynamic = "force-dynamic";

const GameClient = dynamicImport(() => import("./GameClient"), { ssr: false });

export default function Page() {
  return <GameClient />;
}
