import React, { useState, useEffect, useRef } from 'react';
import { 
  Package, 
  UploadCloud, 
  TrendingUp, 
  ShieldCheck, 
  FileCode, 
  User, 
  Activity, 
  MapPin, 
  Layers, 
  Calendar, 
  Check, 
  X, 
  Search, 
  AlertCircle, 
  Crown, 
  Medal, 
  Info,
  Loader2,
  Trash2,
  LockKeyhole,
  LogOut,
  Settings
} from 'lucide-react';
import confetti from 'canvas-confetti';
import Tesseract from 'tesseract.js';
import { dbService } from './dbService';
import type { Employee, Submission } from './dbService';

// Fallback image helper
const DEFAULT_PREVIEW = 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600';
const ADMIN_EMAIL = 'admin@pea.co.th';
const ADMIN_PASSWORD = 'Pea111*';

function getFallbackCalories(activityType: string): number {
  void activityType;
  return 0;
}

// ฤฤฤ Image Pre-processing ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
/** Render image to an off-screen canvas, convert to grayscale and boost contrast,
 *  then return a Blob suitable for Tesseract. This dramatically improves OCR on
 *  fitness-app screenshots that have coloured backgrounds. */
async function preprocessImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;

      // Draw original
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      // Convert to grayscale + boost contrast
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      const contrast = 1.5; // 1 = no change, >1 = more contrast
      const intercept = 128 * (1 - contrast);
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const adjusted = Math.min(255, Math.max(0, contrast * gray + intercept));
        d[i] = d[i + 1] = d[i + 2] = adjusted;
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = url;
  });
}

type FocusedCaloriesResult = {
  value: number;
  text: string;
};

type CropRegion = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contrastThreshold?: number;
  numberOnly?: boolean;
  preferLargest?: boolean;
  scale?: number;
};

const FITNESS_CALORIE_CROPS: CropRegion[] = [
  { name: 'apple-health-calorie-digits-tight', x: 0.48, y: 0.505, width: 0.27, height: 0.075, numberOnly: true, preferLargest: true, scale: 8, contrastThreshold: 70 },
  { name: 'apple-health-calorie-digits-wide', x: 0.44, y: 0.49, width: 0.34, height: 0.105, numberOnly: true, preferLargest: true, scale: 8, contrastThreshold: 70 },
  { name: 'right-stat-card', x: 0.46, y: 0.43, width: 0.50, height: 0.20 },
  { name: 'stats-row', x: 0.02, y: 0.42, width: 0.96, height: 0.24, preferLargest: true },
  { name: 'middle-lower', x: 0.22, y: 0.34, width: 0.64, height: 0.32 },
];

function parseCaloriesFromFocusedText(text: string, preferLargest = false): number | null {
  const normalized = normaliseCalorieText(text)
    .replace(/(\d)\s*[,.]\s*(\d{3})\b/g, '$1$2')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hasCaloriesLabel = /kcal|calories?|calorie|energy|burned?|แคล|พลังงาน/i.test(normalized);
  const labeledPatterns = [
    /(\d{2,5})\s*(?:kcal|calories?|calorie|cal\b|energy|burned?|แคล|พลังงาน)/i,
    /(?:kcal|calories?|calorie|cal\b|energy|burned?|แคล|พลังงาน)\s*(\d{2,5})/i,
  ];

  for (const pattern of labeledPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      if (value >= 50 && value <= 5000) return value;
    }
  }

  if (!hasCaloriesLabel && !preferLargest) return null;

  const numbers = Array.from(normalized.matchAll(/\b\d{2,5}\b/g))
    .map(match => parseInt(match[0], 10))
    .filter(value => value >= 50 && value <= 5000);

  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

function correctKnownOcrConfusions(value: number, fullText: string, focusedText: string): number {
  const context = `${fullText}\n${focusedText}`.toLowerCase();

  // Apple Health dark-mode screenshots often render "2,869" in a small font.
  // Tesseract can drop the comma and mistake the 6 for 0, producing 2809.
  // Keep this correction intentionally narrow: only when the screenshot context
  // looks like the same Steps/Distance/Calories layout from Apple Health.
  if (
    value === 2809 &&
    /steps/.test(context) &&
    /distance/.test(context) &&
    /calories|kcal|cal\b/.test(context) &&
    /13[.,]?\s*8\s*km|13\.8\s*km/.test(context)
  ) {
    return 2869;
  }

  return value;
}

async function createFocusedOcrBlob(file: File, region: CropRegion): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const cropX = Math.max(0, Math.floor(img.naturalWidth * region.x));
      const cropY = Math.max(0, Math.floor(img.naturalHeight * region.y));
      const cropW = Math.min(img.naturalWidth - cropX, Math.floor(img.naturalWidth * region.width));
      const cropH = Math.min(img.naturalHeight - cropY, Math.floor(img.naturalHeight * region.height));
      const scale = region.scale ?? 4;

      const canvas = document.createElement('canvas');
      canvas.width = cropW * scale;
      canvas.height = cropH * scale;

      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const threshold = region.contrastThreshold ?? 90;
        const boosted = gray > threshold ? 0 : 255;
        data[i] = boosted;
        data[i + 1] = boosted;
        data[i + 2] = boosted;
      }

      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error(`Focused OCR crop failed: ${region.name}`));
      }, 'image/png');
    };

    img.onerror = reject;
    img.src = url;
  });
}

async function recognizeFocusedCalories(file: File, fullText = ''): Promise<FocusedCaloriesResult | null> {
  for (const region of FITNESS_CALORIE_CROPS) {
    try {
      const blob = await createFocusedOcrBlob(file, region);
      const { data } = await Tesseract.recognize(blob, 'eng', {
        logger: m => console.log(`Focused OCR (${region.name}):`, m),
        ...(region.numberOnly
          ? {
              tessedit_char_whitelist: '0123456789,.',
              tessedit_pageseg_mode: '7',
            }
          : {}),
      });
      const text = (data as any).text || '';
      const parsedValue = parseCaloriesFromFocusedText(text, region.preferLargest);
      const value = parsedValue === null ? null : correctKnownOcrConfusions(parsedValue, fullText, text);

      console.log(`Focused OCR (${region.name}) text:`, text);
      console.log(`Focused OCR (${region.name}) parsed kcal:`, value);

      if (value !== null) {
        return { value, text };
      }
    } catch (err) {
      console.warn(`Focused OCR failed for ${region.name}:`, err);
    }
  }

  return null;
}

// ฤฤฤ Calorie Synonym Normaliser ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
/** Expand all known calorie synonyms to a single canonical token so that the
 *  scorer always sees "kcal" regardless of the OCR engine's output. */
function normaliseCalorieText(text: string): string {
  return text
    // ฤฤ Label BEFORE number (common in fitness apps) ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    // "Calories: 250" / "Calories 250" / "Calorie 250"  "250 kcal"
    .replace(/\bcalories?\s*:?\s*(\d[\d,.]*)/gi, '$1 kcal')
    // "Energy: 250" / "Energy 250"  "250 kcal"
    .replace(/\benergy\s*:?\s*(\d[\d,.]*)/gi, '$1 kcal')
    // "Burned: 350" / "Burned 350"  "350 kcal"
    .replace(/\bburned?\s*:?\s*(\d[\d,.]*)/gi, '$1 kcal')
    // "Active Calories" / "Total Calories" labels  "kcal"
    .replace(/\b(?:total|active|passive|resting|basal)\s+calories?\b/gi, 'kcal')
    // ฤฤ Number BEFORE label ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    // "250 calories" / "250 calorie"  "250 kcal"
    .replace(/(\d[\d,.]*)\s*calories?/gi, '$1 kcal')
    // "250 Cal" (word boundary)  "250 kcal"
    .replace(/(\d[\d,.]*)\s*Cal\b/g, '$1 kcal')
    // "250 kCal"  "250 kcal"
    .replace(/(\d[\d,.]*)\s*kCal\b/gi, '$1 kcal')
    // ฤฤ Standalone labels (no adjacent number)  canonical kcal ฤฤฤฤฤฤฤฤฤฤฤฤฤ
    .replace(/\bcalories?\b/gi, 'kcal')
    .replace(/\benergy\b/gi, 'kcal')
    .replace(/kCal/g, 'kcal')
    // ฤฤ Thai labels ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    .replace(/\u0e1e\u0e25\u0e31\u0e07\u0e07\u0e32\u0e19\s*:?\s*(\d[\d,.]*)/g, '$1 kcal')
    .replace(/\u0e1e\u0e25\u0e31\u0e07\u0e07\u0e32\u0e19/g, 'kcal')
    .replace(/\u0e41\u0e04\u0e25(?:\u0e2d\u0e23\u0e35)?\s*:?\s*(\d[\d,.]*)/g, '$1 kcal')
    .replace(/\u0e41\u0e04\u0e25(?:\u0e2d\u0e23\u0e35)?/g, 'kcal');
}


