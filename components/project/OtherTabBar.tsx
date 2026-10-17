"use client";

import { useEffect, useState } from "react";
import { watchOtherTabs } from "@/lib/storage/tabs";

/** A warning bar while the same house is open in another tab of this browser. */
export default function OtherTabBar({ houseId }: { houseId: string }) {
  const [others, setOthers] = useState(0);
  useEffect(() => {
    setOthers(0);
    return watchOtherTabs(houseId, setOthers);
  }, [houseId]);
  if (others === 0) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="other-tab">
      This house is also open in {others === 1 ? "another tab" : `${others} other tabs`}. Whichever tab saves last wins, so changes in the other tab will be
      overwritten. Keep working in one tab and close the other.
    </div>
  );
}
