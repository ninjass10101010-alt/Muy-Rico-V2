# Receipt Backfill & File Export — Design Spec

**Date:** 2026-10-06
**Status:** Approved

## Goal

Two capabilities for the Muy Rico dashboard:

1. **Resend receipts for old orders** — orders that never had a receipt generated (or whose only attempts failed) can be found in a selectable list and emailed to the customer, explicitly and safely.
2. **Receipts as real files (PNG/PDF)** — viewing/sharing a receipt from a phone currently shares an admin-only HTML URL that customers cannot open. Receipts must be convertible to PNG and PDF files with native share, download, and print — the same experience as labels.

## Current State (facts this design builds on)

- Receipts are HTML-only. `buildReceiptHtml(order, isEn)` in `orders/workers/receipt-html.js` renders both the email body and the printable page (`GET /api/receipts/:id/html`, admin-only).
- The D1 `receipts` table is a per-attempt send log: `status` is `sent` | `failed` | `printed`, one row per attempt. There is no flag on `orders`.
- `sendCustomerConfirmation(env, order)` (`orders/workers/api.js:1229`) + `logReceipt`/`logReceiptWithId` (`api.js:1305-1342`) + `order_events` is the proven send path. `POST /api/orders/:id/generate-receipt` already exists for a single order.
- The label export pipeline is 100% client-side: `pdf-lib` for PDF, canvas capture for PNG, and share/download/print helpers in `src/utils/labelExport.ts` (`downloadPdf`, `printPdf`, `openPdfInNewTab`, `sharePdf`). `html-to-image@1.11.13` is already a dependency but currently unused.
- The admin SPA (`home-bakery-management-system/`) is a single-file PWA built to `admin/index.html`. There is no server-side rendering service and no R2 receipt storage.

## Non-Goals

- Emailing the PDF as an attachment (future option; email HTML stays as-is).
- Public/tokenized receipt URLs (files replace link sharing).
- Vector text PDF export (a future upgrade path; this spec uses exact raster capture so PNG and PDF cannot visually diverge).
- Changes to the label export code paths.
- Reworking the Orders detail modal receipt history.

---

## Feature 1 — Missing Receipts Backfill

### Backend endpoints (`orders/workers/api.js`)

Both admin-only (inside the authenticated block; NOT in the public allowlist).

#### `GET /api/orders/missing-receipts`

Query params:

| Param | Default | Notes |
|---|---|---|
| `search` | — | LIKE on `customer_name`, `email`, or `('MR-' \|\| id)` |
| `limit` | 200 | capped at 500 |

Eligibility:

```sql
WHERE TRIM(COALESCE(o.email, '')) != ''
  AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.order_id = o.id AND r.status = 'sent')
ORDER BY o.created_at DESC, o.id DESC
```

"No successful receipt" (not "no row at all") so orders whose only attempts were `failed` or `printed` are included. Deleted orders are absent by FK cascade; abandoned `awaiting_payment` orders are cleaned by the hourly cron.

Response:

```json
{
  "orders": [{
    "id": 123,
    "customer_name": "Ana",
    "email": "ana@example.com",
    "phone": "+1...",
    "created_at": "2026-01-02 10:00:00",
    "pickup_date": "2026-01-05",
    "payment_status": "paid",
    "status": "completed",
    "total_cents": 4500,
    "language": "es",
    "receipt_attempts": 1,
    "last_receipt_status": "failed",
    "last_receipt_at": "2026-01-02 10:01:00"
  }]
}
```

#### `POST /api/orders/send-receipts`

Body:

```json
{ "ids": [123, 124], "language": "auto" }
```

- Validation: non-empty integer array, max **25 ids** per request, `language ∈ {auto, en, es}` (default `auto`). Invalid → 400 with `{ error }`.
- Per id, sequentially:
  1. Load the order (`SELECT * FROM orders WHERE id = ?`). Missing order → `{ id, ok: false, status: 'skipped', reason: 'not_found' }`.
  2. No `email` → `{ id, ok: false, status: 'skipped', reason: 'no_email' }`.
  3. Apply the language override on a copy (`auto` keeps `order.language`).
  4. `sendCustomerConfirmation(env, orderForSend)` → `{ ok, messageId }`.
  5. `receiptId = rcpt_<id>_<base36 timestamp>` then `logReceiptWithId(env, orderForSend, result, id, receiptId)`.
  6. Insert `order_events` row `receipt:generated`.
  7. Collect `{ id, ok, status: 'sent' | 'failed', messageId, error? }`.
