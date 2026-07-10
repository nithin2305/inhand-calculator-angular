# PNG In-hand Salary Calculator (Angular 17)

Calculates PNG in-hand salary from an AUD (or PGK) gross package using the
2026 PNG salary & wages tax slabs, with superannuation treatment and live
FX rates (AUD→PGK and PGK→INR) from open.er-api.com.

## Features
- Gross package input in **AUD or PGK**, annual or monthly
- **Live FX** from https://open.er-api.com/v6/latest/AUD — one call fetches
  both `rates.PGK` and `rates.INR`; the AUD→PGK rate is editable, ↻ refetches
- **"View results in" toggle (PGK / AUD / INR)** — converts every result
  amount (hero, fortnightly, and the full annual/monthly summary table) into
  the selected currency; INR uses the cross rate `INR ÷ PGK` from the same
  API response
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
3. Employee super (default 6%) is deducted **after tax** when "Deducted from
   gross" is selected; "Employer pays on top" leaves in-hand unchanged.
4. The result-currency toggle only changes the **display**: tax is always
   computed in PGK, then amounts are multiplied by 1 (PGK), 1/AUD→PGK (AUD),
   or PGK→INR (INR).

## FX notes
- Rates are fetched once on init (free tier updates daily). Fallbacks if
  unreachable: AUD→PGK 3.03, PGK→INR 21.0 (10 Jul 2026 mid-market);
  a badge shows live / fallback / manual status.
- Editing the AUD→PGK rate marks it "Manual"; ↻ restores the live rate.
  The INR cross rate always comes from the API (or fallback).
- Attribution to exchangerate-api.com is required by their terms if you
  publish this.

## Limitations
- Dependant rebates are not modelled.
- AUD/INR result views are indicative mid-market conversions, not bank
  transfer rates.
