import { EMBEDDED_FONTS, type FontFiles } from "./fonts-manifest";

/**
 * Font support for text editing.
 *
 * - Built-in fonts: the PDF base-14 fonts (Helvetica / Times / Courier),
 *   always available, never embedded.
 * - Bundled fonts: free (SIL OFL) TTFs copied into public/fonts by
 *   scripts/copy-fonts.mjs. Rendered live via @font-face and embedded into
 *   the saved PDF with pdf-lib's fontkit (subset).
 */
export interface FontChoice {
  id: string;
  label: string;
  cssFamily: string;
  italicSupported: boolean;
  /** ttf files, present only for bundled (embedded) fonts */
  files?: FontFiles;
}

const BUILTIN_FONTS: FontChoice[] = [
  {
    id: "helvetica",
    label: "Helvetica",
    cssFamily: "Helvetica, Arial, sans-serif",
    italicSupported: true
  },
  {
    id: "times",
    label: "Times",
    cssFamily: "'Times New Roman', Times, serif",
    italicSupported: true
  },
  {
    id: "courier",
    label: "Courier",
    cssFamily: "'Courier New', Courier, monospace",
    italicSupported: true
  }
];

const BUNDLED_FONTS: FontChoice[] = EMBEDDED_FONTS.map((f) => ({
  id: f.id,
  label: f.label,
  cssFamily: `"${f.familyName}", Arial, sans-serif`,
  italicSupported: f.italicSupported,
  files: f.files
}));

export const FONT_CHOICES: FontChoice[] = [...BUILTIN_FONTS, ...BUNDLED_FONTS];

export const DEFAULT_FONT_FAMILY = "helvetica";

export function findFontChoice(id: string): FontChoice {
  return FONT_CHOICES.find((f) => f.id === id) ?? FONT_CHOICES[0];
}

export type FontStyleSlot = "regular" | "bold" | "italic" | "boldItalic";

export function styleSlot(bold: boolean, italic: boolean): FontStyleSlot {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

/** The effective style slot after clamping unsupported italic variants. */
export function effectiveSlot(
  choice: FontChoice,
  bold: boolean,
  italic: boolean
): { slot: FontStyleSlot; fakeItalic: boolean } {
  const want = styleSlot(bold, italic);
  if (want === "italic" && !choice.italicSupported && !choice.files?.italic) {
    return { slot: "regular", fakeItalic: true };
  }
  if (want === "boldItalic" && choice.italicSupported && !choice.files?.boldItalic) {
    return { slot: "bold", fakeItalic: true };
  }
  return { slot: want, fakeItalic: false };
}

/** CSS font shorthand for the live overlay preview of an edit. */
export function fontCssForEdit(edit: {
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  fontSizePx: number;
  lineGap: number;
}): string {
  const choice = findFontChoice(edit.fontFamily);
  const weight = edit.bold ? "700" : "400";
  const style = edit.italic && choice.italicSupported ? "italic" : "";
  return `${style} ${weight} ${edit.fontSizePx}px/${edit.lineGap} ${choice.cssFamily}`.trimStart();
}

/* ------------------------------------------------------------------ */
/* @font-face loading for the live preview                             */
/* ------------------------------------------------------------------ */

const faceRegistration = new Map<string, Promise<void>>();

function fontFaceUrl(file: string): string {
  // resolves <dist>/index.html → <dist>/fonts/<file> in prod, /fonts/... in dev
  return new URL(`fonts/${file}`, document.baseURI).href;
}

/** Register + load the @font-face entries for one choice (idempotent). */
export function ensureFontFaces(choiceId: string): Promise<void> {
  const existing = faceRegistration.get(choiceId);
  if (existing) return existing;

  const choice = findFontChoice(choiceId);
  if (!choice.files) return Promise.resolve(); // builtin — system fonts

  const promise = Promise.all(
    Object.entries(choice.files)
      .flatMap(([slot, file]): [string, string][] => (file ? [[slot, file]] : []))
      .map(([slot, file]) => {
        const descriptors: FontFaceDescriptors = {};
        if (slot.startsWith("bold")) descriptors.weight = "700";
        if (slot.includes("Italic")) descriptors.style = "italic";
        const face = new FontFace(
          choice.cssFamily.split(",")[0].replace(/["']/g, ""),
          `url(${JSON.stringify(fontFaceUrl(file))})`,
          descriptors
        );
        const loaded = face.load().then((f) => document.fonts.add(f));
        loaded.catch((err) =>
          console.warn(`font face failed to load: ${file}`, err)
        );
        return loaded;
      })
  )
    .then(() => undefined)
    .catch(() => {
      // never block editing on face loading; preview falls back gracefully
      faceRegistration.delete(choiceId);
    });

  faceRegistration.set(choiceId, promise);
  return promise;
}

/** Preload faces for every family referenced by the given edits (highlight
 * edits have no fontFamily and are skipped). */
export function ensureFontFacesForEdits(
  edits: { fontFamily?: string }[],
  currentSelection: string
): Promise<void> {
  const ids = new Set(edits.map((e) => e.fontFamily).filter((id): id is string => Boolean(id)));
  ids.add(currentSelection);
  return Promise.all([...ids].map(ensureFontFaces)).then(() => undefined);
}
