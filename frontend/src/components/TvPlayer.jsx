import { useTvPlayer } from "../hooks/useTvPlayer";
import Screen from "./Screen";

export default function TvPlayer() {
  const {
    channels,
    current,
    currentChannel,

    isPlaying,
    isMuted,
    volume,

    progressPercent,
    formattedTime,

    isPowered,
    showStatic,
    showControls,

    togglePlay,
    toggleMute,
    togglePower,

    updateVolume,

    seek,

    revealControls,

    switchChannel,

    nextChannel,
    previousChannel,
  } = useTvPlayer();

  return (
    <section className="relative flex justify-center items-center py-16 px-4">

      {/* Background glow */}

      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[70%] h-8 bg-amber-300/10 blur-3xl" />

      {/* TV */}

      <div className="relative w-full max-w-[650px]">

        {/* ON AIR */}

        {isPlaying && (
          <div className="absolute left-1/2 -translate-x-1/2 -top-3 z-30">
            <div className="rounded bg-red-600 px-3 py-1 text-[10px] font-bold tracking-[3px] text-white shadow-lg">
              ● ON AIR
            </div>
          </div>
        )}

        {/* Body */}

        <div
          className="
          rounded-[26px]
          bg-gradient-to-br
          from-stone-700
          via-stone-800
          to-stone-950
          p-5
          shadow-2xl
          border
          border-stone-700
        "
        >
          {/* Header */}

          <div className="mb-3 flex items-center justify-between">

            <h3 className="font-black tracking-[5px] text-amber-400 uppercase text-xs">
              Lumina
            </h3>

            <div className="flex gap-2">

              <div className="h-2 w-2 rounded-full bg-stone-600" />

              <div
                className={`h-2 w-2 rounded-full ${
                  isPowered
                    ? "bg-red-500 shadow-[0_0_8px_red]"
                    : "bg-stone-600"
                }`}
              />

              <div className="h-2 w-2 rounded-full bg-stone-600" />

            </div>

          </div>

          {/* Screen */}

          <Screen
            channel={current}
            powered={isPowered}
            playing={isPlaying}
            muted={isMuted}
            volume={volume}
            progressPercent={progressPercent}
            formattedTime={formattedTime}
            showControls={showControls}
            showStatic={showStatic}
            onPlayPause={togglePlay}
            onPrev={previousChannel}
            onNext={nextChannel}
            onSeek={seek}
            onVolume={updateVolume}
            onMute={toggleMute}
            onRevealControls={revealControls}
          />

          {/* Footer */}

          <div className="mt-4 flex items-center justify-between">

            {/* Channels */}

            <div className="flex flex-wrap gap-2">

              {channels.map((channel, index) => (
                <button
                  key={channel.id}
                  onClick={() => switchChannel(index)}
                  className={`rounded-md border px-3 py-1 text-xs transition
                  
                    ${
                      currentChannel === index
                        ? "border-amber-500 bg-amber-900/40 text-amber-300"
                        : "border-stone-700 bg-stone-900 text-stone-400 hover:border-stone-500"
                    }
                  `}
                >
                  {channel.title}
                </button>
              ))}

            </div>

            {/* Power */}

            <button
              onClick={togglePower}
              className="
                relative
                flex
                h-10
                w-10
                items-center
                justify-center
                rounded-full
                border-2
                border-stone-600
                bg-gradient-to-br
                from-stone-700
                to-stone-900
                shadow-lg
                hover:scale-105
                transition
              "
            >
              <div className="absolute top-1 h-2 w-[2px] rounded bg-amber-400" />
            </button>

          </div>
        </div>

        {/* Stand */}

        <div className="flex flex-col items-center">

          <div className="h-5 w-16 rounded-b bg-stone-800 shadow-lg" />

          <div className="h-3 w-36 rounded-b-lg bg-stone-900 shadow-xl" />

        </div>

      </div>
    </section>
  );
}