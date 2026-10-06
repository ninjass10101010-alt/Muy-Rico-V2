import { forwardRef } from "react";
import logoUrl from "../../assets/muy_rico_logo_email.png";
import quicksandUrl from "../../assets/fonts/Quicksand-Regular.ttf";
import cormorantUrl from "../../assets/fonts/CormorantGaramond-Regular.ttf";
import { RECEIPT_DOC_WIDTH_PX } from "../../utils/receiptExport";
import type { ReceiptViewModel } from "../../utils/receiptView";

// Injected while the offscreen document exists so html-to-image can embed the
// brand fonts into the capture (see ReceiptExportHost).
export const RECEIPT_FONT_FACES = `
@font-face { font-family: 'Quicksand'; src: url(${quicksandUrl}) format('truetype'); font-display: block; }
@font-face { font-family: 'Cormorant Garamond'; src: url(${cormorantUrl}) format('truetype'); font-display: block; }
`;

const PALETTE = {
  palm: "#1e4636",
  green: "#2d7a46",
  cocoa: "#4a423d",
  muted: "#8a8078",
  faint: "#b8ada2",
  rule: "#e3dcd2",
  mint: "#d4edda",
};

const money = (cents: number) => "$" + ((Number(cents) || 0) / 100).toFixed(2);

const ReceiptDocument = forwardRef<HTMLDivElement, { viewModel: ReceiptViewModel }>(
  function ReceiptDocument({ viewModel: vm }, ref) {
    const L = vm.labels;
    const orderDate = (vm.createdAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const showDiscount = vm.discountCents > 0;
    const pickup = vm.pickupDate
      ? `${vm.pickupDate}${vm.pickupTime ? " " + vm.pickupTime : ""}`
      : "—";

    return (
      <div
        ref={ref}
        style={{
          width: RECEIPT_DOC_WIDTH_PX,
          background: "#ffffff",
          fontFamily: "'Quicksand', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#333",
          overflow: "hidden",
        }}
      >
        <div style={{ background: PALETTE.palm, padding: "38px 44px 32px", textAlign: "center" }}>
          <img
            src={logoUrl}
            alt="Muy Rico Bakery"
            width={220}
            style={{ width: 220, maxWidth: "62%", height: "auto", display: "block", margin: "0 auto 14px" }}
          />
          <div style={{ color: PALETTE.mint, fontSize: 13, letterSpacing: 4, fontWeight: 600 }}>
            {L.receipt}
          </div>
        </div>

        <div style={{ padding: "38px 44px 12px" }}>
          <h2
            style={{
              margin: "0 0 8px",
              color: PALETTE.green,
              fontSize: 26,
              fontFamily: "'Cormorant Garamond', serif",
              fontWeight: 600,
            }}
          >
            {L.thanks}
          </h2>
          <p style={{ margin: "0 0 26px", color: "#6b615a", fontSize: 15, lineHeight: 1.55 }}>
            {vm.customerName} — {L.paidNote}
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 26 }}>
            <tbody>
              <MetaRow label={L.date} value={orderDate} />
              <MetaRow label={L.payment} value={vm.paymentLabel} />
              <MetaRow label={L.statusLabel} value={vm.statusLabel} />
              <MetaRow label={L.pickup} value={pickup} />
              <MetaRow label={L.order} value={`#${vm.orderId}`} strong />
              {vm.notes ? <MetaRow label={L.notes} value={vm.notes} /> : null}
            </tbody>
          </table>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle("left")}>{L.item}</th>
                <th style={thStyle("center")}>{L.qty}</th>
                <th style={thStyle("right")}>{L.amount}</th>
              </tr>
            </thead>
            <tbody>
              {vm.rawItemsText ? (
                <tr>
                  <td style={{ padding: "12px 0", fontSize: 15, color: PALETTE.cocoa }} colSpan={3}>
                    {vm.rawItemsText}
                  </td>
                </tr>
              ) : (
                vm.items.map((item, i) => (
                  <tr key={i}>
                    <td style={tdStyle("left", false, true)}>{item.name}</td>
                    <td style={tdStyle("center", true)}>
                      {item.qty} × {money(item.price * 100)}
                    </td>
                    <td style={{ ...tdStyle("right"), fontWeight: 600 }}>{money(item.qty * item.price * 100)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              {showDiscount ? (
                <>
                  <tr>
                    <td colSpan={2} style={totalLabelStyle(PALETTE.muted)}>{L.subtotal}</td>
                    <td style={totalValueStyle(PALETTE.muted)}>{money(vm.subtotalCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={totalLabelStyle(PALETTE.green, true)}>{L.discount}</td>
                    <td style={{ ...totalValueStyle(PALETTE.green), fontWeight: 600 }}>
                      −{money(vm.discountCents)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <td colSpan={2} style={{ padding: "18px 0 6px", color: PALETTE.palm, fontSize: 17, fontWeight: 700 }}>
                  {L.total}
                </td>
                <td
                  style={{
                    padding: "18px 0 6px",
                    color: PALETTE.palm,
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "right",
                  }}
                >
                  {money(vm.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ padding: "26px 44px 36px" }}>
          <p style={{ color: PALETTE.muted, fontSize: 14, lineHeight: 1.6, margin: "0 0 8px" }}>{L.contact}</p>
          <p style={{ color: PALETTE.faint, fontSize: 13, margin: "18px 0 0", textAlign: "center" }}>
            {L.footer}
          </p>
        </div>
      </div>
    );
  },
);

function MetaRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td style={{ color: PALETTE.muted, fontSize: 14, padding: "4px 0", verticalAlign: "top" }}>{label}</td>
      <td
        style={{
          color: PALETTE.cocoa,
          fontSize: 14,
          textAlign: "right",
          padding: "4px 0",
          fontWeight: strong ? 600 : 400,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function thStyle(align: "left" | "center" | "right") {
  return {
    textAlign: align,
    color: PALETTE.muted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    paddingBottom: 10,
    borderBottom: `2px solid ${PALETTE.palm}`,
  };
}

function tdStyle(align: "left" | "center" | "right", muted = false, wrap = false) {
  return {
    padding: "12px 0",
    borderBottom: `1px dashed ${PALETTE.rule}`,
    color: muted ? PALETTE.muted : PALETTE.cocoa,
    fontSize: 15,
    textAlign: align,
    whiteSpace: wrap ? ("normal" as const) : ("nowrap" as const),
    ...(wrap
      ? {
          overflowWrap: "anywhere" as const,
          wordBreak: "break-word" as const,
          lineHeight: 1.4,
        }
      : {}),
  };
}

function totalLabelStyle(color: string, bold = false) {
  return { padding: "16px 0 4px", color, fontSize: 14, fontWeight: bold ? 600 : 400 };
}
function totalValueStyle(color: string) {
  return { padding: "16px 0 4px", color, fontSize: 14, textAlign: "right" as const };
}

export default ReceiptDocument;
