# FoodLens 🥝

A private, mobile-first personal food scanner for GitHub Pages.

**Scan a barcode → retrieve real product details from Open Food Facts → compare France's Nutri-Score with Australia's Health Star Rating.** Unlike a simple conversion, each scoring engine follows its own country's points tables and product category logic.

## Features

- Scan EAN-13, EAN-8, UPC-A, UPC-E, CODE-128 and ITF via your phone's camera using pinned `html5-qrcode` (loaded on demand). A native BarcodeDetector fallback is used where supported, with a manual barcode field in all browsers.
- Look up a product by barcode via Open Food Facts Product API v2; example lookup uses barcode `3017620422003` (Nutella). No sample product facts or ratings are fabricated or bundled.
- Display real product images, ingredients, NOVA group, allergens (when supplied), and nutrition per 100 g / 100 mL.
- Calculate **Nutri-Score (updated 2023 algorithm)** for foods, cheeses, red meat, fats/nuts/seeds, and beverages (with a separate verified-water option). Prefer Open Food Facts' reported grade before the user edits any data; show the source explicitly.
- Calculate **Health Star Rating (Implementation Guide v9, December 2025)** for all six categories, including automatic rating options for verified water, unsweetened flavoured water and fresh/minimally processed fruit/vegetables.
- **Never assume missing fibre, protein or ingredient percentage is zero.** Show a possible grade or star range instead; if the rating is invariant over possible missing inputs, say so explicitly.
- Edit nutrition values and categories directly from the packet. Convert between salt (g) and sodium (mg). Distinguish Nutri-Score's FVL percentage from HSR's FVNL percentage.
- Device-only history, favourites, JSON backup and import, installable PWA, and offline access to the app shell. No user accounts, backend or database hosting.

### Important limitations / accuracy

- This app is a **personal, educational tool, not an official Nutri-Score or Health Star Rating calculator** and it is not approved to reproduce either scheme's certified artwork. The UI uses its own typography and simple letter/star visuals.
- HSR category eligibility — especially **milk substitutes, dairy foods and high-calcium cheese** — cannot be reliably inferred from a barcode. The app suggests a category from Open Food Facts tags but tells users to check the criteria themselves.
- The **FVNL ingredient-percent values are not universally supplied by Open Food Facts**. Without verified values, the app calculates a possible range and offers manual input. Mixed dehydrated + fresh FVNL requires pre-adjusting the fraction following the HSR guide.
- The app offers automatic HSR categories only upon explicit user choice or a database classification for plain water. Verify all such choices and the label itself.
- Open Food Facts' *reported* Nutri-Score may use a different algorithm version from this app's computation. A database grade is labelled as such and is cleared when the nutritional label is edited.
- Labels may report prepared versus as-sold values. They must use the correct per-100g/per-100mL basis for the scoring method. The app does not convert recipes or servings.
- Nutrient data may be missing/incorrect; novel formulations may have different nutrition. The source API is community maintained. Some products will not be found, especially products sold locally in Malaysia.
- Although the app runs locally on GitHub Pages, queries send barcodes to Open Food Facts; loading the scanner library or web fonts also communicates with a CDN. Device-only storage is not encrypted; don't use a shared device for sensitive data.
- Scoring labels are **not** a substitute for individual nutritional advice. Compare similar products within the same category.

## Deploy with GitHub Pages

1. Create a **public repository named `food-lens`** in your `datojulien` account.
2. Upload **all files and folders** from this project to the *root* of its `main` branch.
3. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main`, `/ (root)` → Save**.
4. After Pages publishes, the app will be at `https://datojulien.github.io/food-lens/`.
5. On iPhone: Safari → Share → Add to Home Screen; grant camera permission when prompted.

GitHub Pages from a public repository is free. The site uses relative file paths and a manifest scope of `./`, so it can be hosted under another directory if you prefer.

### Local use

Python 3: `python3 -m http.server 8000` then open `http://localhost:8000`.

Do **not** open `index.html` directly as a `file://` URL: ES modules, the camera and the service worker require a local HTTP server or HTTPS.

### Tests

Node 20+: `npm test` (zero npm dependencies). A browser is needed for scanner and layout checks. Camera barcode scanning can be fully checked only on a device with a working camera and an actual product.

### Tech / licensing

- Plain HTML/CSS/ES modules, no framework/build chain.
- Uses [Open Food Facts](https://world.openfoodfacts.org/) API. Attribute the database as Open Food Facts and review its [ODbL reuse rules](https://world.openfoodfacts.org/terms-of-use) before publishing a commercial derivative database.
- `html5-qrcode@2.3.8` is served on demand from jsDelivr, falling back to unpkg. To make camera scanning self-hosted, vendor its distributable (subject to its license) and update `loadScannerLibrary()`.
- The Open Food Facts REST API asks apps to identify themselves using a custom `User-Agent`; browsers block setting that header. For single-user personal use the direct browser fetch is kept lightweight. At scale, use a proxy with an identified User-Agent in accordance with their guidance.

#### Official scoring references

- [Santé publique France — Nutri-Score](https://www.santepubliquefrance.fr/en/Nutri-Score)
- [Scientific and technical Q&A (June 2024)](https://www.blv.admin.ch/dam/blv/de/dokumente/lebensmittel-und-ernaehrung/ernaehrung/nutri-score-fragen-antworten-en.pdf.download.pdf/QR_scientifique_technique_EN_011119.pdf), esp. pages 26–32 for updated algorithms.
- [Australian Health Star Rating Implementation Guide v9](https://www.healthstarrating.gov.au/industry/health-star-rating-system-implementation-guide), Appendix 1 tables 1–7.
- [Open Food Facts Product API](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)

## Directory

```
index.html                 Main app / PWA entry
styles.css                 Responsive UI
app.mjs                    Barcode lookup, camera, local data, views
scores.mjs                 Pure independent rating engines
sw.js                      Offline app shell, same-origin only
manifest.webmanifest       Installable PWA manifest
icons/                     App icon assets
tests/                     Node scoring and normalisation tests
.nojekyll                  Disable automatic Jekyll transformation
```
