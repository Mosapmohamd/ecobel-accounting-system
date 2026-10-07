import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { useToast } from '../lib/toast';
import { useConfirm } from '../lib/useConfirm';
import { apiErrorMessage, productsApi, type Product } from '../lib/api';

// Quick checks for instant feedback only — the backend re-validates every
// file (real content, dimensions, size) and is the one that decides.
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function precheck(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'الصورة لازم تكون JPG أو PNG أو WEBP';
  if (file.size > MAX_BYTES) return 'حجم الصورة أكبر من 5 ميجا';
  return null;
}

/** Square photo frame: the image, or the empty-state placeholder. */
function PhotoFrame({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--parchment-2)', border: '1px solid var(--line)',
      }}
    >
      {src ? (
        <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: size > 60 ? 13 : 9, color: '#8a8074' }}>{size > 60 ? 'مفيش صورة' : '+ صورة'}</span>
      )}
    </div>
  );
}

/** The product table's photo cell: the thumbnail opens the photo manager. */
export function ProductImageCell({ product, onChanged }: { product: Product; onChanged: (p: Product) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`صورة ${product.name}`}
        title="إدارة صورة المنتج"
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
      >
        <PhotoFrame src={product.image_url} alt="" size={44} />
      </button>
      {open && <ProductImageManager product={product} onChanged={onChanged} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProductImageManager({ product, onChanged, onClose }: { product: Product; onChanged: (p: Product) => void; onClose: () => void }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Local preview of the chosen file (released when it changes or we close).
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    const problem = precheck(chosen);
    setError(problem);
    setFile(problem ? null : chosen);
  }

  function openPicker() {
    // Clear the previous choice when the picker opens (so the same file can
    // be picked again) — never right after choosing, which can drop the
    // chosen file's data before it's uploaded.
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await productsApi.uploadImage(product.id, file);
      onChanged(updated);
      setFile(null);
      toast(product.image_url ? 'تم استبدال صورة المنتج' : 'تم رفع صورة المنتج');
    } catch (err) {
      setError(apiErrorMessage(err, 'تعذر رفع الصورة — حاول تاني'));
    } finally {
      setUploading(false);
    }
  }

  function remove() {
    confirmDialog.ask({
      title: 'إزالة صورة المنتج؟',
      message: `صورة «${product.name}» هتتشال من الموقع وهيظهر مكانها الشكل الافتراضي.`,
      confirmLabel: 'إزالة الصورة',
      danger: true,
      action: async () => {
        const updated = await productsApi.removeImage(product.id);
        onChanged(updated);
        toast('تم إزالة صورة المنتج');
      },
    });
  }

  const busy = uploading;
  return (
    <Modal title={`صورة المنتج — ${product.name}`} onClose={() => !busy && onClose()}>
      {confirmDialog.dialog}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--forest)', marginBottom: 6 }}>
            {file ? 'الصورة الجديدة (قبل الرفع)' : 'الصورة الحالية'}
          </div>
          <PhotoFrame src={file ? preview : product.image_url} alt={product.name} size={180} />
        </div>
        <div style={{ flex: 1, minWidth: 180, fontSize: 13, lineHeight: 1.8, color: '#6c5d58' }}>
          JPG أو PNG أو WEBP، حتى 5 ميجا، وأقل ضلع 200 بكسل على الأقل.
          <br />
          الأفضل صورة مربعة بخلفية فاتحة — بتظهر مقصوصة مربع في الموقع.
        </div>
      </div>

      {error && (
        <div role="alert" className="error-banner" style={{ marginTop: 14, marginBottom: 0 }}>
          {error}
        </div>
      )}

      <input ref={fileRef} type="file" accept={ACCEPTED.join(',')} style={{ display: 'none' }} onChange={pick} />
      <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
        {file ? (
          <>
            <button type="button" className="btn btn-primary" onClick={upload} disabled={busy}>
              {busy ? 'جاري الرفع...' : product.image_url ? 'استبدال الصورة' : 'رفع الصورة'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setFile(null)} disabled={busy}>
              إلغاء الاختيار
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={openPicker}>
            {product.image_url ? 'اختيار صورة جديدة' : 'اختيار صورة'}
          </button>
        )}
        {product.image_url && !file && (
          <button type="button" className="btn btn-danger" onClick={remove}>
            إزالة الصورة
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} style={{ marginInlineStart: 'auto' }}>
          إغلاق
        </button>
      </div>
    </Modal>
  );
}
