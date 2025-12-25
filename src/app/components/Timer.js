// components/CountdownTimer.js
"use client";

import { useEffect, useState } from "react";

const CountdownTimer = ({ serverTimeOffset, isTimeSynced, onSyncNeeded }) => {
  const [countdown, setCountdown] = useState(14400); // 4 hours in seconds

  // Get server-synchronized time
  const getServerTime = () => {
    const localTime = new Date();
    return new Date(localTime.getTime() + serverTimeOffset);
  };

  // Calculate seconds until next 4-hour interval using server time
  const getSecondsUntilNext4Hours = () => {
    const serverTime = getServerTime();
    const hours = serverTime.getHours();
    const minutes = serverTime.getMinutes();
    const seconds = serverTime.getSeconds();
    const milliseconds = serverTime.getMilliseconds();
    
    // 4-hour intervals: 0, 4, 8, 12, 16, 20
    const validHours = [0, 4, 8, 12, 16, 20];
    
    // Find the next valid hour
    let nextValidHour = validHours.find(validHour => validHour > hours);
    
    // If no valid hour found today, next is 0 (midnight tomorrow)
    if (!nextValidHour) {
      nextValidHour = 24; // Will be handled as next day at 00:00
    }
    
    // Calculate total elapsed time since the last valid hour mark
    const lastValidHour = validHours.filter(validHour => validHour <= hours).pop() || 0;
    const hoursElapsed = hours - lastValidHour;
    const totalElapsedMs = (hoursElapsed * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
    
    // Calculate milliseconds until the next 4-hour mark
    const hoursUntilNext = nextValidHour - hours;
    const millisecondsUntilNext = (hoursUntilNext * 60 * 60 * 1000) - (minutes * 60 * 1000) - (seconds * 1000) - milliseconds;
    
    return Math.ceil(millisecondsUntilNext / 1000);
  };

  // Format countdown display (hh:mm:ss)
  const formatCountdown = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Update countdown every second
  useEffect(() => {
    if (!isTimeSynced) return;

    const interval = setInterval(() => {
      const secondsLeft = getSecondsUntilNext4Hours();
      setCountdown(secondsLeft);
      
      // Trigger sync when we're close to the next distribution (within 1 second of a 4-hour mark)
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
        <h2 className="text-5xl sm:text-6xl font-bold">{formatCountdown(countdown)}</h2>
      </div>
      <div className="mt-3">
        <p className="text-xs text-white/60 mx-[10%]">
          *Gift takes about ~40sec. to get to winner
        </p>
      </div>
    </div>
  );
};

export default CountdownTimer;