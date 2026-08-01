import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import MergeModal from "../components/MergeModal";
import { formatCurrency, formatDate, newId } from "../utils/format";
import { apiGetDuplicateCustomers } from "../utils/api";
import type { Customer } from "../types";
import type { DuplicatePair } from "../utils/api";

const emptyCustomer = (): Customer => ({
  id: "",
  name: "",
  phone: "",
  email: "",
  notes: "",
  createdAt: new Date().toISOString(),
});

export default function Customers({ search }: { search: string }) {
  const { customers, handleCreateCustomer, handleUpdateCustomer, handleDeleteCustomer, handleMergeCustomers, orders } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Customer>(emptyCustomer());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [duplicateError, setDuplicateError] = useState<{ existingId: string; existingName: string } | null>(null);

  useEffect(() => {
    apiGetDuplicateCustomers().then(setDuplicates).catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    orders.forEach((o) => {
      if (!o.customerId) return;
      if (!map[o.customerId]) map[o.customerId] = { count: 0, total: 0 };
      map[o.customerId].count += 1;
      map[o.customerId].total += o.total;
    });
    return map;
  }, [orders]);

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  function openNew() {
    setDraft(emptyCustomer());
    setEditingId(null);
    setErrorMsg("");
    setModalOpen(true);
  }

  function openEdit(c: Customer) {
    setDraft(c);
    setEditingId(c.id);
    setErrorMsg("");
    setModalOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setErrorMsg("");
    setDuplicateError(null);
    try {
      if (editingId) {
        await handleUpdateCustomer(editingId, {
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
      } else {
        const result = await handleCreateCustomer({
          id: newId("cust"),
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
        // Check if the API returned a duplicate block
        if (result && (result as any).duplicate) {
          setDuplicateError({
            existingId: (result as any).existingId,
            existingName: (result as any).existingName,
          });
          return; // Don't close modal
        }
      }
      setModalOpen(false);
      setDuplicateError(null);
    } catch (err: any) {
      console.error("Failed to save customer:", err);
      setErrorMsg(err.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function remove(id: string) {
    handleDeleteCustomer(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl bg-palm px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md"
        >
          <Plus size={16} /> Add Customer
        </button>
      </div>

      {duplicates.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} />
          <span className="font-medium">{duplicates.length} possible duplicate customer{duplicates.length !== 1 ? "s" : ""} to review</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => {
          const s = stats[c.id] || { count: 0, total: 0 };
          return (
            <div key={c.id} className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <button className="text-left" onClick={() => setViewing(c)}>
                  <p className="font-semibold text-cocoa hover:underline">{c.name}</p>
                  {duplicates.some(
                    (d) => d.survivingCandidate.id === c.id || d.mergedCandidate.id === c.id
                  ) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const pair = duplicates.find(
                          (d) => d.survivingCandidate.id === c.id || d.mergedCandidate.id === c.id
                        );
                        if (pair) {
                          setMergePair(pair);
                          setMergeModalOpen(true);
                        }
                      }}
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <AlertTriangle size={10} /> Possible duplicate
                    </button>
                  )}
                  <p className="text-xs text-cocoa-muted">Customer since {formatDate(c.createdAt)}</p>
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs text-cocoa-muted">
                {c.phone && (
                  <p className="flex items-center gap-1.5">
                    <Phone size={12} /> {c.phone}
                  </p>
                )}
                {c.email && (
                  <p className="flex items-center gap-1.5">
                    <Mail size={12} /> {c.email}
                  </p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-sand-50 px-3 py-2 text-sm">
                <span className="text-cocoa-muted">{s.count} orders</span>
                <span className="font-semibold text-cocoa">{formatCurrency(s.total)}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => openEdit(c)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sand-200 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
                >
                  <Pencil size={13} /> Edit
                </button>
                <button onClick={() => remove(c.id)} className="rounded-lg border border-sand-200 p-1.5 text-hibiscus hover:bg-hibiscus-light/10">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="col-span-full py-10 text-center text-cocoa-muted">No customers yet.</p>}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Customer" : "Add Customer"}>
        <div className="space-y-3">
          <Field label="Name">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" />
          </Field>
          <Field label="Phone">
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="input" />
          </Field>
          <Field label="Email">
            <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="input" />
          </Field>
          <Field label="Notes">
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={3}
              className="input"
            />
          </Field>
          {errorMsg && (
            <p className="rounded-lg bg-hibiscus-light/10 px-3 py-2 text-xs text-hibiscus">{errorMsg}</p>
          )}
          {duplicateError && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              <p className="font-medium">{duplicateError.existingName} already uses this email.</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setDuplicateError(null);
                    setModalOpen(false);
                  }}
                  className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
                >
                  Use existing
                </button>
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await handleCreateCustomer({
                        id: newId("cust"),
                        name: draft.name,
                        phone: draft.phone,
                        email: draft.email,
                        notes: draft.notes,
                        force: true,
                      } as any);
                      setModalOpen(false);
                      setDuplicateError(null);
                    } catch (err: any) {
                      setErrorMsg(err.message || "Failed");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Create anyway
                </button>
              </div>
            </div>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Save Changes" : "Add Customer"}
          </button>
        </div>
      </Modal>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name || ""}>
        {viewing && (
          <div className="space-y-3">
            {viewing.notes && <p className="rounded-lg bg-coral-light/20 p-3 text-sm text-cocoa">{viewing.notes}</p>}
            <p className="text-xs font-medium text-cocoa-muted">Order history</p>
            <div className="divide-y divide-sand-100 rounded-xl border border-sand-100">
              {orders
                .filter((o) => o.customerId === viewing.id)
                .map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {o.orderNumber} · {formatDate(o.createdAt)}
                    </span>
                    <span className="font-medium">{formatCurrency(o.total)}</span>
                  </div>
                ))}
              {orders.filter((o) => o.customerId === viewing.id).length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-cocoa-muted">No orders yet.</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      <MergeModal
        open={mergeModalOpen}
        onClose={() => {
          setMergeModalOpen(false);
          setMergePair(null);
        }}
        pair={mergePair}
        stats={stats}
        onMerge={async (survivingId, mergedId) => {
          await handleMergeCustomers(survivingId, mergedId);
          apiGetDuplicateCustomers().then(setDuplicates).catch(() => {});
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</label>
      {children}
    </div>
  );
}