- Spacing: `await new Promise(r => setTimeout(r, 600))` between sends (skip after the last) to respect Resend's rate limit.
- Response:

```json
{
  "results": [{ "id": 123, "ok": true, "status": "sent", "messageId": "..." }],
  "sent": 1, "failed": 0, "skipped": 0
}
```

Partial failures are expected and returned per-order. Failed orders remain in the missing list (no `sent` receipt) so retry is natural.

### Client

- `src/types.ts`: add

```ts
export interface MissingReceiptOrder {
  id: number; customerName: string; email: string | null; phone: string | null;
  createdAt: string; pickupDate: string; paymentStatus: "paid" | "partial" | "unpaid";
  status: string; totalCents: number; language: string;
  receiptAttempts: number; lastReceiptStatus: string | null; lastReceiptAt: string | null;
}
```

- `src/utils/api.ts`: `fetchMissingReceipts(search?: string): Promise<MissingReceiptOrder[]>` and `sendMissingReceiptsApi(ids: number[], language: "auto" | "en" | "es"): Promise<SendReceiptsResult>` (result type per the JSON above). Existing `apiFetch`/mapper conventions.
- `src/context/StoreContext.tsx`: `missingReceipts` state + `refreshMissingReceipts()` + `sendMissingReceipts(ids, language)` which refreshes both `missingReceipts` and `receipts` after sending.

### UI (`src/pages/Receipts.tsx`)

- Two tabs: **History** (existing list) and **Missing receipts (N)** (count badge from `missingReceipts.length`).
- Missing tab:
  - Search box (customer / email / order number).
  - Select-all header checkbox; per-row checkbox.
  - Row content: customer, email, `MR-<id>`, created date, pickup date, total, payment-status badge, language badge, last-attempt badge (`Never sent` / `Failed` / `Print only`).
  - Language selector for the batch: `Auto (order language)` / `English` / `Español`.
  - **Send selected (n)** button — disabled when nothing selected; sends in chunks of 10 with progress text (`Sending 4 of 12…`), then shows a summary (sent / failed / skipped, with failed names) and refreshes both tabs.
  - Row-level **Send** shortcut (same flow for one order).
  - Empty state: "Every order with an email has a receipt." Loading and error states per existing page conventions.
- No email is ever sent without an explicit user action.

---

## Feature 2 — Receipt PNG/PDF Files

### Approach: one DOM source of truth

A React `ReceiptDocument` renders the branded receipt exactly once. The PNG is a high-DPI capture of that node; the PDF embeds that same PNG. PNG and PDF therefore cannot visually diverge, and the design matches the email receipt (approved direction: "match brand, print-polished").

Rejected alternatives: separate vector PDF via `pdf-lib` (two renderers that drift); server-side PDF in the Worker (still two renderers, more moving parts); Cloudflare Browser Rendering (new infra/cost, requires public tokenized URLs).

### Components / modules

#### `src/components/receipt/ReceiptDocument.tsx`

- Props: `{ viewModel: ReceiptViewModel }`.
- Fixed width `RECEIPT_DOC_WIDTH_PX = 794` (A4 @ 96 dpi), white background, standalone (no app chrome).
- Layout mirrors `buildReceiptHtml`: brand logo, title (`RECEIPT`/`RECIBO` when paid, `INVOICE`/`FACTURA` when unpaid/partial), receipt/order number, date, customer, pickup date/time, payment method label (card brand + last4 gating per `buildMethodLabel`), status label, item table (qty, name, price; `name_en`/`name_es` preference by lang), subtotal/discount/total, notes, thank-you footer.
- Uses the app's brand fonts (already loaded). Logo: prefer a locally imported asset so capture never depends on the network; fall back to the public logo URL.
- Natural height — never fixed — so long receipts grow and paginate in the PDF.

#### `src/utils/receiptView.ts`

- `buildReceiptViewModel(receipt: ApiReceipt, order: ApiOrder | null, lang: "en" | "es"): ReceiptViewModel`.
- Precedence mirrors `getReceiptHtml`: live order fields when available, receipt snapshot fallback (order deleted).
- Handles: paid → Receipt/Recibo vs unpaid/partial → Invoice/Factura wording (mirrors `emailMeta`), item name language, subtotal/discount fallback (`total_cents` when `subtotal_cents` absent), currency formatting, method/status labels.
- Pure and unit-testable.

