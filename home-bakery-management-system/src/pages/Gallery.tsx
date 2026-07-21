import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import {
  createGalleryPhoto,
  deleteGalleryPhoto,
  fetchGalleryAdmin,
  updateGalleryPhoto,
  uploadImage,
  type ApiGalleryPhoto,
} from "../utils/api";

type Draft = {
  product_id: string;
  title: string;
  title_es: string;
  image_url: string;
};

const emptyDraft = (defaultProductId = ""): Draft => ({
  product_id: defaultProductId,
  title: "",
  title_es: "",
  image_url: "",
});

export default function Gallery() {
  const { products } = useStore();
  const activeProducts = useMemo(
    () => products.filter((p) => p.active !== false),
    [products]
  );
  const [photos, setPhotos] = useState<ApiGalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchGalleryAdmin();
      setPhotos(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const map = new Map<string, ApiGalleryPhoto[]>();
    for (const ph of photos) {
      const key = ph.product_id || "_unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ph);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id));
    }
    const productOrder = new Map(
      activeProducts.map((p, i) => [p.id, p.display_order ?? i])
    );
    return [...map.entries()].sort((a, b) => {
      const ao = productOrder.get(a[0]) ?? 9999;
      const bo = productOrder.get(b[0]) ?? 9999;
      if (ao !== bo) return ao - bo;
      return a[0].localeCompare(b[0]);
    });
  }, [photos, activeProducts]);

  function openNew() {
    setDraft(emptyDraft(activeProducts[0]?.id || ""));
    setModalOpen(true);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      setDraft((d) => ({ ...d, image_url: url }));
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft.product_id || !draft.title.trim() || !draft.image_url) {
      setError("Product, title, and image are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const siblings = photos.filter((p) => p.product_id === draft.product_id);
      const nextOrder =
        siblings.length === 0
          ? 0
          : Math.max(...siblings.map((s) => s.display_order || 0)) + 1;
      await createGalleryPhoto({
        product_id: draft.product_id,
        title: draft.title.trim(),
        title_es: draft.title_es.trim() || null,
        image_url: draft.image_url,
        display_order: nextOrder,
        active: true,
      });
      setModalOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(ph: ApiGalleryPhoto) {
    try {
      await updateGalleryPhoto(ph.id, { active: !ph.active });
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to update photo");
    }
  }

  async function remove(ph: ApiGalleryPhoto) {
    if (!confirm(`Delete “${ph.title}”?`)) return;
    try {
      await deleteGalleryPhoto(ph.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to delete photo");
    }
  }

  async function move(ph: ApiGalleryPhoto, dir: -1 | 1) {
    const siblings = photos
      .filter((p) => p.product_id === ph.product_id)
      .sort((a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id));
    const idx = siblings.findIndex((s) => s.id === ph.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    try {
      await Promise.all([
        updateGalleryPhoto(ph.id, { display_order: swap.display_order }),
        updateGalleryPhoto(swap.id, { display_order: ph.display_order }),
      ]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to reorder photo");
    }
  }

  function productLabel(productId: string, sample?: ApiGalleryPhoto) {
    const p = activeProducts.find((x) => x.id === productId);
    if (p) return `${p.emoji || ""} ${p.name}`.trim();
    if (sample?.product_name) return `${sample.product_emoji || ""} ${sample.product_name}`.trim();
    return productId;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-cocoa">Gallery</h1>
          <p className="text-sm text-cocoa/60">
            Portfolio photos grouped by product. Customers request a design from the public gallery page.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
        >
          <Plus size={16} /> Add photo
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cocoa/50">Loading gallery…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cocoa/20 bg-white p-10 text-center text-sm text-cocoa/60">
          No gallery photos yet. Add your first portfolio shot.
        </div>
      ) : (
        groups.map(([productId, list]) => (
          <section key={productId} className="space-y-3">
            <h2 className="font-serif text-lg text-cocoa">
              {productLabel(productId, list[0])}
              <span className="ml-2 text-sm font-sans font-normal text-cocoa/40">
                ({list.length})
              </span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((ph, i) => (
                <article
                  key={ph.id}
                  className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                    ph.active ? "border-cocoa/10" : "border-cocoa/5 opacity-70"
                  }`}
                >
                  <div className="aspect-square overflow-hidden bg-sand-100">
                    <img
                      src={ph.image_url}
                      alt={ph.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="truncate font-medium text-cocoa">{ph.title}</p>
                    {ph.title_es && (
                      <p className="truncate text-xs text-cocoa/50">{ph.title_es}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => move(ph, -1)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={i === list.length - 1}
                        onClick={() => move(ph, 1)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        title={ph.active ? "Hide" : "Show"}
                        onClick={() => toggleActive(ph)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                      >
                        {ph.active ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => remove(ph)}
                        className="ml-auto rounded-lg p-1.5 text-red-600/80 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add gallery photo">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Product album</span>
            <select
              className="w-full rounded-xl border border-cocoa/15 bg-white px-3 py-2"
              value={draft.product_id}
              onChange={(e) => setDraft({ ...draft, product_id: e.target.value })}
            >
              <option value="">Select product…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Title (English)</span>
            <input
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Title (Spanish)</span>
            <input
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.title_es}
              onChange={(e) => setDraft({ ...draft, title_es: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
          </label>
          {uploading && <p className="text-xs text-cocoa/50">Uploading…</p>}
          {draft.image_url && (
            <img
              src={draft.image_url}
              alt="Preview"
              className="h-40 w-full rounded-xl object-cover"
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-full px-4 py-2 text-sm text-cocoa/70 hover:bg-sand-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || uploading}
              onClick={save}
              className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save photo"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
