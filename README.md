# PNG In-hand Salary Calculator (Angular 17)

Calculates PNG in-hand salary from an AUD (or PGK) gross package using the
2026 PNG salary & wages tax slabs, with superannuation treatment and live
FX rates (AUD→PGK and PGK→INR) from open.er-api.com.

## Features
- Gross package input in **AUD or PGK** — annual, monthly, or fortnightly
- **Live FX** from https://open.er-api.com/v6/latest/AUD — one call fetches
  `rates.PGK`, `rates.INR`, and `rates.USD`; the AUD→PGK rate is editable,
  ↻ refetches
- **"View results in" toggle (PGK / AUD / INR / USD)** — converts every
  result amount into the selected currency; INR/USD use cross rates
  (`INR ÷ PGK`, `USD ÷ PGK`) from the same API response
- **Dependant rebate** (residents): 15% of gross tax (K45–K450) for the 1st
  dependant, 10% (K30–K300) each for the 2nd and 3rd, per PwC WWTS Mar 2026
- **Shareable links** — inputs are encoded in the URL (`?g=…&cur=…&dep=…`);
  the "Copy share link" button copies it. Inputs also persist in
  localStorage between visits (URL params win)
- Super treatment: deducted from gross (employee, post-tax) or employer-paid
  on top
- Resident / non-resident brackets, tax split bar, per-slab breakdown

## Run locally
```bash
npm install
ng serve
# open http://localhost:4200
```

## Build for production / GitHub Pages
```bash
ng build
# output in dist/inhand-test/browser
# for GitHub Pages: ng build --base-href "/<repo-name>/"
```

## Key files
- `src/app/inhand-calculator.component.ts` — the entire calculator
  (standalone component, signals + computed, inline template & styles)
- `src/app/app.component.ts` — thin shell that mounts it
- `angular.json` — note: `anyComponentStyle` budget raised to 10kB/20kB
  because the component carries inline styles

## How the numbers work
1. The entered package is annualised (×12 if monthly) and, if in AUD,
   converted to PGK with the AUD→PGK rate.
2. PNG salary & wages tax is assessed on the **PGK** gross using the slab
   brackets (resident: tax-free to K20,000 then 30/35/40/42%; non-resident:
   22% from the first kina).
3. The dependant rebate (residents only) is subtracted from gross tax,
   capped at the gross tax itself.
4. Employee super (default 6%) is deducted **after tax** when "Deducted from
   gross" is selected; "Employer pays on top" leaves in-hand unchanged.
5. The result-currency toggle only changes the **display**: tax is always
   computed in PGK, then amounts are multiplied by 1 (PGK), 1/AUD→PGK (AUD),
   PGK→INR, or PGK→USD.

## FX notes
- Rates are fetched once on init (free tier updates daily). Fallbacks if
  unreachable: AUD→PGK 3.03, PGK→INR 21.0, PGK→USD 0.24 (10 Jul 2026
  mid-market); a badge shows live / fallback / manual status.
- Editing the AUD→PGK rate marks it "Manual"; ↻ restores the live rate.
  The INR cross rate always comes from the API (or fallback).
- Attribution to exchangerate-api.com is required by their terms if you
  publish this.

## Live site
https://nithin2305.github.io/inhand-calculator-angular/

Deployed from the `gh-pages` branch. To redeploy after changes:
```bash
npx ng build --base-href "/inhand-calculator-angular/"
# copy index.html to 404.html in dist/inhand-test/browser, then push that
# folder to the gh-pages branch (see .github/workflows/deploy.yml, which
# automates this once GitHub Actions is enabled on the account)
```

## Limitations
- The dependant rebate uses the published annual rebate formula; employer
  fortnightly SWT tables may differ by rounding.
- AUD/INR/USD result views are indicative mid-market conversions, not bank
  transfer rates.