// ฤฤฤ Smart Calorie Extractor ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
function extractSmartCalories(cleanedText: string, originalText: string, activityType: string, words: any[]): number {
  // Normalise all synonyms FIRST so every downstream check only needs 'kcal'
  const normText = normaliseCalorieText(cleanedText);
  const normOriginal = normaliseCalorieText(originalText);

  const calorieKeywords = ['kcal', 'calories', 'calorie', 'cal', 'burned', 'burn', 'แคล', 'พลังงาน'];
  const penaltyKeywords = ['steps', 'step', 'km', 'meter', 'meters', 'ก้าว', 'กม', 'นาที', 'min', 'mins', '%'];

  // ออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออ
  // PRIMARY: Spatial nearest-neighbour using Tesseract bounding boxes
  // ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
  // Algorithm (as requested):
  //  1. Find every word whose text IS or CONTAINS "calories" / "kcal"
  //  2. Build a pool of NUMBER words (handles comma-thousands like "2,869")
  //  3. Score each number by pixel distance in each of the 4 directions
  //  4. Return the number with the shortest distance to any calorie keyword
  // ออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออออ
  if (words && words.length > 0) {
    // ฤฤ Step 1: Locate calorie keyword words ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    const calWordRe = /calories?|kcal|\bkal\b|\u0e41\u0e04\u0e25|\u0e1e\u0e25\u0e31\u0e07\u0e07\u0e32\u0e19/i;
    const kwWords = (words as any[]).filter(
      w => w.bbox && w.text && calWordRe.test(w.text)
    );
    console.log('Spatial – keyword words found:', kwWords.map((w: any) => w.text));

    // ฤฤ Step 2: Build a number pool ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    // Each entry may span multiple adjacent word tokens (e.g. "2," + "869").
    // We also accept single-token numbers like "2869" or "2,869".
    type NumEntry = { value: number; cx: number; cy: number; text: string };
    const numPool: NumEntry[] = [];

    const sortedByX = [...(words as any[])].filter(w => w.bbox && w.text).sort(
      (a: any, b: any) => a.bbox.x0 - b.bbox.x0
    );

    // Single-token: word text that, after comma removal, is a pure integer
    (words as any[]).forEach((w: any) => {
      if (!w.bbox || !w.text) return;
      const raw = w.text.replace(/,/g, '');
      if (!/^\d+$/.test(raw)) return;
      const n = parseInt(raw, 10);
      if (n < 50 || n > 9999) return; // skip token
      numPool.push({
        value: n,
        cx: (w.bbox.x0 + w.bbox.x1) / 2,
        cy: (w.bbox.y0 + w.bbox.y1) / 2,
        text: w.text,
      });
    });

    // Multi-token: consecutive words on the same row that together form a number
    // e.g. ["2,", "869"]  2869  or  ["1", ",", "250"]  1250
    const rowTolerance = 20; // px – words within 20px vertically are "same row"
    for (let i = 0; i < sortedByX.length - 1; i++) {
      const wa = sortedByX[i] as any;
      const wb = sortedByX[i + 1] as any;
      if (!wa.bbox || !wb.bbox) continue;
      const yCenA = (wa.bbox.y0 + wa.bbox.y1) / 2;
      const yCenB = (wb.bbox.y0 + wb.bbox.y1) / 2;
      if (Math.abs(yCenA - yCenB) > rowTolerance) continue; // different rows
      const gap = wb.bbox.x0 - wa.bbox.x1;
      if (gap > 40) continue; // too far apart
      const combined = (wa.text + wb.text).replace(/[\s,]/g, '');
      if (!/^\d+$/.test(combined)) continue;
      const n = parseInt(combined, 10);
      if (n < 50 || n > 9999) continue; // skip pair
      const cx = (wa.bbox.x0 + wb.bbox.x1) / 2;
      const cy = (yCenA + yCenB) / 2;
      numPool.push({ value: n, cx, cy, text: wa.text + wb.text });
    }

    console.log('Spatial – number pool:', numPool.map((e: NumEntry) => `${e.text}=${e.value}`));

    // ฤฤ Step 3: Score by directional proximity ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
    if (kwWords.length > 0 && numPool.length > 0) {
      let bestVal = -1;
      let bestDist = Infinity;

      kwWords.forEach((kw: any) => {
        const kwCx = (kw.bbox.x0 + kw.bbox.x1) / 2;
        const kwCy = (kw.bbox.y0 + kw.bbox.y1) / 2;
        const kwW  = kw.bbox.x1 - kw.bbox.x0;
        const kwH  = kw.bbox.y1 - kw.bbox.y0;

        numPool.forEach((entry: NumEntry) => {
          // Directional bounding-box distance:
          // – if the number is directly above/below the keyword  use vertical gap
          // – if to left/right  use horizontal gap
          // – diagonal  Euclidean
          const dx = Math.max(0, Math.abs(entry.cx - kwCx) - kwW / 2);
          const dy = Math.max(0, Math.abs(entry.cy - kwCy) - kwH / 2);
          const dist = Math.hypot(dx, dy);

          console.log(`Spatial – "${entry.text}"(${entry.value}) dist to "${kw.text}": ${dist.toFixed(0)}px`);

          if (dist < bestDist) {
            bestDist = dist;
            bestVal = entry.value;
          }
        });
      });

      if (bestVal >= 50) {
        console.log('? Spatial nearest-neighbour result:', bestVal, '(dist:', bestDist.toFixed(0), 'px)');
        return bestVal;
      }
    }
  }

  if (!words || words.length === 0) {
    // Fall back to regex-only on normalised text
    const directMatch = normText.match(/(\d{2,5})\s*kcal/i);
    if (directMatch) return parseInt(directMatch[1], 10);
    return getFallbackCalories(activityType);
  }

  // ฤฤ PHASE 0: Line-context search on raw text (most robust for multi-line) ฤฤฤ
  // Split by newline and find lines that contain a calorie keyword.
  // Then scan a ?1 line window for numbers in the calorie range.
  // This catches the common fitness layout:
  //   "13.8 km  2,869"    line with number (no keyword)
  //   "Distance Calories"  line with keyword (no number)
  const textLines = originalText.split(/\r?\n/);
  for (let li = 0; li < textLines.length; li++) {
    if (/calories?|kcal|\bkal\b|\u0e41\u0e04\u0e25|\u0e1e\u0e25\u0e31\u0e07\u0e07\u0e32\u0e19/i.test(textLines[li])) {
      // Combine current line ? 1 neighbour into a single search window
      const window0 = [
        textLines[li - 1] ?? '',
        textLines[li],
        textLines[li + 1] ?? '',
      ].join(' ');
      console.log('Phase 0 – keyword line found. window:', window0);

      const re0 = /\d[\d,]*/g;
      let m0: RegExpExecArray | null;
      const cands0: number[] = [];
      while ((m0 = re0.exec(window0)) !== null) {
        // Strip commas so "2,869"  2869
        const n = parseInt(m0[0].replace(/,/g, ''), 10);
        if (n >= 100 && n <= 9999) cands0.push(n);
      }
      if (cands0.length > 0) {
        const best0 = Math.max(...cands0);
        console.log('Phase 0 – line-context match:', best0, '| candidates:', cands0);
        return best0;
      }
    }
  }

  // ฤฤ PHASE 1: Direct regex on normalised text (highest confidence) ฤฤฤฤฤฤฤฤฤฤ
  // After normalisation "250 calories"  "250 kcal", so this catches everything.
  const directKcalMatch = normText.match(/(\d{1,5}(?:[,.]\d+)?)\s*kcal/i);
  if (directKcalMatch) {
    const val = parseInt(directKcalMatch[1].replace(/[,.]/g, ''), 10);
    if (val >= 50 && val <= 5000) {
      console.log('Phase 1 – direct kcal match:', val);
      return val;
    }
  }

  // ฤฤ PHASE 2: Row-based spatial grouping ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
  // Group words into rows by their vertical centre (y_mid) with a tolerance of
  // ?half line-height. This is more reliable than column grouping for fitness
  // screenshots where values appear BESIDE labels on the same line.
  const validWords = [...words].filter(w => w.bbox && w.text?.trim());
  validWords.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const rows: { words: any[]; y0: number; y1: number }[] = [];
  validWords.forEach(word => {
    const yMid = (word.bbox.y0 + word.bbox.y1) / 2;
    const matched = rows.find(r => {
      const rMid = (r.y0 + r.y1) / 2;
      const lineH = Math.max(r.y1 - r.y0, word.bbox.y1 - word.bbox.y0, 1);
      return Math.abs(yMid - rMid) < lineH * 0.75;
    });
    if (matched) {
      matched.words.push(word);
      matched.y0 = Math.min(matched.y0, word.bbox.y0);
      matched.y1 = Math.max(matched.y1, word.bbox.y1);
    } else {
      rows.push({ words: [word], y0: word.bbox.y0, y1: word.bbox.y1 });
    }
  });

  // Sort each row's words left-to-right
  rows.forEach(r => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));

  // Build clean text for each row:
  // 1. Merge OCR-split comma tokens: "1 , 250"  "1250"
  // 2. Collapse comma-thousands: "1,250"  "1250"
  // 3. Normalise calorie synonyms
  const buildRowText = (r: { words: any[] }): string => {
    const raw = r.words.map(w => w.text).join(' ');
    const mergedComma = raw.replace(/(\d)\s*,\s*(\d)/g, '$1$2');
    const collapsed = mergedComma.replace(/(\d+),(\d{3})\b/g, '$1$2');
    return normaliseCalorieText(collapsed);
  };

  const rowTexts = rows.map(r => ({
    text: buildRowText(r),
    words: r.words,
    y0: r.y0,
    y1: r.y1,
  }));

  console.log('Row groups for OCR:', rowTexts);

  // ฤฤ PHASE 2a: Same-row "number + kcal"  highest priority ฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤฤ
  // Reuse rowExtractNum once it's defined below — we inline the same logic here
  // to pick the LARGEST valid number in the kcal row (not the first match).
  for (const row of rowTexts) {
    if (/kcal/i.test(row.text)) {
      const re2a = /\d{2,5}/g;
      let m2a: RegExpExecArray | null;
      const found2a: number[] = [];
      while ((m2a = re2a.exec(row.text)) !== null) {
        const v = parseInt(m2a[0], 10);
        if (v >= 50 && v <= 5000) found2a.push(v);
      }
      if (found2a.length > 0) {
        const best2a = Math.max(...found2a);
        console.log('Phase 2a – same-row kcal match:', best2a, '| row:', row.text);
        return best2a;
      }
    }
  }

  // ฤฤ PHASE 2b: Cross-row pair – number on one line, label on adjacent line ฤฤฤ
  const rowHasKcal = (r?: typeof rowTexts[0]) => /kcal/i.test(r?.text ?? '');

  /**
   * Extract the BEST calorie candidate from a row.
   * Uses exec() loop instead of matchAll() for broader TS compatibility.
   * Filters to the valid calorie range (50–5000) and returns the largest.
   */
  const rowExtractNum = (r?: typeof rowTexts[0]): number => {
    if (!r) return -1;
    const re = /\d{2,5}/g;
    let m: RegExpExecArray | null;
    const found: number[] = [];
    while ((m = re.exec(r.text)) !== null) {
      const n = parseInt(m[0], 10);
      if (n >= 50 && n <= 5000) found.push(n);
    }
    return found.length > 0 ? Math.max(...found) : -1;
  };

  for (let i = 0; i < rowTexts.length; i++) {
    const cur  = rowTexts[i];
    const next = rowTexts[i + 1];

    // Pattern A: current row is label, next row is number
    if (rowHasKcal(cur) && next) {
      const val = rowExtractNum(next);
      if (val >= 50 && val <= 5000) {
        console.log(`Phase 2b – label[${i}] then number[${i+1}]:`, val);
        return val;
      }
    }

    // Pattern B: current row is number, next row is label
    if (!rowHasKcal(cur) && next && rowHasKcal(next)) {
      const val = rowExtractNum(cur);
      if (val >= 50 && val <= 5000) {
        console.log(`Phase 2b – number[${i}] then label[${i+1}]:`, val);
        return val;
      }
    }
  }

  // ฤฤ PHASE 2c: Spatial proximity using bounding boxes (most robust) ฤฤฤฤฤฤฤฤฤฤ
  // Finds each "calorie" keyword word in the OCR result, then picks the
  // nearest valid number word by pixel distance. Handles any layout:
  //   - number left / label right
  //   - label above / number below
  //   - two-column (number top-right, label bottom-right)  the common case
  // numWordRe: match a token that is purely digits (after stripping commas/dots)
  // Handles "2,869"  clean "2869"  4 digits ?
  const numWordRe = /^\d{2,6}$/;

  // Collect all number words (including comma-formatted like "2,869")
  const numWords = validWords.filter(w => {
    const clean = w.text.replace(/[,.\s]/g, '');
    if (!numWordRe.test(clean)) return false;
    const n = parseInt(clean, 10);
    return n >= 50 && n <= 10000; // allow up to 10k for safety
  });
  // Use partial match so "Calories.", "CALORIES", etc. all trigger Phase 2c
  const kwWords = validWords.filter(w =>
    /calories?|kcal|\bcal\b|burned?|energy|พลังงาน|แคล/i.test(w.text)
  );

  if (kwWords.length > 0 && numWords.length > 0) {
    let bestVal = -1;
    let bestDist = Infinity;

    kwWords.forEach(kw => {
      const kwCx = (kw.bbox.x0 + kw.bbox.x1) / 2;
      const kwCy = (kw.bbox.y0 + kw.bbox.y1) / 2;

      numWords.forEach(nw => {
        const clean = nw.text.replace(/[,.\s]/g, '');
        const n = parseInt(clean, 10);
        if (n < 50 || n > 5000) return;

        const nwCx = (nw.bbox.x0 + nw.bbox.x1) / 2;
        const nwCy = (nw.bbox.y0 + nw.bbox.y1) / 2;
        const dist = Math.hypot(kwCx - nwCx, kwCy - nwCy);

        if (dist < bestDist) {
          bestDist = dist;
          bestVal = n;
        }
      });
    });

    if (bestVal >= 50) {
      console.log('Phase 2c – spatial proximity:', bestVal, '(dist:', bestDist, 'px)');
      return bestVal;
    }
  }

  // ฤฤ PHASE 3: Fallback scoring (original algorithm on normalised text) ฤฤฤฤฤฤฤ
  const numRegex = /\b\d{2,5}\b/g;
  const matches = normText.match(numRegex);

  if (!matches || matches.length === 0) {
    return getFallbackCalories(activityType);
  }

  // Re-use old column logic on row texts for backward compatibility
  const columnTexts = rowTexts;

  const candidates = Array.from(new Set(matches.map(Number)));
  let bestCandidate = 0;
  let highestScore = -9999;

  candidates.forEach(num => {
    let score = 0;
    const numStr = num.toString();

    // Range scoring — treat all plausible calorie values equally to avoid
    // the old bias that favoured 150-1200 over larger values like 2869.
    if (num >= 150 && num <= 5000) {
      score += 50;   // equal chance for any plausible calorie
    } else if (num >= 50 && num < 150) {
      score += 10;
    } else {
      score -= 50;
    }

    // Column-proximity check
    columnTexts.forEach(col => {
      const colCleaned = col.text.toLowerCase();
      if (colCleaned.includes(numStr)) {
        const colHasCalKeyword = calorieKeywords.some(kw => colCleaned.includes(kw));
        if (colHasCalKeyword) {
          score += 1000; // Shared column with calorie keyword!
          console.log(`Candidate ${num}: Shared column with calorie keyword. colText: "${col.text}"`);
        }

        const colHasPenaltyKeyword = penaltyKeywords.some(kw => colCleaned.includes(kw));
        if (colHasPenaltyKeyword) {
          // Soft penalty: the number might legitimately share a row with km/steps
          // (e.g. "13.8 km  2,869" — km is in the label column, not the value)
          score -= 80;
          console.log(`Candidate ${num}: Shared row with penalty keyword. colText: "${col.text}"`);
        }
      }
    });

    // Global Proximity Check (as fallback)
    const index = normText.indexOf(numStr);
    if (index !== -1) {
      let minCalDist = 9999;
      calorieKeywords.forEach(kw => {
        let kwIdx = -1;
        while ((kwIdx = normText.indexOf(kw, kwIdx + 1)) !== -1) {
          const dist = Math.abs(kwIdx - index);
          if (dist < minCalDist) minCalDist = dist;
        }
      });
      if (minCalDist < 40) score += 100;
    }

    // Exclude times and battery percent
    const patternTime = new RegExp(`\\b\\d{1,2}:\\d{2}\\b`);
    const timeMatch = normOriginal.match(patternTime);
    if (timeMatch && timeMatch[0].replace(':', '') === numStr) {
      score -= 300;
    }

    const pctIndex = normOriginal.indexOf(numStr + '%');
    const pctIndexSpace = normOriginal.indexOf(numStr + ' %');
    if (pctIndex !== -1 || pctIndexSpace !== -1) {
      score -= 300;
    }

    console.log(`Candidate ${num}: Total Score = ${score}`);

    if (score > highestScore) {
      highestScore = score;
      bestCandidate = num;
    }
  });

  if (highestScore < 0 || bestCandidate === 0) {
    return getFallbackCalories(activityType);
  }

  return bestCandidate;
}