#### `src/utils/receiptExport.ts`

```ts
export type ReceiptFileFormat = "png" | "pdf";
export interface ReceiptCapture { dataUrl: string; widthPx: number; heightPx: number; }
export const RECEIPT_DOC_WIDTH_PX = 794;

export async function captureReceiptNode(node: HTMLElement, opts?: {
  scale?: number;          // default 3
  skipFonts?: boolean;     // retry path
}): Promise<ReceiptCapture>;

export function computeReceiptPages(widthPx: number, heightPx: number): {
  pageCount: number; scale: number; pageHeightPx: number;
};

export async function receiptPdfFromCapture(capture: ReceiptCapture): Promise<Uint8Array>;
export function dataUrlToBlob(dataUrl: string): Blob;
export function receiptFileName(orderNumber: string, lang: string, ext: "png" | "pdf"): string;

export function downloadReceiptFile(blob: Blob, filename: string): void;
export async function shareReceiptFile(blob: Blob, filename: string): Promise<boolean>;
```

- `captureReceiptNode`: awaits `document.fonts.ready` and all `<img>` in the node, then `toPng(node, { pixelRatio: scale, backgroundColor: "#ffffff" })`. If font embedding throws or fails, retry once with `skipFonts: true` (legacy `LabelDesigner` pattern).
- `receiptPdfFromCapture`: A4 pages (595.28 × 841.89 pt), 24 pt content margins. PNG embedded **once**; tall receipts are sliced vertically across pages by drawing the same image at successive negative Y offsets (page bounds crop each slice). Scale = content width in px / content width in pt.
- PDF helpers are imported from `src/utils/labelExport.ts` at the UI layer: `printPdf`, `openPdfInNewTab`, `downloadPdf` (PDF only). `labelExport.ts` is not modified.
- `shareReceiptFile`: `navigator.canShare({ files })` + `navigator.share({ files: [file] })`; `AbortError` = user cancelled → treated as handled; unsupported/failed → `false` so the caller downloads instead.
- Filenames: `muy-rico-receipt-MR-<orderId>-<lang>.pdf` / `.png`.

#### `src/components/receipt/ReceiptExportHost.tsx`

- Controlled by `Receipts.tsx`: props `{ target: ReceiptExportTarget | null, onDone, onError }`.
- Renders the offscreen document in a portal (`position: fixed; left: -100000px; top: 0`), width 794 px.
- On `target` change: wait two animation frames + `document.fonts.ready`, capture, build the requested file(s), run the action, then `onDone()`. Errors → `onError(message)`.
- Actions: `download-png`, `download-pdf`, `share` (PNG or PDF per target format; default PDF), `print` (PDF), `open` (PDF, for mobile).
- One export at a time; the page shows a per-row spinner.

### UI (`src/pages/Receipts.tsx`)

- Mobile cards and desktop table rows replace the HTML actions with:
  - **PDF** — download the PDF.
  - **PNG** — download the PNG.
  - **Share** — native share sheet with the actual file (PDF; falls back to download on unsupported browsers). This replaces the broken URL-share.
  - **Print** — desktop: hidden-iframe print of the PDF (`printPdf`); mobile (`max-width: 1023px`): pre-opened window + `openPdfInNewTab` (iOS PDF viewer with its own share/print), mirroring the label export behavior exactly.
  - **EN/ES** — becomes a per-row language toggle that selects the language used by the file actions (default: receipt language, then order language, default `es`). It no longer opens printable HTML.
- Busy spinner per row while a file is being produced; errors surface as toasts; share-cancel is silent.
- `downloadReceiptHtml` / `shareReceipt` URL behavior is removed from the Receipts page.

## Data Flow

### Backfill

```
Receipts page → Missing receipts tab
  → fetchMissingReceipts()
  → select ids + language → chunk of ≤10
  → POST /api/orders/send-receipts { ids, language }
    → per order: sendCustomerConfirmation → logReceiptWithId → order_events receipt:generated
  → progress → summary → refreshMissingReceipts() + refreshReceipts()
```

### File export

