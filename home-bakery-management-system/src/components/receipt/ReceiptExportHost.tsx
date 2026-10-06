import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ReceiptDocument, { RECEIPT_FONT_FACES } from "./ReceiptDocument";
import type { ReceiptViewModel } from "../../utils/receiptView";
import {
  captureReceiptNode,
  dataUrlToBlob,
  downloadReceiptFile,
  receiptFileName,
  receiptPdfFromCapture,
  shareReceiptFile,
} from "../../utils/receiptExport";
import { downloadPdf, openPdfInNewTab, printPdf } from "../../utils/labelExport";

export type ReceiptExportAction = "download-png" | "download-pdf" | "share" | "print" | "open";

export interface ReceiptExportTarget {
  viewModel: ReceiptViewModel;
  action: ReceiptExportAction;
  shareFormat?: "png" | "pdf";
  win?: Window | null;
}

interface Props {
  target: ReceiptExportTarget | null;
  onDone: () => void;
  onError: (message: string) => void;
}

export default function ReceiptExportHost({ target, onDone, onError }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!target || !nodeRef.current || runningRef.current) return;
    const vm = target.viewModel;
    runningRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const node = nodeRef.current;
        if (!node) return;
        const capture = await captureReceiptNode(node);
        const pngBlob = dataUrlToBlob(capture.dataUrl);
        const needsPdf = target.action !== "download-png" && !(target.action === "share" && target.shareFormat === "png");
        const pdfBytes = needsPdf ? await receiptPdfFromCapture(capture) : null;
        const pngName = receiptFileName(vm.orderNumber, vm.language, "png");
        const pdfName = receiptFileName(vm.orderNumber, vm.language, "pdf");

        switch (target.action) {
          case "download-png":
            downloadReceiptFile(pngBlob, pngName);
            break;
          case "download-pdf":
            if (pdfBytes) downloadPdf(pdfBytes, pdfName);
            break;
          case "share": {
            const format = target.shareFormat === "png" ? "png" : "pdf";
            const shared =
              format === "png"
                ? await shareReceiptFile(pngBlob, pngName)
                : pdfBytes
                  ? await shareReceiptFile(new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), pdfName)
                  : false;
            if (!shared) {
              if (format === "png") downloadReceiptFile(pngBlob, pngName);
              else if (pdfBytes) downloadPdf(pdfBytes, pdfName);
            }
            break;
          }
          case "print":
            if (pdfBytes) printPdf(pdfBytes);
            break;
          case "open":
            if (pdfBytes) {
              if (target.win) {
                openPdfInNewTab(pdfBytes, target.win);
              } else {
                const win = window.open("", "_blank");
                if (win) openPdfInNewTab(pdfBytes, win);
                else downloadPdf(pdfBytes, pdfName);
              }
            }
            break;
        }
        if (!cancelled) onDone();
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : "Could not build the receipt file.");
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, onDone, onError]);

  if (!target) return null;

  return createPortal(
    <div
      aria-hidden="true"
      style={{ position: "fixed", left: -100000, top: 0, width: 794, pointerEvents: "none" }}
    >
      <style>{RECEIPT_FONT_FACES}</style>
      <ReceiptDocument ref={nodeRef} viewModel={target.viewModel} />
    </div>,
    document.body,
  );
}
