import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// ---------------------------------------------------------------------------
// PNG personal income tax brackets (per PwC Worldwide Tax Summaries, Mar 2026)
// ---------------------------------------------------------------------------
interface Bracket {
  upTo: number;
  rate: number;
}

interface Slab {
  from: number;
  to: number;
  rate: number;
  taxable: number;
  tax: number;
}

interface CalcResult {
  annualGross: number;
  annualTax: number;
  annualSuper: number;
  annualNet: number;
  monthlyGross: number;
  monthlyTax: number;
  monthlySuper: number;
  monthlyNet: number;
  fortnightlyNet: number;
  monthlyNetAud: number | null;
  annualNetAud: number | null;
  effectiveRate: number;
  netShare: number;
  taxShare: number;
  superShare: number;
  deducted: boolean;
  slabs: Slab[];
}

const BRACKETS: Record<'resident' | 'nonResident', Bracket[]> = {
  resident: [
    { upTo: 20000, rate: 0 },
    { upTo: 33000, rate: 0.3 },
    { upTo: 70000, rate: 0.35 },
    { upTo: 250000, rate: 0.4 },
    { upTo: Infinity, rate: 0.42 },
  ],
  nonResident: [
    { upTo: 20000, rate: 0.22 },
    { upTo: 33000, rate: 0.3 },
    { upTo: 70000, rate: 0.35 },
    { upTo: 250000, rate: 0.4 },
    { upTo: Infinity, rate: 0.42 },
  ],
};

const FX_API = 'https://open.er-api.com/v6/latest/AUD';
// Fallback mid-market AUD → PGK rate (10 Jul 2026), used if the API is unreachable
const FALLBACK_AUD_PGK = 3.03;
// Fallback PGK → INR rate (10 Jul 2026), used if the API is unreachable
const FALLBACK_PGK_INR = 21.0;

type FxStatus = 'loading' | 'live' | 'fallback' | 'edited';
type ResultCurrency = 'PGK' | 'AUD' | 'INR';

