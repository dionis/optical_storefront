/**
 * Standalone report page for the last multimodal measurement run.
 *
 * The try-on panel is a narrow column beside a live camera: fine for driving the run,
 * cramped for reading a clinical report and useless for printing one. This page renders
 * the same run full width, from `localStorage`, so it can be opened in a second tab,
 * left open while the fitting continues, printed, or handed over as a PDF.
 *
 * It holds no state of its own and never calls the measurement API. Whatever the try-on
 * last stored is what it shows — including a run whose originating tab is long gone.
 */

import { t, setLang, getLang, applyTranslations, onLangChange, Lang } from './i18n';
import { StoredRun, loadRun } from './vision_report_store';
import {
  attachRawToggles,
  renderContextHtml,
  renderOpticianCardHtml,
  renderResultsHtml,
  renderTryOnHtml,
} from './vision_report_view';

const SAVE_IMAGE_BTN = 'btn-report-save-image';

class ReportPage {
  private run: StoredRun | null = null;

  private metaBox = document.getElementById('report-meta')!;
  private tryOnBox = document.getElementById('report-tryon')!;
  private resultsBox = document.getElementById('report-results')!;
  private contextBox = document.getElementById('report-context')!;
  private cardBox = document.getElementById('report-card')!;

  constructor() {
    this.setupLanguageSwitch();
    this.setupViewSwitch();

    document.getElementById('btn-report-refresh')?.addEventListener('click', () => this.render());
    document.getElementById('btn-report-print')?.addEventListener('click', () => window.print());
    document.getElementById('btn-report-json')?.addEventListener('click', () => this.downloadJson());

    // A run finishing in the try-on tab updates localStorage; this fires here. So a
    // report left open on a second screen fills in by itself when the analysis lands.
    window.addEventListener('storage', (event) => {
      if (event.key === 'rubilens.lastVisionRun') this.render();
    });

    // Coming back to the tab is the other moment a new run may have arrived
    window.addEventListener('focus', () => this.render());

    this.render();
  }

  private setupLanguageSwitch(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lang-btn'));
    const paint = () => {
      const active = getLang();
      buttons.forEach((b) => b.classList.toggle('active', b.dataset.lang === active));
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.dataset.lang as Lang));
    });

    // Every label here is built from JavaScript, so a switch has to redraw the report
    onLangChange(() => {
      paint();
      this.render();
    });

    document.documentElement.lang = getLang();
    applyTranslations();
    paint();
  }

  private render(): void {
    this.run = loadRun();

    if (!this.run) {
      this.metaBox.className = 'report-meta report-empty';
      this.metaBox.textContent = t('report.empty');
      this.tryOnBox.innerHTML = '';
      this.resultsBox.innerHTML = '';
      this.contextBox.innerHTML = '';
      this.cardBox.innerHTML = '';
      return;
    }

    const { engine, finishedAt, results, tryOn } = this.run;
    const profile = this.run.tryOnProfile ?? null;
    const when = new Date(finishedAt);
    const ok = results.filter((r) => r.ok).length;

    this.metaBox.className = 'report-meta';
    this.metaBox.innerHTML = [
      this.metaItem(t('report.when'), when.toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-GB')),
      this.metaItem(t('ai.provider'), `${engine.provider} · ${engine.model}`),
      this.metaItem(t('ai.strategy'), engine.strategy),
      this.metaItem(t('ai.imageEngine'), engine.imageEngine),
      ...(results[0]?.measurements?.capri?.frameId
        ? [this.metaItem(t('ai.frameIdLabel'), String(results[0].measurements.capri.frameId))]
        : []),
      this.metaItem(t('report.results'), `${ok}/${results.length}`),
      this.metaItem(
        t('report.scale'),
        this.run.context ? t('report.scaleTracked') : t('report.scaleNone')
      ),
    ].join('');

    // A note the optician added changed what the model was told, so it is part of the
    // record — not a setting to be forgotten once the answer is on screen.
    if (engine.extraInstructions) {
      this.metaBox.innerHTML +=
        `<div class="report-meta-item report-meta-wide"><span>${t('ai.extraLabel')}</span>` +
        `<strong>${engine.extraInstructions.replace(/</g, '&lt;')}</strong></div>`;
    }

    this.tryOnBox.innerHTML = renderTryOnHtml(tryOn, SAVE_IMAGE_BTN, profile);
    document
      .getElementById(SAVE_IMAGE_BTN)
      ?.addEventListener('click', () => this.saveImage());

    // verbose: this page is the printable record, so the provenance note behind
    // every confidence badge is written out instead of hidden in a tooltip.
    this.resultsBox.innerHTML = renderResultsHtml(results, {
      verbose: true,
      frameId: this.run.engine.frameId,
    });
    this.contextBox.innerHTML = renderContextHtml(this.run.context);
    this.cardBox.innerHTML = renderOpticianCardHtml(this.run);
    attachRawToggles(this.resultsBox);
  }

  /**
   * Switches between the two presentations.
   *
   * Both are rendered; only one is shown. Re-rendering on every switch would be wasted
   * work for a page whose data never changes between switches, and would lose the
   * scroll position the optician was reading from.
   */
  private setupViewSwitch(): void {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.report-view-btn')
    );

    // `data-report-view` on <body> is the state; the CSS reads it directly.
    const apply = (view: 'detail' | 'card') => {
      document.body.dataset.reportView = view;
      buttons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      try {
        localStorage.setItem('rubilens.reportView', view);
      } catch {
        /* private browsing: the choice simply does not outlive the tab */
      }
    };

    buttons.forEach((btn) =>
      btn.addEventListener('click', () => apply((btn.dataset.view as 'detail' | 'card') || 'detail'))
    );

    let stored: string | null = null;
    try {
      stored = localStorage.getItem('rubilens.reportView');
    } catch {
      stored = null;
    }
    apply(stored === 'card' ? 'card' : 'detail');
  }

  private metaItem(label: string, value: string): string {
    return `<div class="report-meta-item"><span>${label}</span><strong>${value}</strong></div>`;
  }

  private saveImage(): void {
    const url = this.run?.tryOn?.imageDataUrl;
    if (!url) return;
    this.download(url, `tryon_${this.run?.tryOn?.method ?? 'image'}_${Date.now()}.jpg`);
  }

  private downloadJson(): void {
    if (!this.run) return;
    const blob = new Blob([JSON.stringify(this.run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    this.download(url, `ai_measurement_${Date.now()}.json`);
    URL.revokeObjectURL(url);
  }

  private download(href: string, filename: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

window.addEventListener('DOMContentLoaded', () => new ReportPage());
