import { useRef, useState } from 'react';
import Modal from './Modal';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/useConfirm';
import { apiErrorMessage, productsApi, type Product, type ProductPhoto } from '../lib/api';

// Quick checks for instant feedback only — the backend re-validates every
// file (real content, dimensions, size) and is the one that decides.
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
/** Additional photos besides the main one (backend: models.PRODUCT_IMAGES_MAX). */
export const MAX_EXTRA_PHOTOS = 8;

function precheck(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'الصورة لازم تكون JPG أو PNG أو WEBP';
  if (file.size > MAX_BYTES) return 'حجم الصورة أكبر من 5 ميجا';
  return null;
}

/** Square photo frame: the image, or the empty-state placeholder. */
function PhotoFrame({ src, alt, size }: { src: string | null; alt: string; size: number | string }) {
  const small = typeof size === 'number' && size <= 60;
  return (
    <div
      style={{
        width: size, height: typeof size === 'number' ? size : undefined, aspectRatio: '1', borderRadius: 8,
        overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--parchment-2)', border: '1px solid var(--line)',
      }}
    >
      {src ? (
        <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: small ? 9 : 13, color: 'var(--ink-muted)' }}>{small ? '+ صورة' : 'مفيش صورة'}</span>
      )}
    </div>
  );
}

/** The product table's photo cell: the thumbnail opens the photo manager. */
export function ProductImageCell({ product, onChanged }: { product: Product; onChanged: (p: Product) => void }) {
  const [open, setOpen] = useState(false);
  const extra = product.images.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`صور ${product.name}`}
        title="إدارة صور المنتج"
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', position: 'relative' }}
      >
        <PhotoFrame src={product.image_url} alt="" size={44} />
        {extra > 0 && (
          <span className="photo-count" aria-hidden="true">+{extra.toLocaleString('ar-EG')}</span>
        )}
      </button>
      {open && (
        <ProductImageManager product={product} onChanged={onChanged} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ProductImageManager({ product, onChanged, onClose }: { product: Product; onChanged: (p: Product) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`صور المنتج — ${product.name}`} onClose={() => !busy && onClose()} wide>
      <ProductPhotos product={product} onChanged={onChanged} onBusyChange={setBusy} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} style={{ marginInlineStart: 'auto' }}>
          إغلاق
        </button>
      </div>
    </Modal>
  );
}

type Tile = { kind: 'main'; url: string } | { kind: 'extra'; photo: ProductPhoto; index: number };

/** Every photo of a product: the main one first, then the additional ones
 * in display order. Each change is saved right away (it doesn't wait for a
 * form's save button) and the updated product is passed to `onChanged`. */
