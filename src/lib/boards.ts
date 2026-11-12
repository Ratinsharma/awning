import type { BoardItem } from "./diff";

export const OPENING_BOARD: BoardItem[] = [
  { name: "Pot of tea", priceCents: 300, available: true, leadHours: 0, allergens: [], detail: "House blend" },
  {
    name: "Buttermilk scone",
    priceCents: 350,
    available: true,
    leadHours: 0,
    allergens: ["gluten", "dairy"],
    detail: "With butter",
  },
  {
    name: "Soup of the day",
    priceCents: 700,
    available: true,
    leadHours: 0,
    allergens: ["gluten"],
    detail: "Ask the counter",
  },
  {
    name: "Vanilla birthday cake",
    priceCents: 4800,
    available: true,
    leadHours: 24,
    allergens: ["gluten", "dairy", "egg"],
    detail: "12 slices, nut-free, 24 hours' notice",
  },
  {
    name: "Almond croissant",
    priceCents: 450,
    available: true,
    leadHours: 0,
    allergens: ["gluten", "dairy", "nuts"],
    detail: "Contains almonds",
  },
];

export const RESYNC_BOARD: BoardItem[] = [
  { name: "Pot of tea", priceCents: 300, available: true, leadHours: 0, allergens: [] },
  {
    name: "Buttermilk scone",
    priceCents: 380,
    available: true,
    leadHours: 0,
    allergens: ["gluten", "dairy"],
  },
  {
    name: "Soup of the day",
    priceCents: 700,
    available: false,
    leadHours: 0,
    allergens: ["gluten"],
    detail: "Sold out",
  },
  {
    name: "Vanilla birthday cake",
    priceCents: 4800,
    available: true,
    leadHours: 24,
    allergens: ["gluten", "dairy", "egg"],
  },
  {
    name: "Almond croissant",
    priceCents: 450,
    available: true,
    leadHours: 0,
    allergens: ["gluten", "dairy", "nuts"],
  },
  {
    name: "Gluten-free brownie",
    priceCents: 450,
    available: true,
    leadHours: 0,
    allergens: ["egg", "dairy"],
    detail: "Nut-free",
  },
];

export const SAMPLE_ASK = "Oat-milk flat white and a gluten-free brownie, nut-free, under €60.";
