import { useCallback, useEffect, useRef, useState } from "react";
import { channels } from "../data/channels";

const DEFAULT_DURATION = 300;

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function useTvPlayer() {
  const [currentChannel, setCurrentChannel] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);

  const [isMuted, setIsMuted] = useState(false);

  const [volume, setVolume] = useState(80);

  const [isPowered, setIsPowered] = useState(true);

  const [showStatic, setShowStatic] = useState(false);

  const [showControls, setShowControls] = useState(false);

  const [progress, setProgress] = useState(0);

  const [duration, setDuration] = useState(DEFAULT_DURATION);

  const hideControlsTimeout = useRef(null);

  const ticker = useRef(null);

  const current = channels[currentChannel];

  const clearTicker = () => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  };

  const startTicker = useCallback(() => {
    clearTicker();

    ticker.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= duration) {
          clearTicker();
          setIsPlaying(false);
          return duration;
        }

        return prev + 1;
      });
    }, 1000);
  }, [duration]);

  const togglePlay = useCallback(() => {
    if (!isPowered) return;

    setIsPlaying((p) => !p);
  }, [isPowered]);

  useEffect(() => {
    if (isPlaying) {
      startTicker();
    } else {
      clearTicker();
    }

    return clearTicker;
  }, [isPlaying, startTicker]);

  const seek = (percent) => {
    const value = Math.max(
      0,
      Math.min(duration, Math.round(duration * percent))
    );

    setProgress(value);
  };

  const randomDuration = () =>
    240 + Math.floor(Math.random() * 120);

  const switchChannel = (index) => {
    if (!isPowered) return;

    setShowStatic(true);

    clearTicker();

    setIsPlaying(false);

    setTimeout(() => {
      setCurrentChannel(index);
      setDuration(randomDuration());
      setProgress(0);
      setShowStatic(false);
    }, 350);
  };

  const nextChannel = () => {
    switchChannel((currentChannel + 1) % channels.length);
  };

  const previousChannel = () => {
    switchChannel(
      (currentChannel - 1 + channels.length) %
        channels.length
    );
  };

  const toggleMute = () => {
    if (isMuted) {
      setVolume(80);
      setIsMuted(false);
    } else {
      setVolume(0);
      setIsMuted(true);
    }
  };

  const updateVolume = (value) => {
    setVolume(value);

    setIsMuted(value === 0);
  };

  const togglePower = () => {
    if (isPowered) {
      clearTicker();

      setIsPlaying(false);

      setShowStatic(true);

      setTimeout(() => {
        setIsPowered(false);
        setShowStatic(false);
      }, 300);
    } else {
      setIsPowered(true);

      setProgress(0);

      setDuration(randomDuration());

      setTimeout(() => {
        setShowStatic(false);
      }, 250);
    }
  };

  const revealControls = () => {
    if (!isPlaying) return;

    setShowControls(true);

    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }

    hideControlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, 2500);
  };

  useEffect(() => {
    const handler = (e) => {
      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;

        case "ArrowRight":
          nextChannel();
          break;

        case "ArrowLeft":
          previousChannel();
          break;

        case "KeyM":
          toggleMute();
          break;

        case "KeyP":
          togglePower();
          break;
      }
    };

    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  });

  useEffect(() => {
    return () => {
      clearTicker();

      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, []);

  return {
    channels,

    current,

    currentChannel,

    isPlaying,

    isMuted,

    volume,

    progress,

    duration,

    isPowered,

    showStatic,

    showControls,

    progressPercent: (progress / duration) * 100,

    formattedTime: `${formatTime(progress)} / ${formatTime(duration)}`,

    togglePlay,

    toggleMute,

    togglePower,

    updateVolume,

    seek,

    revealControls,

    switchChannel,

    nextChannel,

    previousChannel,
  };
}
