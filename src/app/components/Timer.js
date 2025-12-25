// components/CountdownTimer.js
"use client";

import { useEffect, useState } from "react";

const INTERVAL_SECONDS = 4 * 60; // 4 minutes

const CountdownTimer = ({ serverTimeOffset, isTimeSynced, onSyncNeeded }) => {
  const [countdown, setCountdown] = useState(INTERVAL_SECONDS);

  // Get server-synchronized time
  const getServerTime = () => {
    const localTime = new Date();
    return new Date(localTime.getTime() + serverTimeOffset);
  };

  // Seconds until next 4-minute boundary (00, 04, 08, ...)
  const getSecondsUntilNextInterval = () => {
    const serverTime = getServerTime();

    const minutes = serverTime.getMinutes();
    const seconds = serverTime.getSeconds();
    const milliseconds = serverTime.getMilliseconds();

    const currentTotalSeconds =
      minutes * 60 + seconds + milliseconds / 1000;

    const remainder = currentTotalSeconds % INTERVAL_SECONDS;
    const secondsUntilNext =
      remainder === 0
        ? INTERVAL_SECONDS
        : INTERVAL_SECONDS - remainder;

    return Math.ceil(secondsUntilNext);
  };

  // Format mm:ss
  const formatCountdown = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!isTimeSynced) return;

    const interval = setInterval(() => {
      const secondsLeft = getSecondsUntilNextInterval();
      setCountdown(secondsLeft);

      // Trigger sync right after the cron boundary
      if (secondsLeft <= 1) {
        setTimeout(() => {
          onSyncNeeded();
        }, 2000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isTimeSynced, serverTimeOffset, onSyncNeeded]);

  return (
    <div className="bg-black/40 backdrop-blur-md border border-white/20 shadow-2xl p-6 sm:p-8 text-center mb-8 min-w-[280px]">
      <div className="flex items-center justify-center gap-2 mb-3">
        <p className="text-base font-semibold text-white">Next gift in</p>
        {!isTimeSynced && (
          <span className="text-xs text-yellow-400 bg-yellow-400/20 px-2 py-1 rounded">
            Syncing...
          </span>
        )}
      </div>

      <div className="bg-[#67D682] rounded-2xl p-4">
        <h2 className="text-5xl sm:text-6xl font-bold">
          {formatCountdown(countdown)}
        </h2>
      </div>

      <div className="mt-3">
        <p className="text-xs text-white/60 mx-[10%]">
          *Gift takes about ~40 sec to reach the winner
        </p>
      </div>
    </div>
  );
};

export default CountdownTimer;
