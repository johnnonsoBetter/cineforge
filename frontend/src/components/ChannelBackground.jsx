import * as React from "react";

export const ChannelBackground = React.memo(({ channel }) => {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background: `linear-gradient(135deg,
          ${channel.colors[0]},
          ${channel.colors[1]},
          ${channel.colors[2]})`,
      }}
    >
      {channel.shapes === "organic" && <Organic channel={channel} />}

      {channel.shapes === "stars" && <Stars channel={channel} />}

      {channel.shapes === "waves" && <Waves channel={channel} />}

      {channel.shapes === "grid" && <Grid channel={channel} />}

      {channel.shapes === "bars" && <Bars />}
    </div>
  );
});

function Organic({ channel }) {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full animate-pulse"
          style={{
            width: 120 + i * 40,
            height: 120 + i * 40,
            left: `${10 + Math.random() * 70}%`,
            top: `${10 + Math.random() * 70}%`,
            transform: "translate(-50%,-50%)",
            background: channel.accent,
            opacity: 0.08,
            animationDuration: `${6 + i}s`,
          }}
        />
      ))}
    </>
  );
}

export const Stars = React.memo(({ channel }) => {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute left-[-20%] right-[-20%] rounded-full"
          style={{
            top: `${15 + i * 18}%`,
            height: 2,
            background: channel.accent,
            opacity: 0.18,
            transform: `rotate(${i % 2 ? -3 : 3}deg)`,
          }}
        />
      ))}
    </>
  );
});

export const Grid = React.memo(({ channel }) => {
  return (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage: `
        linear-gradient(${channel.accent}22 1px, transparent 1px),
        linear-gradient(90deg, ${channel.accent}22 1px, transparent 1px)
      `,
        backgroundSize: "32px 32px",
      }}
    />
  );
});

function Bars() {
  const colors = [
    "#ff3b30",
    "#ff9500",
    "#ffd60a",
    "#34c759",
    "#64d2ff",
    "#0a84ff",
    "#bf5af2",
    "#ffffff",
  ];

  return (
    <div className="absolute inset-0 flex items-end">
      {colors.map((color, i) => (
        <div
          key={i}
          className="flex-1"
          style={{
            background: color,
            height: `${65 + Math.random() * 25}%`,
            opacity: 0.75,
          }}
        />
      ))}
    </div>
  );
}

export default ChannelBackground;