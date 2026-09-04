import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import Modal from "../components/ui/Modal";
import {
  createSlideshowSlide,
  deleteSlideshowSlide,
  fetchSlideshowAdmin,
  updateSlideshowSlide,
  uploadImage,
  type ApiSlideshowSlide,
} from "../utils/api";

type Draft = {
  title: string;
  title_es: string;
  description: string;
  description_es: string;
  image_url: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  title_es: "",
  description: "",
  description_es: "",
  image_url: "",
});

export default function Slideshow() {
  const [slides, setSlides] = useState<ApiSlideshowSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchSlideshowAdmin();
      setSlides(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load slideshow");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ordered = sortSlides(slides);

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
  }

  function openEdit(s: ApiSlideshowSlide) {
    setEditingId(s.id);
    setDraft({
      title: s.title,
      title_es: s.title_es || "",
      description: s.description || "",
      description_es: s.description_es || "",
      image_url: s.image_url,
    });
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
    if (!draft.title.trim() || !draft.image_url) {
      setError("Title and image are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateSlideshowSlide(editingId, {
          title: draft.title.trim(),
          title_es: draft.title_es.trim() || null,
          description: draft.description.trim() || null,
          description_es: draft.description_es.trim() || null,
          image_url: draft.image_url,
        });
      } else {
        const nextOrder =
          slides.length === 0
            ? 0
            : Math.max(...slides.map((s) => s.display_order || 0)) + 1;
        await createSlideshowSlide({
          title: draft.title.trim(),
          title_es: draft.title_es.trim() || null,
          description: draft.description.trim() || null,
          description_es: draft.description_es.trim() || null,
          image_url: draft.image_url,
          display_order: nextOrder,
          active: true,
        });
      }
      setModalOpen(false);
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: ApiSlideshowSlide) {
    try {
      await updateSlideshowSlide(s.id, { active: !s.active });
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to update slide");
    }
  }

  async function remove(s: ApiSlideshowSlide) {
    if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    try {
      await deleteSlideshowSlide(s.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to delete slide");
    }
  }

  async function move(s: ApiSlideshowSlide, dir: -1 | 1) {
    const idx = ordered.findIndex((x) => x.id === s.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    try {
      await Promise.all([
        updateSlideshowSlide(s.id, { display_order: swap.display_order }),
        updateSlideshowSlide(swap.id, { display_order: s.display_order }),
      ]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to reorder slide");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-cocoa">Slideshow</h1>
          <p className="text-sm text-cocoa/60">
            Photos for the homepage carousel. Landscape shots around 3:2 look best. First 8 active slides are shown.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
        >
          <Plus size={16} /> Add slide
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cocoa/50">Loading slideshow…</p>
      ) : ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cocoa/20 bg-white p-10 text-center text-sm text-cocoa/60">
          No slides yet. The homepage band shows a static photo until you add one.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((s, i) => (
            <article
              key={s.id}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                s.active ? "border-cocoa/10" : "border-cocoa/5 opacity-70"
              }`}
            >
              <div className="aspect-[3/2] overflow-hidden bg-sand-100">
                <img
                  src={s.image_url}
                  alt={s.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate font-medium text-cocoa">{s.title}</p>
                {s.title_es && (
                  <p className="truncate text-xs text-cocoa/50">{s.title_es}</p>
                )}
                {s.description && (
                  <p className="line-clamp-2 text-xs text-cocoa/60">{s.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => openEdit(s)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => move(s, -1)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={i === ordered.length - 1}
                    onClick={() => move(s, 1)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    title={s.active ? "Hide" : "Show"}
                    onClick={() => toggleActive(s)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                  >
                    {s.active ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => remove(s)}
                    className="ml-auto rounded-lg p-1.5 text-red-600/80 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditingId(null); }} title={editingId ? "Edit slide" : "Add slide"}>
        <div className="space-y-4">
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
            <span className="mb-1 block text-cocoa/70">Description (English)</span>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Description (Spanish)</span>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.description_es}
              onChange={(e) => setDraft({ ...draft, description_es: e.target.value })}
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
              onClick={() => { setModalOpen(false); setEditingId(null); }}
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
              {saving ? "Saving…" : editingId ? "Update slide" : "Save slide"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function sortSlides(slides: ApiSlideshowSlide[]): ApiSlideshowSlide[] {
  return [...slides].sort(
    (a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id)
  );
}