export function ProductPhotos({
  product,
  onChanged,
  onBusyChange,
}: {
  product: Product;
  onChanged: (p: Product) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<Tile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusyState] = useState(false);

  const extras = product.images;
  const tiles: Tile[] = [
    ...(product.image_url ? [{ kind: 'main' as const, url: product.image_url }] : []),
    ...extras.map((photo, index) => ({ kind: 'extra' as const, photo, index })),
  ];
  const remaining = product.image_url ? MAX_EXTRA_PHOTOS - extras.length : MAX_EXTRA_PHOTOS + 1;

  function setBusy(value: boolean) {
    setBusyState(value);
    onBusyChange?.(value);
  }

  async function run(action: () => Promise<Product>, done: string, failure: string) {
    setBusy(true);
    setErrors([]);
    try {
      onChanged(await action());
      toast(done);
    } catch (err) {
      setErrors([apiErrorMessage(err, failure)]);
    } finally {
      setBusy(false);
    }
  }

  function openPicker(input: HTMLInputElement | null) {
    // Clear the previous choice when the picker opens (so the same file can
    // be picked again) — never right after choosing, which can drop the
    // chosen file's data before it's uploaded.
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const problems: string[] = [];
    const valid = files.filter((f) => {
      const problem = precheck(f);
      if (problem) problems.push(`${f.name}: ${problem}`);
      return !problem;
    });
    if (valid.length > remaining) {
      valid.splice(remaining).forEach((f) => problems.push(`${f.name}: اتعدّى الحد الأقصى للصور`));
    }
    setBusy(true);
    let latest: Product | null = null;
    let uploaded = 0;
    for (const [i, file] of valid.entries()) {
      setStatus(`جاري رفع ${(i + 1).toLocaleString('ar-EG')} من ${valid.length.toLocaleString('ar-EG')}...`);
      try {
        latest = await productsApi.addPhoto(product.id, file);
        onChanged(latest);
        uploaded += 1;
      } catch (err) {
        problems.push(`${file.name}: ${apiErrorMessage(err, 'تعذر رفع الصورة')}`);
      }
    }
    setStatus(null);
    setErrors(problems);
    setBusy(false);
    if (uploaded > 0) toast(uploaded === 1 ? 'تم رفع الصورة' : `تم رفع ${uploaded.toLocaleString('ar-EG')} صور`);
  }

  function replace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = replaceTarget;
    if (!file || !target) return;
    const problem = precheck(file);
    if (problem) {
      setErrors([problem]);
      return;
    }
    run(
      () => (target.kind === 'main'
        ? productsApi.uploadImage(product.id, file)
        : productsApi.replacePhoto(product.id, target.photo.id, file)),
      'تم استبدال الصورة',
      'تعذر استبدال الصورة — حاول تاني',
    );
  }

  function remove(tile: Tile) {
    const main = tile.kind === 'main';
    confirmDialog.ask({
      title: main ? 'حذف الصورة الرئيسية؟' : 'حذف الصورة؟',
      message: main
        ? extras.length > 0
          ? `الصورة الرئيسية لـ«${product.name}» هتتشال، وأول صورة إضافية هتبقى الرئيسية.`
          : `صورة «${product.name}» هتتشال من الموقع وهيظهر مكانها الشكل الافتراضي.`
        : `الصورة رقم ${(tile.index + 2).toLocaleString('ar-EG')} من صور «${product.name}» هتتشال من الموقع.`,
      confirmLabel: 'حذف الصورة',
      danger: true,
      action: async () => {
        const updated = main ? await productsApi.removeImage(product.id) : await productsApi.removePhoto(product.id, tile.photo.id);
        onChanged(updated);
        toast('تم حذف الصورة');
      },
    });
  }

  function move(index: number, delta: number) {
    const ids = extras.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    run(() => productsApi.reorderPhotos(product.id, ids), 'تم تغيير ترتيب الصور', 'تعذر تغيير الترتيب');
  }

  return (
    <div>
      {confirmDialog.dialog}
      <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--ink-muted)', margin: '0 0 12px' }}>
        JPG أو PNG أو WEBP، حتى 5 ميجا للصورة، وأقل ضلع 200 بكسل. صورة رئيسية وحتى {MAX_EXTRA_PHOTOS.toLocaleString('ar-EG')} صور إضافية.
        الأفضل صور مربعة بخلفية فاتحة. أي تغيير في الصور بيتحفظ على طول.
      </p>

      {tiles.length === 0 ? (
        <div className="photo-empty">مفيش صور للمنتج ده لسه.</div>
      ) : (
        <ul className="photo-grid" aria-label={`صور ${product.name}`}>
          {tiles.map((tile) => {
            const url = tile.kind === 'main' ? tile.url : tile.photo.image_url;
            const label = tile.kind === 'main' ? 'الصورة الرئيسية' : `صورة إضافية ${(tile.index + 1).toLocaleString('ar-EG')}`;
            return (
              <li key={tile.kind === 'main' ? 'main' : tile.photo.id} className={`photo-tile${tile.kind === 'main' ? ' is-main' : ''}`}>
                <PhotoFrame src={url} alt={`${product.name} — ${label}`} size="100%" />
                <div className="photo-tile-label">{tile.kind === 'main' ? <strong>الرئيسية</strong> : label}</div>
                <div className="photo-tile-actions">
                  {tile.kind === 'extra' && (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                        onClick={() => run(() => productsApi.makePrimary(product.id, tile.photo.id), 'بقت الصورة الرئيسية', 'تعذر تغيير الصورة الرئيسية')}>
                        اجعلها الرئيسية
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || tile.index === 0}
                        aria-label={`تقديم ${label}`} title="تقديم" onClick={() => move(tile.index, -1)}>→</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || tile.index === extras.length - 1}
                        aria-label={`تأخير ${label}`} title="تأخير" onClick={() => move(tile.index, 1)}>←</button>
                    </>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                    aria-label={`استبدال ${label}`} onClick={() => { setReplaceTarget(tile); openPicker(replaceRef.current); }}>
                    استبدال
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy}
                    aria-label={`حذف ${label}`} onClick={() => remove(tile)}>
                    حذف
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {status && <p role="status" style={{ fontSize: 13, color: 'var(--forest)', margin: '12px 0 0' }}>{status}</p>}
      {errors.length > 0 && (
        <div role="alert" className="error-banner" style={{ marginTop: 12, marginBottom: 0 }}>
          {errors.length === 1 ? errors[0] : <ul style={{ margin: 0, paddingInlineStart: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      <input ref={addRef} type="file" accept={ACCEPTED.join(',')} multiple style={{ display: 'none' }} onChange={addFiles} />
      <input ref={replaceRef} type="file" accept={ACCEPTED.join(',')} style={{ display: 'none' }} onChange={replace} />
      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={busy || remaining <= 0} onClick={() => openPicker(addRef.current)}>
          {busy && status ? 'جاري الرفع...' : tiles.length === 0 ? 'إضافة صور' : 'إضافة صور أخرى'}
        </button>
        {remaining <= 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginInlineStart: 10 }}>وصلت للحد الأقصى للصور</span>}
      </div>
    </div>
  );
}