@Component({
  selector: 'app-inhand-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="card">
        <header class="header">
          <div class="eyebrow">PNG · SALARY &amp; WAGES TAX</div>
          <h1 class="title">In-hand calculator</h1>
        </header>

        <!-- Gross input + currency -->
        <div class="field">
          <div class="label-row">
            <label class="label" for="gross">Gross package ({{ period() }})</label>
            <div class="segment segment-sm" role="group" aria-label="Input currency">
              <button
                *ngFor="let c of ['AUD', 'PGK']"
                class="seg-btn seg-btn-sm"
                [class.active]="inputCurrency() === c"
                (click)="inputCurrency.set(c)"
              >
                {{ c }}
              </button>
            </div>
          </div>
          <div class="input-wrap">
            <span class="prefix">{{ isAud() ? 'A$' : 'K' }}</span>
            <input
              id="gross"
              type="number"
              inputmode="decimal"
              min="0"
              placeholder="0.00"
              class="num-input"
              [ngModel]="gross()"
              (ngModelChange)="gross.set($event)"
            />
          </div>
        </div>

        <!-- FX rate + super -->
        <div class="input-grid">
          <div class="field" *ngIf="isAud()">
            <div class="label-row">
              <label class="label" for="fx">AUD → PGK</label>
              <span class="badge" [ngClass]="'badge-' + fxStatus()">{{ fxBadgeText() }}</span>
            </div>
            <div class="input-wrap">
              <input
                id="fx"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.0001"
                class="num-input num-input-md"
                [ngModel]="fxRate()"
                (ngModelChange)="onFxEdited($event)"
              />
              <button
                class="refresh-btn"
                title="Refresh live rate"
                aria-label="Refresh live rate"
                (click)="loadRate()"
              >
                ↻
              </button>
            </div>
            <span class="hint">{{ fxHint() }}</span>
            <span class="hint" *ngIf="fxStatus() === 'live' && liveRate() !== null">
              API says: 1 AUD = {{ liveRate() }} PGK (base_code AUD)
            </span>
          </div>

          <div class="field">
            <label class="label" for="super">Superannuation</label>
            <div class="input-wrap">
              <input
                id="super"
                type="number"
                inputmode="decimal"
                min="0"
                max="99"
                step="0.1"
                placeholder="6"
                class="num-input num-input-md"
                [ngModel]="superPct()"
                (ngModelChange)="superPct.set($event)"
              />
              <span class="suffix">%</span>
            </div>
          </div>
        </div>

        <!-- Converted amount strip -->
        <div class="fx-strip" *ngIf="isAud() && calc() as c">
          A$ {{ enteredAnnual() | number : '1.2-2' }} / yr × {{ rateNum() | number : '1.2-4' }} =
          <strong>K {{ c.annualGross | number : '1.2-2' }}</strong> annual gross
        </div>

        <!-- Super treatment -->
        <div class="field">
          <span class="label">Super treatment</span>
          <div class="segment self-start" role="group" aria-label="Super treatment">
            <button
              class="seg-btn"
              [class.active]="superMode() === 'included'"
              (click)="superMode.set('included')"
            >
              Deducted from gross
            </button>
            <button
              class="seg-btn"
              [class.active]="superMode() === 'excluded'"
              (click)="superMode.set('excluded')"
            >
              Employer pays on top
            </button>
          </div>
          <span class="hint">
            {{
              superMode() === 'included'
                ? 'Employee contribution — comes out of your pay after tax.'
                : 'Employer contribution — accrues to your fund, in-hand unchanged.'
            }}
          </span>
        </div>

        <!-- Period + residency -->
        <div class="toggle-row">
          <div class="segment" role="group" aria-label="Salary period">
            <button
              *ngFor="let p of periods"
              class="seg-btn"
              [class.active]="period() === p.key"
              (click)="period.set(p.key)"
            >
              {{ p.label }}
            </button>
          </div>
          <div class="segment" role="group" aria-label="Residency status">
            <button
              *ngFor="let r of residencies"
              class="seg-btn"
              [class.active]="residency() === r.key"
              (click)="residency.set(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

        <!-- Split bar -->
        <div class="bar-section">
          <div class="bar-track" aria-hidden="true">
            <div class="bar-net" [style.width.%]="calc()?.netShare ?? 0"></div>
            <div
              class="bar-super"
              *ngIf="calc()?.deducted && (calc()?.superShare ?? 0) > 0"
              [style.width.%]="calc()?.superShare"
            ></div>
          </div>
          <div class="bar-legend">
            <span class="legend-net">
              ● In-hand {{ calc() ? (calc()!.netShare | number : '1.1-1') + '%' : '—' }}
            </span>
            <span class="legend-super" *ngIf="calc()?.deducted && (calc()?.superShare ?? 0) > 0">
              ● Super {{ calc()!.superShare | number : '1.1-1' }}%
            </span>
            <span class="legend-tax">
              Tax {{ calc() ? (calc()!.taxShare | number : '1.1-1') + '%' : '—' }} ●
            </span>
          </div>
        </div>

        <!-- Result currency -->
        <div class="field">
          <div class="label-row">
            <span class="label">View results in</span>
            <span class="hint" *ngIf="resultCurrency() !== 'PGK'">
              1 PGK ≈ {{ sym() }} {{ pgkToDisplay() | number : '1.2-4' }}
            </span>
          </div>
          <div class="segment self-start" role="group" aria-label="Result currency">
            <button
              *ngFor="let c of resultCurrencies"
              class="seg-btn"
              [class.active]="resultCurrency() === c"
              (click)="resultCurrency.set(c)"
            >
              {{ c }}
            </button>
          </div>
        </div>

        <!-- Result hero -->
        <div class="result-hero">
          <div class="result-label">Monthly in-hand</div>
          <div class="result-value">
            {{ sym() }} {{ calc() ? (d(calc()!.monthlyNet) | number : '1.2-2') : '0.00' }}
          </div>
          <div class="result-sub">
            Fortnightly {{ sym() }}
            {{ calc() ? (d(calc()!.fortnightlyNet) | number : '1.2-2') : '0.00' }}
            <ng-container
              *ngIf="resultCurrency() === 'PGK' && calc()?.monthlyNetAud !== null && calc()"
            >
              · ≈ A$ {{ calc()!.monthlyNetAud | number : '1.2-2' }} / month
            </ng-container>
          </div>
        </div>

        <!-- Summary table (in the selected result currency) -->
        <div class="table" *ngIf="calc() as c; else emptyTable">
          <div class="row">
            <span class="row-label">Annual gross</span>
            <span class="row-value">{{ sym() }} {{ d(c.annualGross) | number : '1.2-2' }}</span>
          </div>
          <div class="row">
            <span class="row-label">Annual tax</span>
            <span class="row-value tax">− {{ sym() }} {{ d(c.annualTax) | number : '1.2-2' }}</span>
          </div>
          <div class="row">
            <span class="row-label">
              Annual super ({{ superPctNum() }}%){{ !c.deducted ? ' · on top' : '' }}
            </span>
            <span class="row-value super">
              {{ c.deducted ? '−' : '+' }} {{ sym() }} {{ d(c.annualSuper) | number : '1.2-2' }}
            </span>
          </div>
          <div class="row">
            <span class="row-label strong">Annual in-hand</span>
            <span class="row-value strong">
              {{ sym() }} {{ d(c.annualNet) | number : '1.2-2' }}
            </span>
          </div>
          <div class="row" *ngIf="resultCurrency() === 'PGK' && c.annualNetAud !== null">
            <span class="row-label">Annual in-hand (AUD)</span>
            <span class="row-value">≈ A$ {{ c.annualNetAud | number : '1.2-2' }}</span>
          </div>
          <div class="divider"></div>
          <div class="row">
            <span class="row-label">Monthly gross</span>
            <span class="row-value">{{ sym() }} {{ d(c.monthlyGross) | number : '1.2-2' }}</span>
          </div>
          <div class="row">
            <span class="row-label">Monthly tax</span>
            <span class="row-value tax">− {{ sym() }} {{ d(c.monthlyTax) | number : '1.2-2' }}</span>
          </div>
          <div class="row">
            <span class="row-label">Monthly super</span>
            <span class="row-value super">
              {{ c.deducted ? '−' : '+' }} {{ sym() }} {{ d(c.monthlySuper) | number : '1.2-2' }}
            </span>
          </div>
          <div class="row">
            <span class="row-label strong">Monthly in-hand</span>
            <span class="row-value strong">
              {{ sym() }} {{ d(c.monthlyNet) | number : '1.2-2' }}
            </span>
          </div>
        </div>
        <ng-template #emptyTable>
          <div class="table">
            <div class="row"><span class="row-label">Enter a gross amount to calculate.</span></div>
          </div>
        </ng-template>

        <!-- Slab breakdown -->
        <button class="slab-toggle" [disabled]="!calc()" (click)="showSlabs.set(!showSlabs())">
          {{ showSlabs() ? 'Hide' : 'Show' }} slab breakdown {{ showSlabs() ? '▴' : '▾' }}
        </button>

        <div class="slab-table" *ngIf="showSlabs() && calc() as c">
          <div class="slab-row slab-head">
            <span>Slab (K)</span>
            <span class="right">Rate</span>
            <span class="right">Taxable</span>
            <span class="right">Tax</span>
          </div>
          <div class="slab-row" *ngFor="let sl of c.slabs">
            <span class="slab-range">{{ fmtLimit(sl.from) }} – {{ fmtLimit(sl.to) }}</span>
            <span class="right">{{ sl.rate * 100 | number : '1.0-0' }}%</span>
            <span class="right">{{ sl.taxable | number : '1.2-2' }}</span>
            <span class="right" [class.amber]="sl.tax > 0">{{ sl.tax | number : '1.2-2' }}</span>
          </div>
          <div class="slab-row slab-total">
            <span>Total</span>
            <span class="right">{{ c.effectiveRate | number : '1.1-1' }}%</span>
            <span class="right">{{ c.annualGross | number : '1.2-2' }}</span>
            <span class="right amber">{{ c.annualTax | number : '1.2-2' }}</span>
          </div>
        </div>

        <p class="footnote">
          Rates are fetched live from open.er-api.com/v6/latest/AUD (PGK and INR) and displayed
          exactly as the API returns them. AUD packages are converted to kina before tax — PNG
          salary &amp; wages tax is assessed on the PGK value, and employee super contributions
          are deducted after tax. AUD/INR result views are indicative conversions of the PGK
          amounts. Excludes dependant rebates.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        --ink: #101c17;
        --paper: #f6f7f3;
        --card: #ffffff;
        --green: #1d6b52;
        --green-dark: #134534;
        --amber: #b07a0c;
        --blue: #2c5f8a;
        --line: #e2e5dd;
        --muted: #6a7369;
        display: block;
      }
      .page {
        min-height: 100vh;
        background: var(--paper);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 24px 16px 48px;
        font-family: 'Avenir Next', 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: var(--ink);
      }
      .card {
        width: 100%;
        max-width: 480px;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 28px 24px 22px;
        box-shadow: 0 1px 2px rgba(16, 28, 23, 0.04), 0 8px 24px rgba(16, 28, 23, 0.06);
      }
      .header { margin-bottom: 22px; }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.14em;
        color: var(--green);
        font-weight: 600;
        margin-bottom: 6px;
      }
      .title { font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }

      .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
      .label-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .label { font-size: 13px; font-weight: 600; color: var(--muted); }
      .hint { font-size: 12px; color: var(--muted); line-height: 1.4; }
      .input-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; }
      @media (max-width: 420px) {
        .input-grid { grid-template-columns: 1fr; }
      }

      .input-wrap {
        display: flex;
        align-items: center;
        border: 1.5px solid var(--line);
        border-radius: 10px;
        padding: 0 8px 0 14px;
        background: #fcfdfb;
      }
      .input-wrap:focus-within { border-color: var(--green); }
      .prefix { font-size: 18px; font-weight: 600; color: var(--muted); margin-right: 8px; }
      .suffix { font-size: 18px; font-weight: 600; color: var(--muted); margin: 0 6px 0 8px; }
      .num-input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 24px;
        font-weight: 600;
        padding: 12px 0;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
        width: 100%;
        min-width: 0;
      }
      .num-input-md { font-size: 20px; }
      .num-input:focus { outline: none; }
      .num-input::-webkit-outer-spin-button,
      .num-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .num-input { -moz-appearance: textfield; appearance: textfield; }

      .badge {
        font-size: 10.5px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 20px;
        white-space: nowrap;
      }
      .badge-loading { color: var(--muted); background: #eff1eb; }
      .badge-live { color: var(--green-dark); background: #e4f0ea; }
      .badge-fallback { color: var(--amber); background: #f7eedb; }
      .badge-edited { color: var(--blue); background: #eff4f8; }

      .refresh-btn {
        border: none;
        background: #eff1eb;
        color: var(--green-dark);
        border-radius: 7px;
        width: 30px;
        height: 30px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        flex-shrink: 0;
      }

      .fx-strip {
        background: #eff4f8;
        border: 1px solid #d5e2ec;
        color: var(--blue);
        border-radius: 9px;
        padding: 8px 12px;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        margin-bottom: 14px;
      }

      .segment {
        display: flex;
        background: #eff1eb;
        border-radius: 9px;
        padding: 3px;
        gap: 2px;
        flex-wrap: wrap;
      }
      .segment-sm { padding: 2px; }
      .self-start { align-self: flex-start; }
      .seg-btn {
        border: none;
        background: transparent;
        padding: 7px 12px;
        border-radius: 7px;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted);
        cursor: pointer;
      }
      .seg-btn-sm { padding: 4px 10px; font-size: 12px; }
      .seg-btn.active {
        background: var(--card);
        color: var(--green-dark);
        box-shadow: 0 1px 2px rgba(16, 28, 23, 0.12);
      }
      .seg-btn:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

      .toggle-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }

      .bar-section { margin-bottom: 22px; }
      .bar-track {
        height: 14px;
        border-radius: 7px;
        background: var(--amber);
        overflow: hidden;
        display: flex;
      }
      .bar-net {
        height: 100%;
        background: linear-gradient(90deg, var(--green-dark), var(--green));
        transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .bar-super {
        height: 100%;
        background: var(--blue);
        transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        .bar-net, .bar-super { transition: none; }
      }
      .bar-legend {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 7px;
        font-size: 12.5px;
        font-weight: 600;
      }
      .legend-net { color: var(--green-dark); }
      .legend-super { color: var(--blue); }
      .legend-tax { color: var(--amber); }

      .result-hero {
        background: var(--green-dark);
        border-radius: 12px;
        padding: 18px 20px;
        margin-bottom: 18px;
      }
      .result-label {
        font-size: 12px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #a8cbbb;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .result-value {
        font-size: 34px;
        font-weight: 700;
        color: #ffffff;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }
      .result-sub {
        margin-top: 4px;
        font-size: 13px;
        font-weight: 600;
        color: #a8cbbb;
        font-variant-numeric: tabular-nums;
      }

      .table { display: flex; flex-direction: column; gap: 10px; }
      .row { display: flex; justify-content: space-between; align-items: baseline; }
      .row-label { font-size: 14px; color: var(--muted); }
      .row-label.strong { color: var(--ink); font-weight: 700; }
      .row-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .row-value.strong { font-size: 16px; font-weight: 700; color: var(--green-dark); }
      .row-value.tax { color: var(--amber); }
      .row-value.super { color: var(--blue); }
      .divider { height: 1px; background: var(--line); margin: 4px 0; }

      .slab-toggle {
        margin-top: 18px;
        width: 100%;
        border: 1px solid var(--line);
        background: #fcfdfb;
        border-radius: 9px;
        padding: 9px 12px;
        font-size: 13px;
        font-weight: 600;
        color: var(--green-dark);
        cursor: pointer;
      }
      .slab-toggle:disabled { opacity: 0.5; cursor: default; }

      .slab-table {
        margin-top: 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: hidden;
      }
      .slab-row {
        display: grid;
        grid-template-columns: 1.4fr 0.6fr 1fr 1fr;
        gap: 8px;
        padding: 9px 12px;
        font-size: 12.5px;
        font-variant-numeric: tabular-nums;
        border-bottom: 1px solid var(--line);
      }
      .slab-head {
        background: #eff1eb;
        font-weight: 700;
        color: var(--muted);
        font-size: 11.5px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .slab-range { font-weight: 600; }
      .slab-total { font-weight: 700; background: #fcfdfb; border-bottom: none; }
      .right { text-align: right; }
      .amber { color: var(--amber); }

      .footnote {
        margin-top: 18px;
        margin-bottom: 0;
        font-size: 12px;
        color: var(--muted);
        line-height: 1.5;
      }
    `,
  ],
})
export class InhandCalculatorComponent implements OnInit {
  // ---- input state (signals) ----
  gross = signal<number | null>(null);
  inputCurrency = signal<string>('AUD');
  fxRate = signal<number | null>(FALLBACK_AUD_PGK);
  fxStatus = signal<FxStatus>('loading');
  fxUpdated = signal<string | null>(null);
  liveRate = signal<number | null>(null);
  superPct = signal<number | null>(6);
  superMode = signal<'included' | 'excluded'>('included');
  period = signal<'annual' | 'monthly'>('annual');
  residency = signal<'resident' | 'nonResident'>('resident');
  showSlabs = signal(false);
  resultCurrency = signal<ResultCurrency>('PGK');
  pgkInrRate = signal<number>(FALLBACK_PGK_INR); // PGK → INR

  readonly resultCurrencies: ResultCurrency[] = ['PGK', 'AUD', 'INR'];
  readonly periods = [
    { key: 'annual' as const, label: 'Annual' },
    { key: 'monthly' as const, label: 'Monthly' },
  ];
  readonly residencies = [
    { key: 'resident' as const, label: 'Resident' },
    { key: 'nonResident' as const, label: 'Non-resident' },
  ];

  // ---- derived state (computed) ----
  isAud = computed(() => this.inputCurrency() === 'AUD');
  rateNum = computed(() => Number(this.fxRate()) || 0);
  superPctNum = computed(() => Number(this.superPct()) || 0);
  enteredAnnual = computed(() => {
    const g = Number(this.gross()) || 0;
    return this.period() === 'annual' ? g : g * 12;
  });

  /** Multiplier that converts a PGK amount into the selected result currency. */
  pgkToDisplay = computed(() => {
    switch (this.resultCurrency()) {
      case 'PGK':
        return 1;
      case 'AUD':
        return this.rateNum() > 0 ? 1 / this.rateNum() : 0;
      case 'INR':
        return this.pgkInrRate();
    }
  });

  sym = computed(() => ({ PGK: 'K', AUD: 'A$', INR: '₹' }[this.resultCurrency()]));

  /** Convert a PGK amount to the selected result currency. */
  d(pgk: number): number {
    return pgk * this.pgkToDisplay();
  }

  calc = computed<CalcResult | null>(() => {
    const g = Number(this.gross());
    const s = this.superPctNum();
    const rate = this.rateNum();
    const isAud = this.isAud();

    const rateValid = !isAud || rate > 0;
    if (!(g > 0) || s < 0 || s >= 100 || !rateValid) return null;

    const enteredAnnual = this.period() === 'annual' ? g : g * 12;
    const annualGross = isAud ? enteredAnnual * rate : enteredAnnual; // PGK

    const annualSuper = annualGross * (s / 100);

    // PNG SWT is levied on gross salary; employee super contributions are post-tax
    const { tax, slabs } = this.computeTax(annualGross, BRACKETS[this.residency()]);

    const deducted = this.superMode() === 'included';
    const annualNet = annualGross - tax - (deducted ? annualSuper : 0);
    const toAud = (v: number): number | null => (isAud ? v / rate : null);

    return {
      annualGross,
      annualTax: tax,
      annualSuper,
      annualNet,
      monthlyGross: annualGross / 12,
      monthlyTax: tax / 12,
      monthlySuper: annualSuper / 12,
      monthlyNet: annualNet / 12,
      fortnightlyNet: annualNet / 26,
      monthlyNetAud: toAud(annualNet / 12),
      annualNetAud: toAud(annualNet),
      effectiveRate: (tax / annualGross) * 100,
      netShare: (annualNet / annualGross) * 100,
      taxShare: (tax / annualGross) * 100,
      superShare: deducted ? (annualSuper / annualGross) * 100 : 0,
      deducted,
      slabs,
    };
  });

  fxBadgeText = computed(() => {
    switch (this.fxStatus()) {
      case 'loading': return 'Fetching live rate…';
      case 'live': return '● Live';
      case 'fallback': return '● Offline — fallback rate';
      case 'edited': return '● Manual';
    }
  });

  fxHint = computed(() => {
    const status = this.fxStatus();
    const updated = this.fxUpdated();
    if (status === 'live' && updated) {
      return `open.er-api.com · updated ${updated.replace(' +0000', ' UTC')}`;
    }
    if (status === 'live') return 'Live from open.er-api.com — edit to override.';
    if (status === 'edited') return 'Manual rate — ↻ restores the live rate.';
    if (status === 'fallback') return 'API unreachable; using 10 Jul 2026 mid-market. Edit or retry ↻.';
    return 'Contacting open.er-api.com…';
  });

  ngOnInit(): void {
    this.loadRate();
  }

  async loadRate(): Promise<void> {
    this.fxStatus.set('loading');
    try {
      const res = await fetch(FX_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const audPgk: number | undefined = data?.rates?.PGK; // AUD base → PGK, direct
      const audInr: number | undefined = data?.rates?.INR; // AUD base → INR, direct
      if (data?.result === 'success' && data?.base_code === 'AUD' && audPgk && audPgk > 0) {
        this.fxRate.set(audPgk); // display exactly as returned
        this.liveRate.set(audPgk);
        if (audInr && audInr > 0) this.pgkInrRate.set(audInr / audPgk); // cross rate via AUD
        this.fxUpdated.set(data.time_last_update_utc ?? null);
        this.fxStatus.set('live');
      } else {
        throw new Error('bad payload');
      }
    } catch {
      this.fxRate.set(FALLBACK_AUD_PGK);
      this.pgkInrRate.set(FALLBACK_PGK_INR);
      this.liveRate.set(null);
      this.fxUpdated.set(null);
      this.fxStatus.set('fallback');
    }
  }

  onFxEdited(value: number | null): void {
    this.fxRate.set(value);
    this.fxStatus.set('edited');
  }

  fmtLimit(n: number): string {
    return n === Infinity ? '∞' : n.toLocaleString('en-US');
  }

  private computeTax(annualGross: number, brackets: Bracket[]): { tax: number; slabs: Slab[] } {
    let tax = 0;
    let lower = 0;
    const slabs: Slab[] = [];
    for (const b of brackets) {
      if (annualGross <= lower) break;
      const taxableInSlab = Math.min(annualGross, b.upTo) - lower;
      const slabTax = taxableInSlab * b.rate;
      tax += slabTax;
      slabs.push({ from: lower, to: b.upTo, rate: b.rate, taxable: taxableInSlab, tax: slabTax });
      lower = b.upTo;
    }
    return { tax, slabs };
  }
}
