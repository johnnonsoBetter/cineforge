export type ChannelShape =
  | "organic"
  | "stars"
  | "waves"
  | "grid"
  | "bars";

export interface Channel {
  id: number;
  num: string;
  title: string;
  subtitle: string;
  badge: string;
  colors: string[];
  accent: string;
  shapes: ChannelShape;
}

export const channels: Channel[] = [
  {
    id: 0,
    num: "CH 01",
    title: "Nature's Canvas",
    subtitle: "Wildlife Documentary",
    badge: "HD",
    colors: ["#1a3a2a", "#0a2018", "#2a4a3a"],
    accent: "#4aaa6a",
    shapes: "organic",
  },
  {
    id: 1,
    num: "CH 02",
    title: "Deep Space",
    subtitle: "Astronomy Series",
    badge: "4K",
    colors: ["#0a0a2a", "#05051a", "#15152a"],
    accent: "#6a6aee",
    shapes: "stars",
  },
  {
    id: 2,
    num: "CH 03",
    title: "Ocean Drift",
    subtitle: "Marine Discovery",
    badge: "HD",
    colors: ["#0a1a3a", "#051025", "#152040"],
    accent: "#2a8acc",
    shapes: "waves",
  },
  {
    id: 3,
    num: "CH 04",
    title: "Neon City",
    subtitle: "Urban Nightlife",
    badge: "LIVE",
    colors: ["#1a0a2a", "#100518", "#251535"],
    accent: "#cc4aaa",
    shapes: "grid",
  },
  {
    id: 4,
    num: "CH 05",
    title: "Retro Broadcast",
    subtitle: "Classic Collection",
    badge: "SD",
    colors: ["#2a1a0a", "#1a1005", "#352515"],
    accent: "#c8a96e",
    shapes: "bars",
  },
];