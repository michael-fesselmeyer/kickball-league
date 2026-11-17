import { AA, type Hex } from "@/domain/color/contrast";

/**
 * Color tokens from docs/design-system.md, section 2. This is the single list
 * of values: src/app/globals.css must set exactly these (a test checks), and
 * the contrast pairs below are asserted against WCAG 2.2 AA.
 */
export const colorTokens = [
  "bg",
  "surface",
  "surface-2",
  "text",
  "text-muted",
  "border",
  "border-strong",
  "brand",
  "on-brand",
  "accent",
  "on-accent",
  "highlight",
  "on-highlight",
  "success",
  "warning",
  "danger",
  "info",
  "focus",
  "chart-1",
  "chart-2",
] as const;

export type ColorToken = (typeof colorTokens)[number];
export type Theme = Record<ColorToken, Hex>;

export const light: Theme = {
  bg: "#F6EBD3",
  surface: "#FFF8EA",
  "surface-2": "#EFDFC0",
  text: "#1B2547",
  "text-muted": "#4D4B5E",
  border: "#E2CDA4",
  "border-strong": "#857049",
  brand: "#233C7D",
  "on-brand": "#FFF8EA",
  accent: "#781B22",
  "on-accent": "#FFF8EA",
  highlight: "#F2A33A",
  "on-highlight": "#1B2547",
  success: "#196A41",
  warning: "#874C00",
  danger: "#AE231C",
  info: "#1F58B5",
  focus: "#233C7D",
  "chart-1": "#2A6FCB",
  "chart-2": "#C24E1A",
};

export const dark: Theme = {
  bg: "#0F1730",
  surface: "#172244",
  "surface-2": "#1F2C55",
  text: "#F6EBD3",
  "text-muted": "#B4B9CE",
  border: "#2E3B66",
  "border-strong": "#6B78A5",
  brand: "#9DB4FF",
  "on-brand": "#0F1730",
  accent: "#FF8A80",
  "on-accent": "#0F1730",
  highlight: "#F7B955",
  "on-highlight": "#0F1730",
  success: "#4CC38A",
  warning: "#F0A840",
  danger: "#FF7A6E",
  info: "#7FB0FF",
  focus: "#F7B955",
  "chart-1": "#3987E5",
  "chart-2": "#D95926",
};

type Pair = { fg: ColorToken; bg: ColorToken; min: number; why: string };

/** Every pairing the UI is allowed to use, with the WCAG minimum it must meet. */
export const contrastPairs: readonly Pair[] = [
  ...(["bg", "surface", "surface-2"] as const).flatMap((bg) => [
    { fg: "text" as const, bg, min: AA.text, why: "body text" },
    { fg: "text-muted" as const, bg, min: AA.text, why: "secondary text" },
    { fg: "brand" as const, bg, min: AA.text, why: "links" },
    { fg: "danger" as const, bg, min: AA.text, why: "error messages" },
    { fg: "success" as const, bg, min: AA.text, why: "status text" },
    { fg: "warning" as const, bg, min: AA.text, why: "status text" },
    { fg: "info" as const, bg, min: AA.text, why: "notices" },
    {
      fg: "border-strong" as const,
      bg,
      min: AA.nonText,
      why: "control outlines",
    },
    { fg: "focus" as const, bg, min: AA.nonText, why: "focus ring" },
    { fg: "chart-1" as const, bg, min: AA.nonText, why: "chart marks" },
    { fg: "chart-2" as const, bg, min: AA.nonText, why: "chart marks" },
  ]),
  { fg: "on-brand", bg: "brand", min: AA.text, why: "primary buttons" },
  { fg: "on-accent", bg: "accent", min: AA.text, why: "accent buttons" },
  { fg: "on-highlight", bg: "highlight", min: AA.text, why: "winner badges" },
];
