import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
} from "lucide-react";

import ChannelBackground from "./ChannelBackground";
import StaticNoise from "./StaticNoise";

export default function Screen({
  channel,
  powered,
  playing,
  muted,
  volume,
  progressPercent,
  formattedTime,
  showControls,
  showStatic,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onMute,
  onRevealControls,
}) {
  return (
    <div className="bg-black rounded-xl p-2 shadow-inner">

      <div
        className="relative overflow-hidden rounded-md aspect-video bg-black cursor-pointer"
        onClick={onRevealControls}
      >

        {/* Animated Background */}

        {powered && (
          <ChannelBackground channel={channel} />
        )}

        {/* CRT Scanlines */}

        <div
          className="absolute inset-0 pointer-events-none z-30"
          style={{
            background:
              "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,.04) 3px, rgba(0,0,0,.04) 4px)",
          }}
        />

        {/* Glass Reflection */}

        <div
          className="absolute inset-x-0 top-0 h-1/3 z-30 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,.05), transparent)",
          }}
        />

        {/* Static */}

        <StaticNoise active={showStatic} />

        {/* Powered Off */}

        {!powered && (
          <div className="absolute inset-0 bg-black z-20" />
        )}

        {/* Channel Display */}

        {powered && (
          <>

            <div className="absolute top-3 left-3 z-20">

              <span className="font-mono text-[11px] tracking-widest text-white/60">

                {channel.num}

              </span>

            </div>

            <div className="absolute top-3 right-3 z-20">

              <span className="font-mono text-[10px] tracking-widest text-yellow-500">

                {channel.badge}

              </span>

            </div>

            {/* Center */}

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayPause();
                }}
                className="h-16 w-16 rounded-full border border-white/20 bg-white/10 backdrop-blur-md flex items-center justify-center hover:scale-105 transition"
              >
                {playing ? (
                  <Pause className="w-7 h-7 text-white" />
                ) : (
                  <Play className="w-7 h-7 text-white ml-1" />
                )}
              </button>

              <div className="text-center">

                <h3 className="text-white font-semibold text-lg">

                  {channel.title}

                </h3>

                <p className="uppercase tracking-widest text-white/60 text-xs">

                  {channel.subtitle}

                </p>

              </div>

            </div>

          </>
        )}

        {/* Controls */}

        <div
          className={`absolute bottom-0 left-0 right-0 transition-transform duration-300 bg-gradient-to-t from-black/95 to-transparent p-4 z-40 ${
            showControls
              ? "translate-y-0"
              : "translate-y-full"
          }`}
        >

          {/* Progress */}

          <div
            className="mb-4 h-1 rounded-full bg-white/20 cursor-pointer"
            onClick={(e) => {

              const rect =
                e.currentTarget.getBoundingClientRect();

              const percent =
                (e.clientX - rect.left) / rect.width;

              onSeek(percent);

            }}
          >

            <div
              className="relative h-full rounded-full bg-yellow-500"
              style={{
                width: `${progressPercent}%`,
              }}
            >

              <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-yellow-500 shadow-lg" />

            </div>

          </div>

          {/* Controls */}

          <div className="flex items-center gap-2">

            <button
              onClick={onPlayPause}
              className="p-2 rounded hover:bg-white/10"
            >
              {playing ? (
                <Pause size={18} />
              ) : (
                <Play size={18} />
              )}
            </button>

            <button
              onClick={onPrev}
              className="p-2 rounded hover:bg-white/10"
            >
              <SkipBack size={18} />
            </button>

            <button
              onClick={onNext}
              className="p-2 rounded hover:bg-white/10"
            >
              <SkipForward size={18} />
            </button>

            <span className="font-mono text-xs text-white/70">

              {formattedTime}

            </span>

            <div className="flex-1" />

            <button
              onClick={onMute}
              className="p-2 rounded hover:bg-white/10"
            >
              {muted ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>

            <input
              className="w-24"
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) =>
                onVolume(Number(e.target.value))
              }
            />

            <button className="p-2 rounded hover:bg-white/10">

              <Maximize2 size={18} />

            </button>

          </div>

        </div>

      </div>

    </div>
  );
}