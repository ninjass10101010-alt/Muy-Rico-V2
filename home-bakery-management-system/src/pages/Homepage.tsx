import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, ImagePlus, Plus, Trash2 } from "lucide-react";
import Modal from "../components/ui/Modal";
import {
  createTestimonial,
  deleteTestimonial,
  fetchSite,
  fetchTestimonials,
  saveSiteContent,
  updateTestimonial,
  uploadImage,
  type ApiTestimonial,
  type SiteContentMap,
} from "../utils/api";

const PHOTO_SLOTS = [
  { key: "hero_image", label: "Hero photo", hint: "The big photo next to the headline. Portrait works best (4:5). Export ~1600px WebP.", aspect: "aspect-[4/5]" },
  { key: "story_image", label: "Our Story photo", hint: "Photo beside the family story. Landscape works best (3:2). Export ~1400px WebP.", aspect: "aspect-[3/2]" },
] as const;

const TEXT_SLOTS = [
  { key: "visit_hours", label: "Hours" },
  { key: "visit_ordering", label: "Ordering / lead times" },
  { key: "visit_pickup", label: "Pickup" },
  { key: "visit_contact", label: "Contact" },
] as const;

type TestimonialDraft = {
  quote_en: string;
  quote_es: string;
  author: string;
  occasion: string;
  published: boolean;
};

const emptyDraft: TestimonialDraft = {
  quote_en: "",
  quote_es: "",
  author: "",
  occasion: "",
  published: true,
};

