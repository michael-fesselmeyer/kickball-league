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
] as const;

export type ColorToken = (typeof colorTokens)[number];
export type Theme = Record<ColorToken, Hex>;

export const light: Theme = {
  bg: "#FBF8F1",
  surface: "#FFFFFF",
  "surface-2": "#F2EDE1",
  text: "#14182B",
  "text-muted": "#4A5068",
  border: "#D9D2C0",
  "border-strong": "#8C8672",
  brand: "#1F3A8A",
  "on-brand": "#FFFFFF",
  accent: "#B3261E",
  "on-accent": "#FFFFFF",
  highlight: "#F5B301",
  "on-highlight": "#14182B",
  success: "#1A7B49",
  warning: "#9F5B00",
  danger: "#B3261E",
  info: "#1F5FBF",
  focus: "#1F3A8A",
};

export const dark: Theme = {
  bg: "#0E1220",
  surface: "#161B2E",
  "surface-2": "#1F2640",
  text: "#F3EFE6",
  "text-muted": "#A9B0C7",
  border: "#2E3757",
  "border-strong": "#656F97",
  brand: "#8FA8FF",
  "on-brand": "#0E1220",
  accent: "#FF7A6E",
  "on-accent": "#0E1220",
  highlight: "#FFC93C",
  "on-highlight": "#0E1220",
  success: "#4CC38A",
  warning: "#F0A840",
  danger: "#FF7A6E",
  info: "#7FB0FF",
  focus: "#FFC93C",
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
  ]),
  { fg: "on-brand", bg: "brand", min: AA.text, why: "primary buttons" },
  { fg: "on-accent", bg: "accent", min: AA.text, why: "accent buttons" },
  { fg: "on-highlight", bg: "highlight", min: AA.text, why: "winner badges" },
];