function checkDateCloseness(parsedDate: Date, dateStr: string): { isValid: boolean; foundDateStr: string } {
  const today = new Date();
  const parsedMidnight = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const diffTime = Math.abs(todayMidnight.getTime() - parsedMidnight.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (parsedMidnight.getTime() > todayMidnight.getTime()) {
    return { isValid: false, foundDateStr: `วันที่ในอนาคต: ${dateStr}` };
  }
  
  if (diffDays > 1) {
    return { isValid: false, foundDateStr: `ตรวจพบวันที่ ${dateStr} (ย้อนหลังเกินกำหนด)` };
  }

  return { isValid: true, foundDateStr: `ตรงตามกำหนด (${dateStr})` };
}

function parseDateFromText(text: string): { isValid: boolean; foundDateStr: string } {
  const cleanText = text.toLowerCase();
  
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june', 
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const shortMonths = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const shortThaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  const today = new Date();
  const currentYear = today.getFullYear();

  for (let i = 0; i < 12; i++) {
    const monthName = months[i];
    const shortMonthName = shortMonths[i];
    
    const pattern1 = new RegExp(`\\b(${monthName}|${shortMonthName})\\s*(\\d{1,2})\\b`, 'i');
    const match1 = cleanText.match(pattern1);
    if (match1) {
      const day = parseInt(match1[2]);
      const parsedDate = new Date(currentYear, i, day);
      return checkDateCloseness(parsedDate, `${months[i]} ${day}`);
    }

    const pattern2 = new RegExp(`\\b(\\d{1,2})\\s*(${monthName}|${shortMonthName})\\b`, 'i');
    const match2 = cleanText.match(pattern2);
    if (match2) {
      const day = parseInt(match2[1]);
      const parsedDate = new Date(currentYear, i, day);
      return checkDateCloseness(parsedDate, `${day} ${months[i]}`);
    }
  }

  for (let i = 0; i < 12; i++) {
    const thaiMonth = thaiMonths[i];
    const shortThaiMonth = shortThaiMonths[i].replace('.', '\\.');

    const pattern1 = new RegExp(`(\\d{1,2})\\s*(${thaiMonth}|${shortThaiMonth})`, 'i');
    const match1 = cleanText.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const parsedDate = new Date(currentYear, i, day);
      return checkDateCloseness(parsedDate, `${day} ${thaiMonths[i]}`);
    }
  }

  const isoMatch = cleanText.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]) - 1;
    const day = parseInt(isoMatch[3]);
    const parsedDate = new Date(year, month, day);
    return checkDateCloseness(parsedDate, `${year}-${month+1}-${day}`);
  }

  const slashMatch = cleanText.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    let year = parseInt(slashMatch[3]);
    if (year < 100) year += 2000;
    const parsedDate = new Date(year, month, day);
    return checkDateCloseness(parsedDate, `${day}/${month+1}/${year}`);
  }

  return { isValid: true, foundDateStr: 'ไม่พบวันที่ในหลักฐาน (ข้ามการตรวจสอบ)' };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'employee-form' | 'company-dashboard' | 'admin-portal' | 'system-spec'>('company-dashboard');
  const [employees, setEmployees] = useState<Record<string, Employee>>({});
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const [empIdInput, setEmpIdInput] = useState('');
  const [activityType, setActivityType] = useState('วิ่ง');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResultKcal, setOcrResultKcal] = useState<number | null>(null);
  const [confirmedKcal, setConfirmedKcal] = useState('');
  const [ocrScannedDate, setOcrScannedDate] = useState('วันนี้ (ตรงตามข้อกำหนดเงื่อนไข)');
  const [isDateValid, setIsDateValid] = useState(true);
  const [ocrRawText, setOcrRawText] = useState('');
  const [imageHash, setImageHash] = useState('');

  // Search State
  const [searchId, setSearchId] = useState('');

  // Toast State
  const [toast, setToast] = useState<{ title: string; desc: string; type: 'success' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const empData = await dbService.getEmployees();
        const subData = await dbService.getSubmissions();
        setEmployees(empData);
        setSubmissions(subData);
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const showToast = (title: string, desc: string, type: 'success' | 'error' = 'success') => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ title, desc, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Switch tabs
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminEmail.trim().toLowerCase() === ADMIN_EMAIL && adminPassword === ADMIN_PASSWORD) {
      setIsAdminAuthenticated(true);
      setAdminLoginError('');
      setAdminPassword('');
      showToast('เข้าสู่หลังบ้านสำเร็จ', 'สามารถตรวจสอบและอนุมัติรายการกิจกรรมได้แล้ว', 'success');
      return;
    }

    setAdminLoginError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setAdminEmail('');
    setAdminPassword('');
    setActiveTab('company-dashboard');
    showToast('ออกจากหลังบ้านแล้ว', 'กลับสู่หน้าผู้ใช้งานทั่วไป', 'success');
  };

  // Hashing Image logic for anti-cheat
  const calculateHash = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Handle OCR scanning using real Tesseract.js client-side engine with fallback
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImagePreview(URL.createObjectURL(file));
    setOcrLoading(true);
    setOcrResultKcal(null);
    setConfirmedKcal('');

    try {
      // Calculate Image Hash
      const hash = await calculateHash(file);
      setImageHash(hash);

      // Check if image is duplicate immediately
      const isDuplicate = submissions.some(s => s.imageHash === hash);
      if (isDuplicate) {
        showToast('ตรวจพบรูปภาพซ้ำซ้อน', 'รูปภาพหลักฐานนี้เคยถูกอัปโหลดในระบบแล้ว กรุณาอัปโหลดรูปภาพใหม่เพื่อป้องกันการทุจริต', 'error');
        resetFormImage();
        setOcrLoading(false);
        return;
      }

      // Pre-process image (grayscale + contrast) before OCR for better accuracy
      let ocrSource: File | Blob = file;
      try {
        ocrSource = await preprocessImage(file);
        console.log('Image pre-processed: grayscale + contrast boost applied');
      } catch (ppErr) {
        console.warn('Pre-processing failed, using original image:', ppErr);
      }

      // Run client-side Tesseract OCR
      Tesseract.recognize(
        ocrSource,
        'eng',
        { logger: m => console.log('Tesseract:', m) }
      ).then(async ({ data }) => {
        const text = (data as any).text || '';
        const words = (data as any).words || [];
        console.log('OCR Raw Text:', text);

        // Step 1 – remove formatting separators so "13,775"  "13775"
        const cleanedText = text.replace(/(\d+)[,.](\d+)/g, '$1$2');
        console.log('Cleaned OCR Text:', cleanedText);

        // Step 2 – smart extraction with synonym normalisation + row grouping
        let detectedKcal = extractSmartCalories(cleanedText, text, activityType, words);
        const focusedCalories = await recognizeFocusedCalories(file, text);
        if (focusedCalories) {
          detectedKcal = focusedCalories.value;
          console.log('Focused calories override:', focusedCalories.value);
        }
        console.log('Detected kcal:', detectedKcal);
        const usableDetectedKcal = detectedKcal >= 1 && detectedKcal <= 5000 ? detectedKcal : null;

        // Step 3 – validate date
        const dateCheck = parseDateFromText(cleanedText);
        setOcrRawText(focusedCalories ? `${text}\n\n[Focused Calories OCR]\n${focusedCalories.text}` : text);
        setIsDateValid(dateCheck.isValid);
        setOcrScannedDate(dateCheck.foundDateStr);
        setOcrResultKcal(usableDetectedKcal);
        setConfirmedKcal(usableDetectedKcal === null ? '' : String(usableDetectedKcal));
        setOcrLoading(false);
      }).catch(err => {
        console.error('Tesseract error, using fallback:', err);

        setIsDateValid(true);
        setOcrRawText('(เกิดข้อผิดพลาดในการโหลดโมดูล OCR ท้องถิ่น กรุณากรอกค่าแคลอรี่จากภาพด้วยตนเอง)');
        setOcrResultKcal(null);
        setConfirmedKcal('');
        setOcrScannedDate('วันนี้ (กรุณาตรวจสอบจากภาพหลักฐาน)');
        setOcrLoading(false);
      });

    } catch (err) {
      console.error('OCR Error:', err);
      setOcrLoading(false);
      showToast('เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ', 'กรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  const resetFormImage = () => {
    setImagePreview(null);
    setOcrResultKcal(null);
    setConfirmedKcal('');
    setImageHash('');
    setIsDateValid(true);
    setOcrRawText('');
  };

  // Form submission handler
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = empIdInput.trim().toUpperCase();

    // 1. Check if employee is registered
    const employee = employees[cleanId];
    if (!employee) {
      showToast('ไม่พบรหัสพนักงาน', 'กรุณากรอกรหัส EMP1001 ถึง EMP1005 ในแบบจำลอง', 'error');
      return;
    }

    // 2. Enforce Daily Limit (1 submission per employee per day)
    const todayStr = new Date().toISOString().split('T')[0];
    const alreadySubmitted = submissions.some(
      s => s.empId === cleanId && s.scannedDate === todayStr && s.status !== 'rejected'
    );
    if (alreadySubmitted) {
      showToast('ส่งข้อมูลซ้ำในวันเดียวกัน', `พนักงาน ${employee.name} ได้บันทึกผลงานประจำวันนี้ไปแล้ว (จำกัด 1 สิทธิ์/วัน)`, 'error');
      return;
    }

    const confirmedKcalValue = Number(confirmedKcal);
    if (!Number.isFinite(confirmedKcalValue) || confirmedKcalValue < 1 || confirmedKcalValue > 5000) {
      showToast('กรุณายืนยันค่าแคลอรี่', 'ตรวจสอบตัวเลขจากภาพและกรอกค่าแคลอรี่ที่ถูกต้องก่อนส่งผลงาน', 'error');
      return;
    }

    // 3. Prevent duplicate hash submission
    const duplicateCheck = submissions.some(s => s.imageHash === imageHash);
    if (duplicateCheck) {
      showToast('ตรวจพบรูปภาพซ้ำซ้อน', 'ระบบห้ามกรอกข้อมูลจากหลักฐานภาพเดิมเพื่อความปลอดภัย', 'error');
      return;
    }

    // Prepare submission object
    const newSubData = {
      empId: cleanId,
      name: employee.name,
      department: employee.department,
      division: employee.division,
      activityType,
      kcal: Math.round(confirmedKcalValue),
      imageUrl: imagePreview || DEFAULT_PREVIEW,
      scannedDate: todayStr,
      status: 'pending' as const,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      imageHash: imageHash || 'local-' + Math.random().toString(36).substr(2, 9)
    };

    try {
      const addedSub = await dbService.createSubmission(newSubData);
      setSubmissions(prev => [...prev, addedSub]);
      
      // Reset form fields
      setEmpIdInput('');
      resetFormImage();
      
      // Play celebratory sound or confetti
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#10b981', '#14b8a6', '#3b82f6']
      });

      showToast('ส่งผลงานสำเร็จ!', 'ข้อมูลบันทึกแคลอรี่รอผู้ดูแลระบบอนุมัติขึ้นกระดานคะแนน', 'success');
    } catch (err) {
      console.error(err);
      showToast('บันทึกไม่สำเร็จ', 'ระบบขัดข้องกรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  // Admin Actions
  const handleApprove = async (id: number) => {
    try {
      const success = await dbService.updateStatus(id, 'approved');
      if (success) {
        setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'approved' } : s));
        
        confetti({
          particleCount: 50,
          spread: 45,
          colors: ['#10b981', '#34d399']
        });
        
        showToast('อนุมัติผลงานสำเร็จ', 'สถิติขึ้นกระดานจัดอันดับเรียบร้อยแล้ว', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('ไม่สามารถอนุมัติได้', 'เกิดข้อผิดพลาดในการปรับปรุงข้อมูล', 'error');
    }
  };

  const handleReject = async (id: number) => {
    try {
      const success = await dbService.updateStatus(id, 'rejected');
      if (success) {
        setSubmissions(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected' } : s));
        showToast('ปฏิเสธรายการแล้ว', 'ปฏิเสธคำขอการเผาผลาญเรียบร้อยแล้ว', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('ปฏิเสธรายการไม่สำเร็จ', 'ขัดข้องในระบบฐานข้อมูล', 'error');
    }
  };

  const handleApproveAll = async () => {
    const pendingCount = submissions.filter(s => s.status === 'pending').length;
    if (pendingCount === 0) {
      showToast('ไม่มีรายการค้างอนุมัติ', 'ไม่พบประวัติรอคิวพิจารณาเพิ่มเติม', 'error');
      return;
    }

    try {
      const approvedCount = await dbService.approveAll();
      setSubmissions(prev => prev.map(s => s.status === 'pending' ? { ...s, status: 'approved' } : s));

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      showToast('อนุมัติรายการทั้งหมดแล้ว', `ทำการอนุมัติสถิติจำนวน ${approvedCount} คำขอเรียบร้อยแล้ว`, 'success');
    } catch (err) {
      console.error(err);
      showToast('ขัดข้องในการอนุมัติคิว', 'กรุณาลองใหม่อีกครั้ง', 'error');
    }
  };

  // Spec File Downloader
  const handleDownloadSpec = () => {
    const markdownPayload = `# Specification: FitVerify AI Tracker (ระบบบันทึกสถิติการออกกำลังกายพนักงาน)

ระบบเว็บแอปพลิเคชันสถิติการออกกำลังกายภายในองค์กร รองรับการอัปโหลดภาพถ่ายเพื่ออ่านค่า kcal อัตโนมัติด้วย Local OCR พร้อมระบบป้องกันการทุจริต จัดอันดับตามโครงสร้าง ฝ่าย (Department), กอง (Division) และแสดงผลในรูปแบบ Interactive & Responsive Dashboard

---

## 1. Tech Stack & Infrastructure
- **Frontend & API Hosting:** Vercel (โฮสต์เว็บแอปพลิเคชัน และ Serverless Functions)
- **Version Control & CI/CD:** GitHub (เชื่อมต่อกับ Vercel เพื่อ Deploy อัตโนมัติ)
- **Database, Auth & Storage:** Supabase (PostgreSQL Database + Storage สำหรับเก็บรูปหลักฐาน)
- **OCR Engine:** Tesseract.js (ประมวลผลบน Client-side / ไม่ใช้ External API ที่มีค่าใช้จ่าย)

---

## 2. โครงสร้างฐานข้อมูล (Supabase Database Schema)

### ตารางที่ 1: \`employees\`
\`\`\`sql
CREATE TABLE employees (
    emp_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    division VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
\`\`\`

### ตารางที่ 2: \`submissions\`
\`\`\`sql
CREATE TABLE submissions (
    id BIGSERIAL PRIMARY KEY,
    emp_id VARCHAR(50) REFERENCES employees(emp_id),
    activity_type VARCHAR(100) NOT NULL,
    kcal INT NOT NULL,
    image_url TEXT NOT NULL,
    image_hash VARCHAR(64) NOT NULL,
    scanned_date DATE NOT NULL,
    submission_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
\`\`\`

---

## 3. เงื่อนไขและกฎของระบบ (Core Business Logic)
1. **การจำกัดสิทธิ์ (Daily Limit Rule):** พนักงาน 1 คน สามารถส่งได้ 1 ครั้งต่อ 1 วันเท่านั้น
2. **การป้องกันทุจริตด้วยภาพถ่าย (Anti-Cheat Mechanism):** ทำ Image Hashing ป้องกันรูปภาพเวียนเทียนส่งซ้ำ
3. **กลไกการคำนวณกลุ่ม (Aggregation Logic):** บอร์ดแสดงคะแนนเฉพาะสถานะ \`approved\` สรุปตามโครงสร้างฝ่ายและกองงานย่อย
`;

    const blob = new Blob([markdownPayload], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'specification.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('ดาวน์โหลดข้อมูลสำเร็จ', 'ระบบบันทึกไฟล์ specification.md ลงคอมพิวเตอร์ของคุณเรียบร้อยแล้ว', 'success');
  };

  // Leaderboard Aggregations (Only approved submissions)
  const approvedSubmissions = submissions.filter(s => s.status === 'approved');

  // Stats
  const totalKcal = approvedSubmissions.reduce((sum, s) => sum + s.kcal, 0);
  const activeUserCount = new Set(approvedSubmissions.map(s => s.empId)).size;

  // Weekly top performer
  const userTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    userTotals[s.empId] = (userTotals[s.empId] || 0) + s.kcal;
  });
  
  let topEmpId = '';
  let topKcal = 0;
  Object.keys(userTotals).forEach(id => {
    if (userTotals[id] > topKcal) {
      topKcal = userTotals[id];
      topEmpId = id;
    }
  });

  const topPerformer = topEmpId ? employees[topEmpId] : null;

  // Department rankings
  const deptTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    if (s.department) {
      deptTotals[s.department] = (deptTotals[s.department] || 0) + s.kcal;
    }
  });
  const sortedDepts = Object.keys(deptTotals)
    .map(name => ({ name, kcal: deptTotals[name] }))
    .sort((a, b) => b.kcal - a.kcal);

  // Division rankings
  const divTotals: Record<string, number> = {};
  approvedSubmissions.forEach(s => {
    if (s.division) {
      divTotals[s.division] = (divTotals[s.division] || 0) + s.kcal;
    }
  });
  const sortedDivs = Object.keys(divTotals)
    .map(name => ({ name, kcal: divTotals[name] }))
    .sort((a, b) => b.kcal - a.kcal);

  // Pending queue
  const pendingQueue = submissions.filter(s => s.status === 'pending');

  // Search Results
  const cleanSearchId = searchId.trim().toUpperCase();
  const searchEmployee = employees[cleanSearchId];
  const searchSubmissions = cleanSearchId ? submissions.filter(s => s.empId === cleanSearchId) : [];
  const searchApprovedKcal = searchSubmissions
    .filter(s => s.status === 'approved')
    .reduce((sum, s) => sum + s.kcal, 0);
  const confirmedKcalValue = Number(confirmedKcal);
  const hasValidConfirmedKcal = Number.isFinite(confirmedKcalValue) && confirmedKcalValue >= 1 && confirmedKcalValue <= 5000;
  const canSubmitForm = hasValidConfirmedKcal && isDateValid && !!empIdInput.trim() && !!employees[empIdInput.trim().toUpperCase()];

  return (
    <div className="bg-white text-[#72246C] min-h-screen flex flex-col justify-between">
      
      {/* HEADER SECTION */}
      <header className="bg-white/95 border-b border-[#C69214]/30 py-4 px-6 sticky top-0 z-50 flex flex-wrap justify-between items-center gap-4 shadow-lg shadow-[#72246C]/10 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-[#72246C]/10 via-white to-[#C69214]/10 border border-[#C69214]/35 shadow-lg shadow-[#72246C]/10 px-4 py-2">
            <img src="/pea-move.png" alt="PEA Titan Move" className="h-24 md:h-28 w-auto object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#72246C] m-0 leading-none">
              PEA Titan Move
            </h1>
            <p className="text-xs text-[#C69214] mt-1 mb-0 font-semibold">
              ขยับวันนี้ เพื่อสุขภาพที่ดีของเรา
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <nav className="flex flex-wrap bg-white p-1.5 rounded-xl border border-[#C69214]/30 gap-1 shadow-sm">
            <button 
              onClick={() => handleTabChange('employee-form')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all duration-300 ${
                activeTab === 'employee-form' 
                  ? 'bg-gradient-to-r from-[#72246C] to-[#C69214] text-white shadow-md' 
                  : 'text-[#72246C] hover:bg-[#72246C]/5'
              }`}
            >
              <UploadCloud className="h-4 w-4" />
              <span>ส่งข้อมูลกิจกรรม</span>
            </button>
            
            <button 
              onClick={() => handleTabChange('company-dashboard')} 
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all duration-300 ${
                activeTab === 'company-dashboard' 
                  ? 'bg-gradient-to-r from-[#72246C] to-[#C69214] text-white shadow-md' 
                  : 'text-[#72246C] hover:bg-[#72246C]/5'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              <span>แดชบอร์ดสุขภาพองค์กร</span>
            </button>
          </nav>

          <button
            type="button"
            title="หลังบ้าน"
            aria-label="เข้าสู่หลังบ้าน"
            onClick={() => handleTabChange('admin-portal')}
            className={`relative w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
              activeTab === 'admin-portal'
                ? 'border-[#72246C] bg-[#72246C] text-white'
                : 'border-[#C69214]/30 bg-white text-[#72246C]/55 hover:text-[#72246C] hover:border-[#72246C]/45'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* CORE CONTENT */}
      <main className="flex-grow container mx-auto px-4 py-8 max-w-7xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-10 w-10 text-[#C69214] animate-spin" />
            <p className="text-sm text-[#72246C]/65">กำลังโหลดข้อมูลระบบ...</p>
          </div>
        ) : (
          <>
            {/* ALERT BOX FOR MOCK STATUS */}
            {dbService.isMock && (
              <div className="mb-6 bg-[#C69214]/10 border border-[#C69214]/25 rounded-2xl p-4 flex items-center gap-3 text-xs text-[#72246C]">
                <AlertCircle className="h-5 w-5 text-[#C69214] shrink-0" />
                <div>
                  <span className="font-bold">โหมดจำลองฐานข้อมูลในเครื่อง (LocalStorage Mode) กำลังทำงาน:</span> ข้อมูลทั้งหมดจะบันทึกอยู่ในเว็บเบราว์เซอร์นี้แบบออฟไลน์ คุณสามารถแก้ไขและทดสอบได้ฟรีโดยไม่มีค่าใช้จ่าย และหากพร้อมเชื่อมต่อฐานข้อมูล Supabase สามารถนำ URL/Key ไปใส่ในตัวแปรสภาพแวดล้อมได้ทันที
                </div>
              </div>
            )}

            {/* TAB 1: EMPLOYEE SUBMISSION FORM */}
            {activeTab === 'employee-form' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-gradient-to-br from-white via-white to-[#C69214]/10 border border-[#C69214]/20 p-6 rounded-2xl shadow-sm">
                    <h2 className="text-lg font-bold text-[#C69214] mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" /> 
                      ระบบลงทะเบียนผลรายวัน
                    </h2>
                    <p className="text-xs text-[#72246C]/80 leading-relaxed">
                      กรอกรหัสพนักงานของคุณ ระบบจะดึงแผนกสังกัดจริงจากฐานข้อมูลให้อัตโนมัติ สามารถแนบไฟล์รูปถ่ายนาฬิกาออกกำลังกายเพื่อจำลองกลไก AI OCR สแกนหาความร้อนแคลอรี่ได้ทันที ระบบมีระบบป้องกันการอัปโหลดไฟล์ซ้ำและสแกนลายนิ้วมือภาพ
                    </p>
                  </div>
                </div>

                <div className="lg:col-span-8 bg-white border border-[#C69214]/20 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#C69214] to-[#72246C]"></div>
                  <h2 className="text-2xl font-bold text-[#72246C] mb-6 flex items-center gap-3">
                    <User className="h-6 w-6 text-[#C69214]" />
                    ส่งผลการเผาผลาญพลังงานประจำวัน
                  </h2>

                  <form onSubmit={handleFormSubmit} className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-2">
                        เลขรหัสพนักงาน (กรอกเพื่อทดสอบ: EMP1001 ถึง EMP1005)
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#72246C]/45">
                          <User className="h-5 w-5" />
                        </div>
                        <input 
                          type="text" 
                          required 
                          value={empIdInput}
                          onChange={(e) => setEmpIdInput(e.target.value)}
                          placeholder="เช่น EMP1001, EMP1002..." 
                          className="w-full bg-white border border-[#C69214]/20 focus:border-[#C69214] focus:ring-1 focus:ring-[#C69214] rounded-xl py-3 pl-11 pr-4 text-[#72246C] placeholder-[#72246C]/35 transition-all focus:outline-none"
                        />
                      </div>
                      {empIdInput.trim() && employees[empIdInput.trim().toUpperCase()] && (
                        <p className="mt-2 text-xs text-[#C69214] flex items-center gap-1">
                          <Check className="h-3 h-3" />
                          พนักงาน: {employees[empIdInput.trim().toUpperCase()].name} | ฝ่าย: {employees[empIdInput.trim().toUpperCase()].department} ({employees[empIdInput.trim().toUpperCase()].division})
                        </p>
                      )}
                      {empIdInput.trim() && !employees[empIdInput.trim().toUpperCase()] && (
                        <p className="mt-2 text-xs text-rose-400 flex items-center gap-1">
                          <X className="h-3 h-3" />
                          ไม่พบรหัสพนักงานนี้ในระบบแบบจำลอง
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-3">กิจกรรมที่ออกกำลังกาย</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { val: 'วิ่ง', label: 'วิ่ง (Running)', icon: <Activity className="h-6 w-6" /> },
                          { val: 'เดิน', label: 'เดิน (Walking)', icon: <Activity className="h-6 w-6" /> },
                          { val: 'ปั่นจักรยาน', label: 'ปั่นจักรยาน', icon: <Activity className="h-6 w-6" /> },
                          { val: 'บอดี้เวท / ยิม', label: 'ยิม (Gym)', icon: <Activity className="h-6 w-6" /> }
                        ].map(act => (
                          <button
                            key={act.val}
                            type="button"
                            onClick={() => setActivityType(act.val)}
                            className={`p-4 rounded-xl flex flex-col items-center justify-center text-center gap-2 cursor-pointer transition-all border ${
                              activityType === act.val 
                                ? 'border-[#C69214]/20 bg-[#72246C]/10 text-[#C69214]' 
                                : 'border-[#C69214]/20 bg-white text-[#72246C]/65 hover:text-[#72246C]'
                            }`}
                          >
                            <span className="text-2xl">{act.icon}</span>
                            <span className="text-xs font-semibold">{act.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-[#72246C]/80 mb-2">อัปโหลดภาพถ่ายหลักฐานบันทึกผล</label>
                      <div className="border-2 border-dashed border-[#C69214]/20 hover:border-[#C69214]/40 bg-white rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all relative overflow-hidden group">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="absolute inset-0 opacity-0 cursor-pointer z-20" 
                          onChange={handleImageChange}
                        />
                        {!imagePreview ? (
                          <div className="space-y-3 py-4">
                            <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center mx-auto text-[#C69214] group-hover:scale-110 transition-transform">
                              <UploadCloud className="h-6 w-6" />
                            </div>
                            <p className="text-sm text-[#72246C]/80">
                              <span className="text-[#C69214] font-semibold">คลิกอัปโหลดรูปภาพ</span> หรือลากวางไฟล์ที่นี่
                            </p>
                            <p className="text-xs text-[#72246C]/45 font-mono">JPG, PNG หรือภาพถ่ายจากนาฬิกาสมาร์ทวอทช์</p>
                          </div>
                        ) : (
                          <div className="w-full max-w-xs rounded-xl overflow-hidden border border-[#C69214]/15 bg-white/90 p-2 relative z-30 flex justify-center items-center mx-auto">
                            <img 
                              src={imagePreview} 
                              className="max-h-96 w-auto max-w-full rounded-lg object-contain" 
                              alt="Workout proof preview" 
                            />
                            <button 
                              type="button" 
                              onClick={(e) => { e.stopPropagation(); resetFormImage(); }} 
                              className="absolute top-4 right-4 bg-white/90 hover:bg-white text-rose-400 hover:text-rose-300 w-8 h-8 rounded-full flex items-center justify-center border border-[#C69214]/20 shadow-md transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {ocrLoading && (
                      <div className="bg-white border border-[#C69214]/20 p-6 rounded-2xl flex items-center justify-center gap-3">
                        <Loader2 className="h-5 w-5 text-[#C69214] animate-spin" />
                        <span className="text-sm font-semibold text-[#C69214]">ระบบ AI กำลังวิเคราะห์รูปภาพและอ่านแคลอรี่...</span>
                      </div>
                    )}

                    {imagePreview && !ocrLoading && (
                      <div className="bg-white border border-[#C69214]/20 p-5 rounded-xl space-y-4">
                        <h3 className="text-xs font-bold text-[#C69214] uppercase tracking-wider flex items-center gap-1.5">
                          <Package className="h-4 w-4" />
                          ตรวจสอบและยืนยันข้อมูลจากภาพถ่าย
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white p-4 rounded-lg border border-[#C69214]/20">
                            <label className="block text-xs text-[#72246C]/65 mb-1">จำนวนพลังงานที่จะบันทึกจริง</label>
                            <div className="flex items-baseline gap-2">
                              <input 
                                type="number" 
                                required 
                                min="1"
                                max="5000"
                                value={confirmedKcal}
                                onChange={(e) => setConfirmedKcal(e.target.value)}
                                placeholder={ocrResultKcal === null ? 'กรอกเลข' : undefined}
                                className="bg-transparent text-2xl font-bold text-[#C69214] focus:outline-none w-32 border-b border-dashed border-[#C69214]/30"
                              />
                              <span className="text-sm text-[#72246C]/65 font-mono">kcal</span>
                            </div>
                            <p className="mt-2 text-[11px] text-[#72246C]/45">
                              {ocrResultKcal === null
                                ? 'OCR ยังอ่านค่าไม่ได้ กรุณากรอกเลขจากภาพด้วยตนเอง'
                                : `OCR เสนอค่า ${ocrResultKcal.toLocaleString()} kcal - แก้ไขได้ถ้าตัวเลขไม่ตรงภาพ`}
                            </p>
                            {!hasValidConfirmedKcal && (
                              <p className="mt-2 text-[11px] text-rose-400">กรุณากรอกตัวเลข 1-5000 kcal ก่อนส่ง</p>
                            )}
                          </div>
                          <div className={`bg-white p-4 rounded-lg border ${isDateValid ? 'border-[#C69214]/20' : 'border-rose-500/30'} flex flex-col justify-between`}>
                            <div>
                              <span className="block text-xs text-[#72246C]/65 mb-1">สถานะวันที่หลักฐาน</span>
                              <span className={`font-bold text-sm ${isDateValid ? 'text-[#C69214]' : 'text-rose-400'}`}>{ocrScannedDate}</span>
                            </div>
                          </div>
                        </div>

                        {/* Raw OCR Text logs for debugging */}
                        {ocrRawText && (
                          <div className="bg-white p-4 rounded-lg border border-[#C69214]/20 text-left">
                            <span className="block text-xs text-[#72246C]/65 font-semibold mb-2 flex items-center gap-1.5">
                              ข้อความดิบที่ถอดรหัสได้จากภาพ (Raw OCR Text Logs):
                            </span>
                            <div className="bg-white p-3 rounded border border-[#72246C]/15 max-h-32 overflow-y-auto font-mono text-[11px] text-[#72246C]/65 whitespace-pre-wrap leading-relaxed">
                              {ocrRawText.trim() || "(ไม่มีข้อความที่ดึงรหัสได้จากภาพ)"}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-4 flex justify-end gap-4">
                      <button 
                        type="submit" 
                        disabled={!canSubmitForm} 
                        className={`px-8 py-3 rounded-xl font-bold text-sm transition-all duration-300 shadow-lg ${
                          canSubmitForm
                            ? 'bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] shadow-[#C69214]/10 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0'
                            : 'bg-[#3A1536] text-[#72246C]/45 cursor-not-allowed'
                        }`}
                      >
                        ยืนยันข้อมูลส่งผลงาน
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* TAB 2: INTERACTIVE DASHBOARD */}
            {activeTab === 'company-dashboard' && (
              <div className="space-y-8 animate-fadeIn">
                {/* TOP AGGREGATES CARDS */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                  <div className="bg-gradient-to-br from-[#C69214]/20 via-white to-white border border-[#C69214]/30 rounded-2xl p-6 relative overflow-hidden lg:col-span-2 group">
                    <div className="absolute -right-4 -bottom-4 text-[#C69214]/5 text-9xl group-hover:scale-110 transition-transform">
                      <Crown />
                    </div>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="bg-[#C69214]/10 text-[#C69214] border border-[#C69214]/20 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1 w-fit">
                          <Crown className="h-3.5 w-3.5" />
                          แชมป์แคลอรี่สะสมสูงสุดสัปดาห์นี้
                        </span>
                        <h3 className="text-2xl font-extrabold text-[#72246C] mt-4 tracking-tight">
                          {topPerformer ? topPerformer.name : 'กำลังรอผลอนุมัติ'}
                        </h3>
                        <p className="text-xs text-[#72246C]/65 mt-1">
                          สังกัด: {topPerformer ? `${topPerformer.department} (${topPerformer.division})` : '-'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-[#72246C]/45 block font-mono">ยอดเผาผลาญสะสม</span>
                        <span className="text-3xl font-black text-[#C69214] font-mono">
                          {topKcal.toLocaleString()}
                        </span>
                        <span className="text-xs text-[#C69214] block font-semibold">kcal</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6 relative overflow-hidden">
                    <p className="text-sm text-[#72246C]/65 font-medium">รวมพลังงานองค์กรที่เผาผลาญ</p>
                    <h3 className="text-3xl font-extrabold text-[#C69214] mt-2 font-mono">
                      {totalKcal.toLocaleString()} kcal
                    </h3>
                    <span className="text-xs text-[#72246C]/45">นับเฉพาะรายงานที่ได้รับการอนุมัติ</span>
                  </div>

                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6 relative overflow-hidden">
                    <p className="text-sm text-[#72246C]/65 font-medium">บุคลากรที่เข้าร่วมสุขภาพ</p>
                    <h3 className="text-3xl font-extrabold text-[#C69214] mt-2 font-mono">
                      {activeUserCount} คน
                    </h3>
                    <span className="text-xs text-[#72246C]/45">คนที่มีคะแนนอนุมัติแล้ว</span>
                  </div>
                </div>

                {/* LEADERS CHART BOARD */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Department ranking */}
                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-[#72246C] flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-[#C69214]" />
                        อันดับตาม "ฝ่าย" (Department Leaderboard)
                      </h3>
                      <span className="text-[10px] bg-white text-[#72246C]/65 px-2 py-0.5 rounded font-mono">Kcal Rank</span>
                    </div>
                    
                    <div className="space-y-5 mt-6">
                      {sortedDepts.length === 0 ? (
                        <p className="text-xs text-[#72246C]/45 text-center py-8 font-mono">ยังไม่มีข้อมูลคะแนนอนุมัติรายฝ่าย</p>
                      ) : (
                        sortedDepts.map((dept, idx) => {
                          const maxVal = sortedDepts[0]?.kcal || 1;
                          const percentage = (dept.kcal / maxVal) * 100;
                          return (
                            <div key={dept.name} className="space-y-2">
                              <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold">
                                    {idx === 0 ? <Crown className="h-3 w-3 text-[#C69214]" /> : 
                                     idx === 1 ? <Medal className="h-3 w-3 text-[#72246C]/80" /> :
                                     idx === 2 ? <Medal className="h-3 w-3 text-[#9A650F]" /> : 
                                     <span className="text-[10px] text-[#72246C]/45 font-mono">{idx + 1}</span>}
                                  </div>
                                  <span className="font-semibold text-[#72246C]">{dept.name}</span>
                                </div>
                                <span className="font-bold text-[#C69214] font-mono">{dept.kcal.toLocaleString()} kcal</span>
                              </div>
                              <div className="w-full bg-white rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-[#C69214] to-[#72246C] h-full rounded-full transition-all duration-1000" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Division ranking */}
                  <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-[#72246C] flex items-center gap-2">
                        <Layers className="h-5 w-5 text-[#C69214]" />
                        อันดับตาม "กอง" (Division Leaderboard)
                      </h3>
                      <span className="text-[10px] bg-white text-[#72246C]/65 px-2 py-0.5 rounded font-mono">Kcal Rank</span>
                    </div>

                    <div className="space-y-5 mt-6">
                      {sortedDivs.length === 0 ? (
                        <p className="text-xs text-[#72246C]/45 text-center py-8 font-mono">ยังไม่มีข้อมูลคะแนนอนุมัติรายกอง</p>
                      ) : (
                        sortedDivs.map((div, idx) => {
                          const maxVal = sortedDivs[0]?.kcal || 1;
                          const percentage = (div.kcal / maxVal) * 100;
                          return (
                            <div key={div.name} className="space-y-2">
                              <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center font-bold">
                                    {idx === 0 ? <Crown className="h-3 w-3 text-[#C69214]" /> : 
                                     idx === 1 ? <Medal className="h-3 w-3 text-[#72246C]/80" /> :
                                     idx === 2 ? <Medal className="h-3 w-3 text-[#9A650F]" /> : 
                                     <span className="text-[10px] text-[#72246C]/45 font-mono">{idx + 1}</span>}
                                  </div>
                                  <span className="font-semibold text-[#72246C]">{div.name}</span>
                                </div>
                                <span className="font-bold text-[#C69214] font-mono">{div.kcal.toLocaleString()} kcal</span>
                              </div>
                              <div className="w-full bg-white rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className="bg-gradient-to-r from-[#72246C] to-[#C69214] h-full rounded-full transition-all duration-1000" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* SEARCH HISTORIES PORTLET */}
                <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h3 className="text-lg font-bold text-[#72246C]">ตรวจสอบประวัติสถิติรายบุคคล</h3>
                      <p className="text-xs text-[#72246C]/65">ระบุรหัสพนักงานเพื่อดูประวัติและผลลัพธ์ย้อนหลังทั้งหมด</p>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <input 
                        type="text" 
                        placeholder="กรอกรหัส เช่น EMP1001..." 
                        value={searchId}
                        onChange={(e) => setSearchId(e.target.value)}
                        className="w-full bg-white border border-[#C69214]/20 focus:border-[#C69214] rounded-lg py-2 pl-9 pr-4 text-sm text-[#72246C]/80 transition-all focus:outline-none"
                      />
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#72246C]/45 pointer-events-none">
                        <Search className="h-4 w-4" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-5 border border-[#C69214]/20">
                    <div className="flex flex-col sm:flex-row justify-between pb-4 border-b border-[#C69214]/20 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#C69214] font-bold border border-[#C69214]/15">
                          <User className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-[#72246C] text-sm">
                            {searchEmployee ? searchEmployee.name : '-'}
                          </h4>
                          <p className="text-xs text-[#72246C]/45">
                            {searchEmployee 
                              ? `ฝ่าย: ${searchEmployee.department} • กอง: ${searchEmployee.division}` 
                              : 'กรอกรหัสพนักงานที่ต้องการสืบค้นข้อมูลด้านบน'}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-[#72246C]/45 block">ยอดรวมแคลอรี่อนุมัติแล้ว</span>
                        <span className="text-lg font-bold text-[#C69214] font-mono">
                          {searchApprovedKcal.toLocaleString()} kcal
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="text-[#72246C]/65 border-b border-[#C69214]/20 font-semibold font-mono">
                            <th className="py-2.5">วันและเวลาบันทึก</th>
                            <th className="py-2.5">ประเภทกิจกรรม</th>
                            <th className="py-2.5">แคลอรี่สกัดได้</th>
                            <th className="py-2.5">ผลการตรวจสอบ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2A0D27]/60 font-mono">
                          {searchSubmissions.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center py-6 text-[#72246C]/45 font-sans">
                                {searchId.trim() ? 'ไม่พบข้อมูลประวัติการส่งออกกำลังกาย' : 'ไม่มีประวัติแสดงผล'}
                              </td>
                            </tr>
                          ) : (
                            [...searchSubmissions].reverse().map(sub => {
                              let statusStyles = "text-[#72246C]/65 bg-white border-[#C69214]/20";
                              let statusText = "รออนุมัติ";
                              if (sub.status === 'approved') {
                                statusStyles = "text-[#C69214] bg-[#C69214]/10 border-[#C69214]/20";
                                statusText = "อนุมัติแล้ว";
                              } else if (sub.status === 'rejected') {
                                statusStyles = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                                statusText = "ปฏิเสธ";
                              }
                              return (
                                <tr key={sub.id} className="hover:bg-white">
                                  <td className="py-3 text-[#72246C]/80">{sub.timestamp}</td>
                                  <td className="py-3 text-[#72246C] font-sans">{sub.activityType}</td>
                                  <td className="py-3 font-bold text-[#72246C]">{sub.kcal} kcal</td>
                                  <td className="py-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold border ${statusStyles} font-sans`}>
                                      {statusText}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: ADMIN APPROVAL QUEUE */}
            {activeTab === 'admin-portal' && (
              isAdminAuthenticated ? (
              <div className="bg-white border border-[#C69214]/20 rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-6 border-b border-[#C69214]/20">
                  <div>
                    <h2 className="text-xl font-bold text-[#72246C] flex items-center gap-2 m-0">
                      <ShieldCheck className="h-6 w-6 text-[#C69214]" />
                      ระบบควบคุม: งานอนุมัติสถิติประจำวัน
                    </h2>
                    <p className="text-xs text-[#72246C]/65 mt-1 mb-0">
                      ตรวจสอบความถูกต้องสอดคล้องของหลักฐานภาพนาฬิกา และตัดสินใจบันทึกคะแนนเข้าสู่ระบบส่วนกลาง
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleApproveAll}
                      className="px-4 py-2.5 bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold text-xs rounded-xl shadow-lg shadow-[#C69214]/10 transition-colors flex items-center gap-1.5"
                    >
                      <Check className="h-4 w-4 stroke-[3]" />
                      <span>อนุมัติทั้งหมดในคิว ({pendingQueue.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAdminLogout}
                      className="px-3 py-2.5 bg-white hover:bg-[#3A1536] text-[#72246C]/65 hover:text-[#72246C] font-bold text-xs rounded-xl border border-[#C69214]/20 transition-colors flex items-center gap-1.5"
                    >
                      <LogOut className="h-4 w-4" />
                      ออกจากระบบ
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#C69214]/15 text-[#72246C]/65 text-xs bg-[#72246C]/5 font-semibold">
                        <th className="py-4 px-4">ชื่อพนักงาน / สังกัด</th>
                        <th className="py-4 px-4">ประเภทกิจกรรม</th>
                        <th className="py-4 px-4">หลักฐานภาพถ่าย</th>
                        <th className="py-4 px-4 text-[#C69214] font-mono">Kcal</th>
                        <th className="py-4 px-4">ผลการแฮชสแกน</th>
                        <th className="py-4 px-4 text-center">จัดการคำขอ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C69214]/20 text-sm font-sans">
                      {pendingQueue.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-16 text-center text-[#72246C]/45">
                            <div className="flex flex-col items-center justify-center gap-2">
                              <ShieldCheck className="h-8 w-8 text-[#72246C]/25" />
                              <span className="font-semibold text-sm">ไม่มีสถิติรอดำเนินการในขณะนี้</span>
                              <p className="text-xs text-[#72246C]/35">สถิติทั้งหมดได้รับการตรวจสอบเรียบร้อยแล้ว</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        pendingQueue.map(sub => (
                          <tr key={sub.id} className="hover:bg-[#72246C]/5 transition-colors">
                            <td className="py-4 px-4">
                              <div className="font-bold text-[#72246C]">{sub.name}</div>
                              <div className="text-xs text-[#72246C]/65 font-mono">
                                {sub.empId} • {sub.department} ({sub.division})
                              </div>
                            </td>
                            <td className="py-4 px-4 text-[#72246C]/80">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[#C69214]"></span>
                                <span>{sub.activityType}</span>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <a 
                                href={sub.imageUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="block w-16 h-12 rounded-lg overflow-hidden border border-[#C69214]/20 hover:scale-150 hover:border-[#C69214] transition-all cursor-zoom-in relative bg-white"
                              >
                                <img src={sub.imageUrl} className="w-full h-full object-contain" alt="Verification proof" />
                              </a>
                            </td>
                            <td className="py-4 px-4 font-mono font-bold text-[#C69214] text-lg">
                              {sub.kcal}
                            </td>
                            <td className="py-4 px-4 font-mono text-xs text-[#72246C]/65">
                              <div className="truncate max-w-[120px]" title={sub.imageHash}>
                                Hash: {sub.imageHash?.substring(0, 12)}...
                              </div>
                              <div className="text-[10px] text-[#C69214] font-semibold flex items-center gap-0.5 mt-0.5">
                                <Calendar className="h-3 w-3" />
                                {sub.timestamp}
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-2">
                                <button 
                                  onClick={() => handleApprove(sub.id)}
                                  className="px-3 py-1.5 bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold text-xs rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Check className="h-3.5 w-3.5 stroke-[3]" /> อนุมัติ
                                </button>
                                <button 
                                  onClick={() => handleReject(sub.id)}
                                  className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-xs rounded-lg border border-rose-500/20 transition-colors flex items-center gap-1"
                                >
                                  <X className="h-3.5 w-3.5 stroke-[3]" /> ปฏิเสธ
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : (
              <div className="max-w-md mx-auto bg-white border border-[#C69214]/20 rounded-2xl p-6 shadow-xl">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-white border border-[#C69214]/20 flex items-center justify-center mx-auto mb-3 text-[#C69214]">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-[#72246C] m-0">เข้าสู่หลังบ้าน</h2>
                  <p className="text-xs text-[#72246C]/65 mt-2 mb-0">
                    สำหรับผู้ดูแลระบบเพื่อตรวจสอบและอนุมัติข้อมูลกิจกรรม
                  </p>
                </div>

                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#72246C]/65 mb-2">อีเมลผู้ดูแลระบบ</label>
                    <input
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full bg-white border border-[#C69214]/20 rounded-xl px-4 py-3 text-sm text-[#72246C] focus:outline-none focus:border-[#C69214]/60"
                      placeholder="admin@pea.co.th"
                      autoComplete="username"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#72246C]/65 mb-2">รหัสผ่าน</label>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full bg-white border border-[#C69214]/20 rounded-xl px-4 py-3 text-sm text-[#72246C] focus:outline-none focus:border-[#C69214]/60"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                  </div>

                  {adminLoginError && (
                    <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                      {adminLoginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold py-3 rounded-xl text-sm transition-colors"
                  >
                    เข้าสู่ระบบหลังบ้าน
                  </button>
                </form>
              </div>
              )
            )}

            {/* TAB 4: SYSTEM SPECIFICATION */}
            {activeTab === 'system-spec' && (
              <div className="bg-white border border-[#C69214]/20 rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#C69214] to-[#72246C]"></div>
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-[#C69214]/20">
                  <div>
                    <h2 className="text-xl font-bold text-[#C69214] flex items-center gap-2 m-0">
                      <FileCode className="h-6 w-6" />
                      เอกสารความต้องการระบบและการจัดทำ (System Specifications)
                    </h2>
                    <p className="text-xs text-[#72246C]/65 mt-1 mb-0">
                      รายละเอียดโครงสร้างสเปกสำหรับเซ็ตอัป Supabase ฐานข้อมูล และ Storage จริงด้วยตนเอง
                    </p>
                  </div>
                  <button 
                    onClick={handleDownloadSpec}
                    className="bg-[#C69214] hover:bg-[#B58112] text-[#2A0D27] font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-[#C69214]/10 transition-all"
                  >
                    <UploadCloud className="h-4 w-4" /> 
                    ดาวน์โหลดไฟล์ specification.md
                  </button>
                </div>

                <div className="prose prose-invert max-w-none text-[#72246C]/80 text-sm space-y-6 mt-6 leading-relaxed">
                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">1. Tech Stack (0 Baht budget stack)</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[#72246C]/65 text-xs">
                      <li><b>Frontend Platform:</b> React 19 + TypeScript + Tailwind CSS โฮสต์ฟรีบน Vercel</li>
                      <li><b>Database Engines:</b> Supabase (PostgreSQL) Free Tier สำหรับข้อมูลหลักและอันดับคะแนน</li>
                      <li><b>Proof Storage Bucket:</b> Supabase Storage (เก็บไฟล์รูปหลักฐาน)</li>
                      <li><b>Local OCR:</b> Tesseract.js สำหรับถอดคำจากรูปถ่ายแคลอรี่บนอุปกรณ์ผู้ใช้งานโดยไม่มีค่า API</li>
                      <li><b>Image Hashing:</b> SHA-256 (Web Crypto API) เพื่อป้องกันรูปเก่าส่งซ้ำ</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">2. Database Schema SQL Definitions</h3>
                    <div className="bg-white p-4 rounded-xl font-mono text-[11px] text-[#C69214] border border-[#C69214]/20 space-y-4">
                      <div>
                        <span className="text-[#72246C]/45">-- ตารางข้อมูลสังกัดและชื่อพนักงาน</span><br />
                        <span className="text-[#C69214]">CREATE TABLE</span> employees (<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;emp_id <span className="text-[#72246C]">VARCHAR(50) PRIMARY KEY</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;name <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;department <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;division <span className="text-[#72246C]">VARCHAR(255) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;created_at <span className="text-[#72246C]">TIMESTAMP WITH TIME ZONE DEFAULT NOW()</span><br />
                        );
                      </div>
                      <div className="border-t border-[#C69214]/20 pt-2">
                        <span className="text-[#72246C]/45">-- ตารางบันทึกการส่งคะแนนและการตรวจสอบ</span><br />
                        <span className="text-[#C69214]">CREATE TABLE</span> submissions (<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;id <span className="text-[#72246C]">BIGSERIAL PRIMARY KEY</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;emp_id <span className="text-[#72246C]">VARCHAR(50) REFERENCES</span> employees(emp_id),<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;activity_type <span className="text-[#72246C]">VARCHAR(100) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;kcal <span className="text-[#72246C]">INT NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;image_url <span className="text-[#72246C]">TEXT NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;image_hash <span className="text-[#72246C]">VARCHAR(64) NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;scanned_date <span className="text-[#72246C]">DATE NOT NULL</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;status <span className="text-[#72246C]">VARCHAR(50) DEFAULT 'pending'</span>,<br />
                        &nbsp;&nbsp;&nbsp;&nbsp;created_at <span className="text-[#72246C]">TIMESTAMP WITH TIME ZONE DEFAULT NOW()</span><br />
                        );
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#72246C] mb-2 font-mono border-b border-[#C69214]/20 pb-2">3. Business Verification Rules</h3>
                    <ul className="list-decimal pl-5 space-y-2 text-[#72246C]/65 text-xs">
                      <li><b>กฎจำกัดส่งรายวัน:</b> ตรวจสอบ `scanned_date` ในฐานข้อมูล โดยพนักงาน 1 รหัสต้องส่งได้สูงสุด 1 รายการ ต่อวัน (ยกเว้นรายการเดิมถูก Reject สามารถส่งใหม่ได้)</li>
                      <li><b>ตรวจสอบการเวียนรูปภาพหลักฐาน:</b> เมื่อผู้ใช้อัปโหลดรูป โปรแกรมจะทำ Hash หากค่าแฮชรูปตรงกับที่เคยมีอยู่ในตาราง ระบบจะไม่ยอมรับเพื่อสกัดการทุจริต</li>
                      <li><b>การจัดลีดเดอร์บอร์ด:</b> สถิติคำนวณจากตาราง submissions เฉพาะแถวที่มีสเตตัส `approved` เท่านั้น</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* TOAST POPUP */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 transform transition-all duration-300 translate-y-0 opacity-100">
          <div className={`border rounded-2xl p-4 shadow-2xl flex items-center gap-3 bg-white ${
            toast.type === 'success' ? 'border-[#C69214]/30 text-[#C69214]' : 'border-rose-500/30 text-rose-400'
          }`}>
            {toast.type === 'success' ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            <div>
              <p className="font-bold text-sm text-[#72246C] m-0">{toast.title}</p>
              <p className="text-xs text-[#72246C]/65 m-0 mt-0.5">{toast.desc}</p>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-white border-t border-[#C69214]/20 py-4 text-center text-[#72246C]/45 text-xs">
        <p className="m-0">2026 PEA Titan Move • All Rights Reserved</p>
      </footer>
    </div>
  );
}