export default function Homepage() {
  const [content, setContent] = useState<SiteContentMap>({});
  const [textDraft, setTextDraft] = useState<Record<string, { en: string; es: string }>>({});
  const [testimonials, setTestimonials] = useState<ApiTestimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [savingText, setSavingText] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TestimonialDraft>(emptyDraft);
  const [savingT, setSavingT] = useState(false);

  const CAPTION_KEYS = ['hero_image_caption', 'story_image_caption'];

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [site, ts] = await Promise.all([fetchSite(), fetchTestimonials()]);
      setContent(site.content || {});
      setTestimonials(ts || []);
      const td: Record<string, { en: string; es: string }> = {};
      for (const slot of TEXT_SLOTS) {
        const row = site.content?.[slot.key];
        td[slot.key] = { en: row?.value_en || "", es: row?.value_es || "" };
      }
      for (const key of CAPTION_KEYS) {
        const row = site.content?.[key];
        td[key] = { en: row?.value_en || "", es: row?.value_es || "" };
      }
      setTextDraft(td);
    } catch (e: any) {
      setError(e?.message || "Failed to load homepage content");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3000);
  }

  async function onPhotoFile(key: string, file: File | null) {
    if (!file) return;
    setUploadingKey(key);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      await saveSiteContent({ [key]: { ...content[key], image_url: url } });
      await refresh();
      flash("Photo updated — it will appear on the homepage shortly.");
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploadingKey(null);
    }
  }

  async function saveCaption(slotKey: string) {
    const key = slotKey + '_caption';
    const val = textDraft[key];
    if (!val) return;
    setSavingText(true);
    try {
      await saveSiteContent({ [key]: { value_en: val.en, value_es: val.es } });
      await refresh();
      flash("Caption saved.");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSavingText(false);
    }
  }

  async function saveText() {
    setSavingText(true);
    setError(null);
    try {
      const payload: SiteContentMap = {};
      for (const slot of TEXT_SLOTS) {
        payload[slot.key] = {
          ...content[slot.key],
          value_en: textDraft[slot.key]?.en || "",
          value_es: textDraft[slot.key]?.es || "",
        };
      }
      await saveSiteContent(payload);
      await refresh();
      flash("Visit info saved.");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSavingText(false);
    }
  }

  async function saveTestimonial() {
    if (!draft.quote_en.trim()) {
      setError("Quote (English) is required");
      return;
    }
    setSavingT(true);
    setError(null);
    try {
      await createTestimonial({
        quote_en: draft.quote_en.trim(),
        quote_es: draft.quote_es.trim() || undefined,
        author: draft.author.trim() || undefined,
        occasion: draft.occasion.trim() || undefined,
        published: draft.published,
        display_order: testimonials.length,
      });
      setModalOpen(false);
      setDraft(emptyDraft);
      await refresh();
      flash(draft.published ? "Review published on the homepage." : "Review saved as hidden.");
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSavingT(false);
    }
  }

  async function togglePublished(t: ApiTestimonial) {
    try {
      await updateTestimonial(t.id, { published: !t.published });
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to update review");
    }
  }

  async function removeTestimonial(t: ApiTestimonial) {
    if (!confirm("Delete this review?")) return;
    try {
      await deleteTestimonial(t.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to delete review");
    }
  }

  if (loading) {
    return <p className="text-sm text-cocoa/50">Loading homepage content…</p>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-cocoa">Homepage</h1>
        <p className="text-sm text-cocoa/60">
          Edit the photos, visit info, and customer reviews on muy-rico.com. Changes go live as soon as they save — no redeploy needed.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-palm/20 bg-palm/5 px-4 py-3 text-sm text-palm">{notice}</div>
      )}

      {/* ── Photos ── */}
      <section className="space-y-3">
        <h2 className="font-serif text-lg text-cocoa">Photos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {PHOTO_SLOTS.map((slot) => {
            const url = content[slot.key]?.image_url;
            return (
              <article key={slot.key} className="overflow-hidden rounded-2xl border border-cocoa/10 bg-white shadow-sm">
                <div className={`${slot.aspect} overflow-hidden bg-sand-100`}>
                  {url ? (
                    <img src={url} alt={slot.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-cocoa/40">
                      No custom photo — homepage is using the built-in default
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <p className="font-medium text-cocoa">{slot.label}</p>
                  <p className="text-xs text-cocoa/50">{slot.hint}</p>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-coral px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90">
                    <ImagePlus size={14} />
                    {uploadingKey === slot.key ? "Uploading…" : url ? "Replace photo" : "Upload photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingKey !== null}
                      onChange={(e) => onPhotoFile(slot.key, e.target.files?.[0] || null)}
                    />
                  </label>
                  <div className="mt-3 border-t border-cocoa/10 pt-3">
                    <p className="mb-2 text-xs font-medium text-cocoa/70">Caption</p>
                    <input
                      className="mb-1.5 w-full rounded-xl border border-cocoa/15 px-3 py-2 text-sm"
                      placeholder="English — e.g. Fresh from the oven"
                      value={textDraft[slot.key + '_caption']?.en || ''}
                      onChange={(e) => setTextDraft(d => ({ ...d, [slot.key + '_caption']: { en: e.target.value, es: d[slot.key + '_caption']?.es || '' } }))}
                    />
                    <input
                      className="mb-2 w-full rounded-xl border border-cocoa/15 px-3 py-2 text-sm"
                      placeholder="Español — e.g. Recién salidos del horno"
                      value={textDraft[slot.key + '_caption']?.es || ''}
                      onChange={(e) => setTextDraft(d => ({ ...d, [slot.key + '_caption']: { en: d[slot.key + '_caption']?.en || '', es: e.target.value } }))}
                    />
                    <button
                      type="button"
                      onClick={() => saveCaption(slot.key)}
                      disabled={savingText}
                      className="rounded-full bg-coral px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {savingText ? "Saving…" : "Save caption"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <p className="text-xs text-cocoa/50">
          Menu preview photos come from your products — mark up to 4 products as “Featured on homepage” in <strong>Menu &amp; Products</strong>.
        </p>
      </section>

      {/* ── Visit info ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg text-cocoa">Visit &amp; hours</h2>
            <p className="text-xs text-cocoa/50">Shown in the “Visítanos / Visit Us” section next to the map.</p>
          </div>
          <button
            type="button"
            onClick={saveText}
            disabled={savingText}
            className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {savingText ? "Saving…" : "Save visit info"}
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-cocoa/10 bg-white shadow-sm">
          {TEXT_SLOTS.map((slot, i) => (
            <div key={slot.key} className={`grid gap-3 p-4 sm:grid-cols-[140px_1fr_1fr] sm:items-center ${i > 0 ? "border-t border-cocoa/10" : ""}`}>
              <p className="text-sm font-medium text-cocoa">{slot.label}</p>
              <input
                className="w-full rounded-xl border border-cocoa/15 px-3 py-2 text-sm"
                placeholder="English"
                value={textDraft[slot.key]?.en || ""}
                onChange={(e) => setTextDraft((d) => ({ ...d, [slot.key]: { en: e.target.value, es: d[slot.key]?.es || "" } }))}
              />
              <input
                className="w-full rounded-xl border border-cocoa/15 px-3 py-2 text-sm"
                placeholder="Español"
                value={textDraft[slot.key]?.es || ""}
                onChange={(e) => setTextDraft((d) => ({ ...d, [slot.key]: { en: d[slot.key]?.en || "", es: e.target.value } }))}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg text-cocoa">Customer reviews</h2>
            <p className="text-xs text-cocoa/50">
              The testimonials section appears on the homepage automatically once at least one review is published.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus size={16} /> Add review
          </button>
        </div>

        {testimonials.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cocoa/20 bg-white p-10 text-center text-sm text-cocoa/60">
            No reviews yet. When customers send kind words (Facebook, texts), add them here.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <article
                key={t.id}
                className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${t.published ? "border-cocoa/10" : "border-cocoa/5 opacity-70"}`}
              >
                <p className="flex-1 font-serif text-sm italic text-cocoa">“{t.quote_en}”</p>
                {t.quote_es && <p className="mt-1 text-xs text-cocoa/50">“{t.quote_es}”</p>}
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-cocoa/60">
                  {t.author || "Anonymous"}{t.occasion ? ` · ${t.occasion}` : ""}
                </p>
                <div className="mt-3 flex items-center gap-1 border-t border-cocoa/10 pt-3">
                  <button
                    type="button"
                    title={t.published ? "Unpublish" : "Publish"}
                    onClick={() => togglePublished(t)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                  >
                    {t.published ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <span className={`ml-1 text-xs ${t.published ? "text-palm" : "text-cocoa/40"}`}>
                    {t.published ? "Live on homepage" : "Hidden"}
                  </span>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => removeTestimonial(t)}
                    className="ml-auto rounded-lg p-1.5 text-red-600/80 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add customer review">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Quote (English) *</span>
            <textarea
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              rows={3}
              value={draft.quote_en}
              onChange={(e) => setDraft({ ...draft, quote_en: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Quote (Español, optional)</span>
            <textarea
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              rows={3}
              value={draft.quote_es}
              onChange={(e) => setDraft({ ...draft, quote_es: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-cocoa/70">Name</span>
              <input
                className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
                placeholder="e.g. Maria G."
                value={draft.author}
                onChange={(e) => setDraft({ ...draft, author: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-cocoa/70">Occasion</span>
              <input
                className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
                placeholder="e.g. Birthday cake"
                value={draft.occasion}
                onChange={(e) => setDraft({ ...draft, occasion: e.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-cocoa/80">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
            />
            Publish on homepage immediately
          </label>
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
              disabled={savingT}
              onClick={saveTestimonial}
              className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingT ? "Saving…" : "Save review"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
