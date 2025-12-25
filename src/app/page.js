"use client";

import { useEffect, useState, useCallback } from "react";
import AddressDisplay from "./components/copy";
import CountdownTimer from "./components/Timer";
import Link from "next/link";

export default function Home() {
  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastClaimTime, setLastClaimTime] = useState(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [isTimeSynced, setIsTimeSynced] = useState(false);
  const [noHolders, setNoHolders] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const contractAddress = "gibsoon";

  // Sync server time + winners (POST = safe, no distribution)
  const syncServerTime = useCallback(async () => {
    try {
      const requestStart = Date.now();
      const res = await fetch("/api/claim", { method: "POST" });
      const requestEnd = Date.now();
      const data = await res.json();

      if (!data.success && data.error?.includes("No token holders")) {
        setNoHolders(true);
        return;
      } else {
        setNoHolders(false);
      }

      if (data.serverTime) {
        const serverTime = new Date(data.serverTime).getTime();
        const networkLatency = (requestEnd - requestStart) / 2;
        const adjustedServerTime = serverTime + networkLatency;
        const localTime = requestEnd;

        const offset = adjustedServerTime - localTime;
        setServerTimeOffset(offset);
        setIsTimeSynced(true);
        setWinners(data.winners || []);
      }
    } catch (e) {
      console.error("Failed to sync server time:", e);
      setIsTimeSynced(false);
    }
  }, []);

  // Manual refresh
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await syncServerTime();
    setIsRefreshing(false);
  }, [syncServerTime]);

  // Initial sync
  useEffect(() => {
    syncServerTime();
  }, [syncServerTime]);

  // Periodic re-sync
  // Distributions happen every 4 minutes → sync every 2 minutes
  useEffect(() => {
    if (noHolders) return;

    const interval = setInterval(() => {
      syncServerTime();
    }, 120_000); // 2 minutes

    return () => clearInterval(interval);
  }, [noHolders, syncServerTime]);

  // Manual claim (GET = actual distribution, guarded by cycle_id)
  const handleManualClaim = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/api/claim");
      syncServerTime();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [syncServerTime]);

  return (
    <main className="min-h-screen bg-[#15161B] text-white overflow-hidden relative">
      <div className="fixed inset-0 bg-black/20 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
      </div>

      <div className="fixed top-3 right-3 z-50 flex items-center">
        <Link
          href="https://x.com/powerpumpfun"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white font-semibold text-base hover:text-gray-300 transition-colors px-2 py-1"
        >
          𝕏
        </Link>
        <AddressDisplay contractAddress={contractAddress} />
      </div>

      <div className="relative z-10 flex flex-col items-center p-4 sm:p-8">
        <img src="/power.png" alt="Power" className="h-40 sm:h-52 mb-4" />

        {noHolders ? (
          <div className="flex flex-col items-center min-h-[60vh]">
            <img src="/pump.png" className="h-32 sm:h-48 animate-spin" />
            <p className="text-white/60 text-lg mt-8 text-center">
              No token holders found. Waiting for participants...
            </p>
          </div>
        ) : (
          <>
            <CountdownTimer
              serverTimeOffset={serverTimeOffset}
              isTimeSynced={isTimeSynced}
              onSyncNeeded={syncServerTime}
            />

            <div className="w-full max-w-2xl">
              <div className="flex items-center justify-center gap-3 mb-6">
                <h2 className="text-2xl sm:text-3xl font-semibold">
                  Recent Gifts
                </h2>

                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 disabled:opacity-50"
                >
                  <svg
                    className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {winners.length === 0 ? (
                  <div className="bg-black/40 border border-white/20 p-8 text-center">
                    <p className="text-white/60 text-lg font-semibold">
                      No gifts yet...
                    </p>
                  </div>
                ) : (
                  winners.map((w, i) => (
                    <div
                      key={i}
                      className="bg-black/40 border border-white/20 rounded-2xl p-4 sm:p-6"
                    >
                      <div className="flex justify-between">
                        <div>
                          <p className="font-mono font-bold">
                            {w.wallet.slice(0, 6)}…{w.wallet.slice(-6)}
                          </p>
                          <p className="text-xs text-white/60">
                            {new Date(w.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl">{w.amount.toFixed(4)} SOL</p>
                          {w.signature && (
                            <a
                              href={`https://solscan.io/tx/${w.signature}`}
                              target="_blank"
                              className="text-xs text-blue-400 underline"
                            >
                              View →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}