```
Receipts page action (PDF | PNG | Share | Print)
  → set export target { receipt, order, lang, action }
  → ReceiptExportHost mounts ReceiptDocument offscreen
  → captureReceiptNode (fonts + images ready, toPng @3x)
  → PNG: dataUrlToBlob
  → PDF: receiptPdfFromCapture (pdf-lib, A4, multi-page)
  → shareReceiptFile | downloadReceiptFile | printPdf | openPdfInNewTab
  → onDone() clears target, spinner stops
```

## Error Handling

- Capture failure → retry once with `skipFonts`; still failing → toast, nothing downloaded.
- Share cancelled (`AbortError`) → no toast.
- Share unsupported → download fallback.
- Print popup blocked → download fallback.
- `send-receipts` partial failure → per-order results; failed orders stay in the missing list for retry.
- Missing `RESEND_API_KEY` or missing email → `failed`/`skipped` surfaced in the summary; never silent success.

## Testing

- `orders/tests/missing-receipts.test.js`: eligibility query behavior, validation (empty/too many/out-of-range ids, bad language), language override, no-email skip, per-order results, `order_events` written. Follow the `makeEnv` D1 stub pattern used in `orders/tests/mark-paid.test.js`.
- `src/utils/receiptView.test.ts`: order-over-snapshot precedence, name language selection, paid vs invoice wording, discount/total fallback, currency.
- `src/utils/receiptExport.test.ts`: `computeReceiptPages` math (single page, multi-page, exact boundaries), filename builder, `dataUrlToBlob`, `receiptPdfFromCapture` with a tiny zlib-built PNG fixture (pattern from `labelRasterPdf.test.ts`): `%PDF-` signature, A4 page size, image embedded once per page slice.
- Playwright functional + visual verification (see below).

## Triple-A Visual Rubric (critic checklist)

- Brand fonts actually rendered (not fallback) in PNG and PDF.
- Logo crisp, correctly sized, undistorted.
- Consistent margins (≥24 px), aligned table columns, no clipped or overlapping text.
- Currency and EN/ES strings correct; item names respect language.
- Mobile viewport (~390 px) and desktop (1280 px) both clean.
- Long receipt (12+ items) produces a readable multi-page PDF with no clipping.
- PNG text readable when zoomed (≥2× effective sharpness).
- Filenames sensible; share sheet delivers an actual file, not a URL.

## Verification Plan

1. Unit tests above, plus existing suites (`orders` vitest, admin vitest) stay green.
2. Build the admin bundle; run the app locally with Playwright at mobile + desktop viewports.
3. Backfill sends are verified with an internal test address only — never real customers.
4. Each feature gets a dedicated harsh-critic subagent that produces actual PNG/PDF files, inspects them as images, scores against the rubric, and loops the implementer until triple A.

## Rollout

1. Deploy the orders Worker (new endpoints) — additive, no migration.
2. Deploy the admin bundle.
3. No schema changes.

## Files

| File | Action | Responsibility |
|---|---|---|
| `orders/workers/api.js` | Modify | `GET /api/orders/missing-receipts`, `POST /api/orders/send-receipts`, route dispatch |
| `orders/tests/missing-receipts.test.js` | Create | Endpoint unit tests |
| `home-bakery-management-system/src/types.ts` | Modify | `MissingReceiptOrder`, send result types |
| `home-bakery-management-system/src/utils/api.ts` | Modify | `fetchMissingReceipts`, `sendMissingReceiptsApi` |
| `home-bakery-management-system/src/context/StoreContext.tsx` | Modify | Missing-receipts state + send handler |
| `home-bakery-management-system/src/utils/receiptView.ts` | Create | `buildReceiptViewModel` (pure) |
| `home-bakery-management-system/src/utils/receiptView.test.ts` | Create | View-model unit tests |
| `home-bakery-management-system/src/components/receipt/ReceiptDocument.tsx` | Create | Branded receipt DOM (794 px) |
| `home-bakery-management-system/src/utils/receiptExport.ts` | Create | Capture → PNG/PDF, filenames, share/download helpers |
| `home-bakery-management-system/src/utils/receiptExport.test.ts` | Create | Export unit tests |
| `home-bakery-management-system/src/components/receipt/ReceiptExportHost.tsx` | Create | Offscreen render host + action runner |
| `home-bakery-management-system/src/pages/Receipts.tsx` | Modify | Tabs, missing list, file actions, pass-through to `Orders.tsx` if needed |
| `docs/superpowers/plans/2026-10-06-receipt-backfill-and-file-export.md` | Create | Implementation plan |
